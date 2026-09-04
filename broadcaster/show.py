"""The show director: the arena's programming and the chat-driven fights.

One process, one fast-h3 session, one never-ending channel. The director
reads the arena's chat thread (from the web app), keeps the model's queue fed,
and runs three programs:

  idle     fighter bios from the registry, tagged `generated: true` so a
           fight can evict them (the upstream client's idle-filler idea);
  card     the next fight is announced: both fighters, then the face-off;
  fight    rounds — both fighters `!attack` in chat (or the round clock runs
           out), the narrative coordinator judges and writes the shots, the
           shots go on air, and only then does the next round open;
  verdict  the winner's moment, then back to idle.

Rounds are *gated on the broadcast*: a round's `!attack` window opens when
the previous round's clips start playing (judged from the metadata echo on
`clip_started`), so the fight in chat and the fight on screen move together.

Queue policy is the upstream client's, ported: this director is the queue's
only writer, fight clips insert ahead of waiting filler and evict it when
they need room, groups are enqueued whole or not at all, autoplay is on and
`run_playout` curates the playout front with `move`. Everything the show
knows about a clip travels in its metadata tag (see `group_tag.py`).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from arena_api import ArenaApi
from group_tag import is_generated, parse_group_tag, pick_next, viewer_insert_position
from reactor_link import ReactorLink

logger = logging.getLogger(__name__)

COMMANDS = ("!fight", "!attack", "!leave", "!fighters", "!queue", "!help")

_TICK_S = 0.5
_PLAYOUT_POLL_S = 0.5
_IDLE_POLL_S = 3.0
_PUBLISH_EVERY_S = 5.0
_FIGHTERS_REFRESH_S = 30.0
# A clip can take its own length to build and the queue ahead of it to play;
# past this the show moves on without waiting for the echo.
_GATE_TIMEOUT_S = 150.0
_ENQUEUE_RETRIES = 5
_RETRY_DELAY_S = 3.0
_DEFAULT_ATTACK = "hesitates, guard up, giving ground"


@dataclass
class Contestant:
    handle: str
    player_id: str
    fighter: dict
    health: int = 100
    attack: str | None = None


@dataclass
class Fight:
    id: str
    a: Contestant
    b: Contestant
    max_rounds: int
    round: int = 0
    round_state: str = "playing"  # open | judging | playing
    deadline_at: float | None = None  # epoch seconds
    narration: str | None = None
    history: list[dict] = field(default_factory=list)
    winner: Contestant | None = None
    finished: bool = False

    def side(self, player_id: str) -> Contestant | None:
        if self.a.player_id == player_id:
            return self.a
        if self.b.player_id == player_id:
            return self.b
        return None


@dataclass
class QueueEntry:
    handle: str
    player_id: str
    fighter: dict


class Show:
    def __init__(self, link: ReactorLink, arena: ArenaApi, *, arena_name: str,
                 idle_queue_target: int, round_seconds: float, max_rounds: int,
                 chat_poll_s: float) -> None:
        self._link = link
        self._arena = arena
        self._arena_name = arena_name
        self._idle_target = idle_queue_target
        self._round_seconds = round_seconds
        self._max_rounds = max_rounds
        self._chat_poll_s = chat_poll_s

        self.program = "idle"
        self.queue: list[QueueEntry] = []
        self.fight: Fight | None = None
        self.setting: str | None = None
        self.now_playing: str | None = None
        self.last_narration: str | None = None

        self._fighters: list[dict] = []
        self._fighters_at = 0.0
        self._bio_index = 0
        self._chat_seq: int | None = None
        self._enqueue_lock = asyncio.Lock()
        self._awaiting_group: str | None = None
        self._awaiting_since = 0.0
        self._gate_fired: set[str] = set()
        self._dirty = True
        self._busy = False  # a coordinator call is in flight
        link.add_listener(self._on_model_message)

    # ------------------------------------------------------------------ tasks

    async def run_chat(self) -> None:
        """Poll the arena chat and act on commands. Starts after the backlog."""
        while True:
            try:
                if self._chat_seq is None:
                    seq, _ = await self._arena.read_chat(0)
                    self._chat_seq = seq
                    logger.info("[show] chat joined at seq %d", seq)
                else:
                    seq, messages = await self._arena.read_chat(self._chat_seq)
                    for message in messages:
                        self._chat_seq = max(self._chat_seq, int(message.get("seq", 0)))
                        if message.get("kind") == "user":
                            await self._on_chat(message)
                    self._chat_seq = max(self._chat_seq, seq)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.warning("[show] chat poll failed: %s", error)
            await asyncio.sleep(self._chat_poll_s)

    async def run_show(self) -> None:
        """The state machine's clock: deadlines, gates, transitions."""
        while True:
            await asyncio.sleep(_TICK_S)
            try:
                await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.error("[show] tick failed: %s", error, exc_info=True)

    async def run_publish(self) -> None:
        """Push show state to the web app on change and as a heartbeat."""
        last = 0.0
        while True:
            await asyncio.sleep(0.5)
            now = time.monotonic()
            if self._dirty or now - last >= _PUBLISH_EVERY_S:
                self._dirty = False
                last = now
                await self._arena.publish_show(self.show_state())

    async def run_idle(self) -> None:
        """Keep the queue topped up with fighter bios while nothing is queued."""
        if self._idle_target <= 0:
            return
        while True:
            await asyncio.sleep(_IDLE_POLL_S)
            if not self._link.connected:
                continue
            target = min(self._idle_target, max(1, self._link.playout_capacity - 1))
            if self._link.generation_queued + self._link.playout_queued >= target:
                continue
            try:
                await self._enqueue_bio()
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.error("[show] idle fill failed: %s", error)

    async def run_playout(self) -> None:
        """Keep the playout front right for autoplay (ported from upstream)."""
        while True:
            await asyncio.sleep(_PLAYOUT_POLL_S)
            if not self._link.connected:
                continue
            await self._relieve_build_backpressure()
            clips = self._link.playout_clips
            desired = pick_next(clips)
            if desired is None or clips[0]["clip_id"] == desired["clip_id"]:
                continue
            await self._link.send_command("move", {"clip_id": desired["clip_id"], "position": 0})
            await asyncio.sleep(_PLAYOUT_POLL_S)

    # ------------------------------------------------------------------- chat

    async def _on_chat(self, message: dict) -> None:
        text = str(message.get("text", "")).strip()
        handle = str(message.get("handle", "someone"))
        player_id = str(message.get("playerId") or handle)
        lowered = text.lower()
        command = next((c for c in COMMANDS if lowered == c or lowered.startswith(c + " ")), None)
        if command is None:
            return
        arg = text[len(command):].strip()

        if command == "!help":
            await self._say("Commands: !fight <fighter> · !attack <your move> · !leave · !fighters · !queue")
        elif command == "!fighters":
            fighters = await self._registry()
            names = ", ".join(f["name"] for f in fighters[:15]) or "none yet — forge one on the site"
            await self._say(f"Fighters: {names}")
        elif command == "!queue":
            await self._say(self._queue_line())
        elif command == "!leave":
            before = len(self.queue)
            self.queue = [e for e in self.queue if e.player_id != player_id]
            await self._say(f"{handle} steps out of the queue." if len(self.queue) < before else f"{handle}, you're not in the queue.")
            self._dirty = True
        elif command == "!fight":
            await self._on_fight_command(handle, player_id, arg)
        elif command == "!attack":
            await self._on_attack_command(handle, player_id, arg)

    async def _on_fight_command(self, handle: str, player_id: str, arg: str) -> None:
        if self.fight and self.fight.side(player_id):
            await self._say(f"{handle}, you're already fighting!")
            return
        if any(e.player_id == player_id for e in self.queue):
            await self._say(f"{handle}, you're already in the queue. {self._queue_line()}")
            return
        if not arg:
            await self._say(f"{handle}: !fight <fighter name> — see !fighters")
            return
        fighter = await self._find_fighter(arg)
        if fighter is None:
            await self._say(f"{handle}, no fighter matches “{arg[:40]}”. Try !fighters.")
            return
        self.queue.append(QueueEntry(handle=handle, player_id=player_id, fighter=fighter))
        await self._say(f"{handle} enters the queue as {fighter['name']} (#{len(self.queue)}).")
        self._dirty = True
        await self._maybe_start_card()

    async def _on_attack_command(self, handle: str, player_id: str, arg: str) -> None:
        fight = self.fight
        if not fight or fight.finished:
            await self._say(f"{handle}, there's no fight on. !fight <fighter> to queue up.")
            return
        side = fight.side(player_id)
        if side is None:
            return  # spectators can't attack; stay quiet
        if fight.round_state != "open":
            await self._say(f"{handle}, hold — the round isn't open yet.")
            return
        if side.attack is not None:
            await self._say(f"{handle}, your move for round {fight.round} is already locked in.")
            return
        if not arg:
            await self._say(f"{handle}: !attack <what {side.fighter['name']} does>")
            return
        side.attack = arg[:280]
        other = fight.b if side is fight.a else fight.a
        await self._say(f"{side.fighter['name']} locks in a move." + ("" if other.attack else f" Waiting on {other.fighter['name']}…"))
        self._dirty = True
        if fight.a.attack and fight.b.attack:
            await self._resolve_round()

    # ------------------------------------------------------------------ state

    async def _tick(self) -> None:
        fight = self.fight
        now = time.time()
        # Gate: the awaited group started playing (or we gave up waiting).
        if self._awaiting_group and (
            self._awaiting_group in self._gate_fired
            or time.monotonic() - self._awaiting_since > _GATE_TIMEOUT_S
        ):
            if self._awaiting_group not in self._gate_fired:
                logger.warning("[show] gate timeout on %s; advancing", self._awaiting_group)
            self._gate_fired.discard(self._awaiting_group)
            self._awaiting_group = None
            await self._advance()
            return
        if fight and not fight.finished and fight.round_state == "open" and fight.deadline_at and now >= fight.deadline_at:
            for side in (fight.a, fight.b):
                if side.attack is None:
                    side.attack = _DEFAULT_ATTACK
                    await self._say(f"Time! {side.fighter['name']} {_DEFAULT_ATTACK}.")
            await self._resolve_round()
            return
        if self.program == "idle" and not fight:
            await self._maybe_start_card()

    async def _advance(self) -> None:
        """What happens once the awaited clips are on air."""
        fight = self.fight
        if self.program == "card" and fight:
            self.program = "fight"
            await self._open_round()
        elif self.program == "fight" and fight:
            if fight.finished:
                await self._start_verdict()
            else:
                await self._open_round()
        elif self.program == "verdict":
            self.program = "idle"
            self.fight = None
            self._dirty = True
            await self._maybe_start_card()

    async def _maybe_start_card(self) -> None:
        if self.fight or self._busy or len(self.queue) < 2 or not self._link.connected:
            return
        a, b = self.queue.pop(0), self.queue.pop(0)
        fight = Fight(
            id=uuid.uuid4().hex[:8],
            a=Contestant(a.handle, a.player_id, a.fighter),
            b=Contestant(b.handle, b.player_id, b.fighter),
            max_rounds=self._max_rounds,
        )
        self.fight = fight
        self.program = "card"
        self._dirty = True
        await self._say(
            f"NEXT FIGHT — {fight.a.fighter['name']} ({fight.a.handle}) vs "
            f"{fight.b.fighter['name']} ({fight.b.handle}). {fight.max_rounds} rounds. "
            f"Fighters: !attack when the round opens."
        )
        self._busy = True
        try:
            program = await self._arena.program({
                "kind": "card", "a": fight.a.fighter, "b": fight.b.fighter,
                "arenaName": self._arena_name, "setting": self.setting,
            })
        except Exception as error:
            logger.warning("[show] card program failed: %s", error)
            program = {"shots": [], "setting": self.setting}
        finally:
            self._busy = False
        self.setting = program.get("setting") or self.setting
        group = await self._enqueue_group(
            program.get("shots", []), kind="card", title=f"{fight.a.fighter['name']} vs {fight.b.fighter['name']}",
            fight_id=fight.id,
        )
        if group:
            self._await(group)
        else:
            await self._advance()

    async def _open_round(self) -> None:
        fight = self.fight
        assert fight
        fight.round += 1
        fight.round_state = "open"
        fight.deadline_at = time.time() + self._round_seconds
        fight.a.attack = fight.b.attack = None
        self._dirty = True
        await self._say(
            f"ROUND {fight.round}/{fight.max_rounds} — {fight.a.handle} and {fight.b.handle}: "
            f"!attack <your move>. {int(self._round_seconds)}s on the clock."
        )

    async def _resolve_round(self) -> None:
        fight = self.fight
        if not fight or fight.round_state != "open":
            return
        fight.round_state = "judging"
        fight.deadline_at = None
        self._dirty = True
        payload = {
            "arenaName": self._arena_name,
            "round": fight.round,
            "fighters": [self._side_payload(fight.a), self._side_payload(fight.b)],
            "history": fight.history,
            "setting": self.setting,
        }
        self._busy = True
        try:
            resolution = await self._arena.resolve_round(payload)
        except Exception as error:
            logger.error("[show] coordinator failed: %s — calling it a stalemate", error)
            resolution = {
                "winnerPlayerId": None, "damage": {}, "narration": "The exchange is a blur; neither lands clean.",
                "shots": [], "setting": self.setting,
            }
        finally:
            self._busy = False

        damage = resolution.get("damage", {})
        for side in (fight.a, fight.b):
            side.health = max(0, side.health - int(damage.get(side.player_id, 0)))
        narration = str(resolution.get("narration") or "").strip()
        fight.narration = narration or None
        self.last_narration = fight.narration
        self.setting = resolution.get("setting") or self.setting
        fight.history.append({
            "round": fight.round,
            "prompts": [
                {"playerId": fight.a.player_id, "text": fight.a.attack or "", "submittedAt": int(time.time() * 1000)},
                {"playerId": fight.b.player_id, "text": fight.b.attack or "", "submittedAt": int(time.time() * 1000)},
            ],
            "narration": narration or None,
            "healthAfter": {fight.a.player_id: fight.a.health, fight.b.player_id: fight.b.health},
            "shots": resolution.get("shots", []),
        })
        if narration:
            await self._say(narration, kind="narrator", handle="Narrator")
        await self._say(f"Health — {fight.a.fighter['name']}: {fight.a.health} · {fight.b.fighter['name']}: {fight.b.health}")

        dead = fight.a.health <= 0 or fight.b.health <= 0
        if dead or fight.round >= fight.max_rounds:
            fight.finished = True
            if fight.a.health != fight.b.health:
                fight.winner = fight.a if fight.a.health > fight.b.health else fight.b
        fight.round_state = "playing"
        self._dirty = True
        group = await self._enqueue_group(
            resolution.get("shots", []), kind="round", title=f"Round {fight.round}",
            fight_id=fight.id, round_no=fight.round,
        )
        if group:
            self._await(group)
        else:
            await self._advance()

    async def _start_verdict(self) -> None:
        fight = self.fight
        assert fight
        self.program = "verdict"
        self._dirty = True
        winner, loser = fight.winner, None
        if winner:
            loser = fight.b if winner is fight.a else fight.a
            await self._say(f"VERDICT — {winner.fighter['name']} ({winner.handle}) wins after {fight.round} round(s)!")
        else:
            await self._say(f"VERDICT — a draw after {fight.round} round(s).")
        self._busy = True
        try:
            program = await self._arena.program({
                "kind": "verdict",
                "winner": winner.fighter if winner else None,
                "loser": loser.fighter if loser else None,
                "narration": fight.narration or "",
                "setting": self.setting,
            })
        except Exception as error:
            logger.warning("[show] verdict program failed: %s", error)
            program = {"shots": []}
        finally:
            self._busy = False
        group = await self._enqueue_group(
            program.get("shots", []), kind="verdict",
            title=f"{winner.fighter['name']} wins" if winner else "A draw", fight_id=fight.id,
        )
        if group:
            self._await(group)
        else:
            await self._advance()

    def _await(self, group_id: str) -> None:
        self._awaiting_group = group_id
        self._awaiting_since = time.monotonic()

    # --------------------------------------------------------------- filler

    async def _enqueue_bio(self) -> None:
        fighters = await self._registry()
        if not fighters:
            return
        fighter = fighters[self._bio_index % len(fighters)]
        self._bio_index += 1
        try:
            program = await self._arena.program({"kind": "bio", "fighter": fighter, "setting": self.setting})
        except Exception as error:
            logger.warning("[show] bio program failed: %s", error)
            return
        self.setting = self.setting or program.get("setting")
        await self._enqueue_group(program.get("shots", []), kind="bio", title=fighter["name"], generated=True)

    # ------------------------------------------------------------ enqueueing

    async def _enqueue_group(self, shots: list[dict], *, kind: str, title: str, generated: bool = False,
                             fight_id: str | None = None, round_no: int | None = None) -> str | None:
        """Put one group on the generation queue whole, or not at all. Returns its id."""
        shots = [s for s in shots if s.get("prompt")]
        if not shots:
            return None
        group_id = uuid.uuid4().hex[:12]
        count = len(shots)
        async with self._enqueue_lock:
            free = self._link.generation_capacity - self._link.generation_queued
            if free < count and not generated:
                evictable = sum(1 for c in self._link.generation_clips if is_generated(c))
                if free + evictable >= count:
                    await self._evict_generation_fillers(count - free)
                    await asyncio.sleep(0.3)
                    free = self._link.generation_capacity - self._link.generation_queued
            if free < count:
                logger.warning("[show] no room for %s (%d shots, %d free); dropping", kind, count, free)
                return None
            position = None if generated else viewer_insert_position(self._link.generation_clips)
            queued = 0
            for index, shot in enumerate(shots, start=1):
                metadata = json.dumps({
                    "group_id": group_id, "kind": kind, "title": title[:120],
                    "scene": index, "scenes": count, "generated": generated,
                    "fight_id": fight_id, "round": round_no, "author": "arena", "source": "arena",
                }, ensure_ascii=False)
                payload: dict[str, Any] = {
                    "prompt": str(shot["prompt"])[:800],
                    "metadata": metadata,
                    "seconds": max(self._link.min_seconds, min(self._link.max_seconds, float(shot.get("seconds", 6)))),
                }
                if position is not None:
                    payload["position"] = position + index - 1
                for attempt in range(_ENQUEUE_RETRIES):
                    reply = await self._link.send_command("enqueue", payload)
                    if isinstance(reply, dict) and "clip" in reply:
                        queued += 1
                        logger.info("[show] queued %s %d/%d (%s)%s", kind, index, count,
                                    reply["clip"].get("clip_id", "?")[:8], " [filler]" if generated else "")
                        break
                    logger.warning("[show] enqueue %s %d/%d refused (try %d)", kind, index, count, attempt + 1)
                    await asyncio.sleep(_RETRY_DELAY_S)
            return group_id if queued else None

    async def _evict_generation_fillers(self, needed: int) -> None:
        popped = 0
        for clip in reversed(self._link.generation_clips):
            if popped >= needed:
                break
            if not is_generated(clip):
                continue
            reply = await self._link.send_command("pop", {"clip_id": clip["clip_id"]})
            if isinstance(reply, dict) and "clip" in reply:
                popped += 1

    async def _relieve_build_backpressure(self) -> None:
        if self._link.playout_queued < self._link.playout_capacity:
            return
        if not any(not is_generated(c) for c in self._link.generation_clips):
            return
        for clip in reversed(self._link.playout_clips):
            if is_generated(clip):
                await self._link.send_command("pop", {"clip_id": clip["clip_id"]})
                return

    # --------------------------------------------------------- model events

    def _on_model_message(self, kind: str, data: dict) -> None:
        clip = data.get("clip") if isinstance(data, dict) else None
        if not isinstance(clip, dict):
            return
        tag = parse_group_tag(clip.get("metadata", ""))
        if kind == "clip_started":
            if tag:
                self.now_playing = f"{tag.get('title', '')} · {tag.get('scene')}/{tag.get('scenes')}"
                if tag.get("group_id") == self._awaiting_group or self._awaiting_group is None:
                    self._gate_fired.add(str(tag.get("group_id")))
            else:
                self.now_playing = None
            self._dirty = True
        elif kind in ("clip_finished", "clip_stopped"):
            self.now_playing = None
            self._dirty = True
        elif kind == "clip_failed" and tag and tag.get("group_id") == self._awaiting_group:
            # The clip we were waiting for never built; don't hold the show.
            logger.error("[show] awaited clip failed (%s); advancing", data.get("reason"))
            self._gate_fired.add(str(tag.get("group_id")))

    # --------------------------------------------------------------- helpers

    async def _registry(self) -> list[dict]:
        if time.monotonic() - self._fighters_at > _FIGHTERS_REFRESH_S:
            try:
                self._fighters = await self._arena.list_fighters()
                self._fighters_at = time.monotonic()
            except Exception as error:
                logger.warning("[show] fighter registry unavailable: %s", error)
        return self._fighters

    async def _find_fighter(self, query: str) -> dict | None:
        q = query.strip().lower()
        fighters = await self._registry()
        exact = [f for f in fighters if f["name"].lower() == q]
        if exact:
            return exact[-1]
        partial = [f for f in fighters if q in f["name"].lower()]
        return partial[-1] if len(partial) == 1 else (partial[-1] if partial else None)

    def _queue_line(self) -> str:
        if not self.queue:
            return "The queue is empty — !fight <fighter> to be next."
        return "Queue: " + " · ".join(f"{e.handle} as {e.fighter['name']}" for e in self.queue[:8])

    @staticmethod
    def _side_payload(side: Contestant) -> dict:
        return {
            "playerId": side.player_id,
            "fighter": side.fighter,
            "health": side.health,
            "prompt": {"playerId": side.player_id, "text": side.attack or _DEFAULT_ATTACK,
                       "submittedAt": int(time.time() * 1000)},
        }

    async def _say(self, text: str, *, kind: str = "system", handle: str = "Arena") -> None:
        logger.info("[chat:%s] %s", kind, text)
        await self._arena.say(text, kind=kind, handle=handle)

    def show_state(self) -> dict:
        fight = self.fight
        return {
            "program": self.program if self._link.connected else "offline",
            "updatedAt": int(time.time() * 1000),
            "nowPlaying": self.now_playing,
            "fight": None if not fight else {
                "id": fight.id,
                "a": self._contestant_state(fight.a),
                "b": self._contestant_state(fight.b),
                "round": fight.round,
                "maxRounds": fight.max_rounds,
                "roundState": fight.round_state,
                "deadlineAt": int(fight.deadline_at * 1000) if fight.deadline_at else None,
                "narration": fight.narration,
                "winnerHandle": fight.winner.handle if fight.winner else None,
            },
            "queue": [{"handle": e.handle, "fighterName": e.fighter["name"]} for e in self.queue],
            "queued": {"building": self._link.generation_queued, "ready": self._link.playout_queued},
        }

    @staticmethod
    def _contestant_state(side: Contestant) -> dict:
        return {
            "handle": side.handle, "playerId": side.player_id, "fighter": side.fighter,
            "health": side.health, "attacked": side.attack is not None,
        }
