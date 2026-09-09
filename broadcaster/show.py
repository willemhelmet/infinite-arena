"""Chat submissions → one complete story → chained H3 clips → next pair.

The director is the only queue writer. Episode clips take priority over idle
footage; autoplay starts after a two-clip buffer. Metadata echoes, including
completion of the final clip, drive episode progress. No portrait or move input
is required. Failed episodes are cleared without inventing a verdict.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from group_tag import is_generated, parse_group_tag

if TYPE_CHECKING:
    from arena_api import ArenaApi
    from reactor_link import ReactorLink

logger = logging.getLogger(__name__)
_TICK_S = 0.5
_GATE_TIMEOUT_S = 150.0
_COMMAND_TIMEOUT_S = 15.0
_EMPTY_ARENA_PROMPT = (
    "Hard cut to a wide establishing shot of an empty futuristic fighting arena. "
    "Circular stone floor beneath steel arches. Amber spotlights catch blue haze. "
    "Slow eye-level push-in. Stylized realism, crisp detail. "
    "Sound: crowd murmur, ventilation hum and a soft synth pulse."
)


@dataclass
class Contestant:
    handle: str
    player_id: str
    description: str


@dataclass
class Fight:
    id: str
    a: Contestant
    b: Contestant
    state: str = "preparing"
    beat: int = 0
    shots: list[dict] = field(default_factory=list)
    clips: list[str] = field(default_factory=list)
    completed: set[str] = field(default_factory=set)
    started: set[str] = field(default_factory=set)
    winner: Contestant | None = None
    ending: str = ""
    error: str | None = None
    progress_at: float = field(default_factory=time.monotonic)
    verdict_at: float | None = None
    announced: bool = False
    narration_due: dict[str, tuple[float, int, str]] = field(default_factory=dict)
    narrated: set[str] = field(default_factory=set)
    speech: list = field(default_factory=list)


class Show:
    def __init__(self, link: ReactorLink, arena: ArenaApi, *, arena_name: str,
                 idle_queue_target: int, chat_poll_s: float,
                 playback_delay_s: float = 12, narrator=None, narration_mixer=None) -> None:
        self._link, self._arena = link, arena
        self._narrator, self._narration_mixer = narrator, narration_mixer
        self._arena_name = arena_name
        self._idle_target = idle_queue_target
        self._chat_poll_s = chat_poll_s
        self._playback_delay_s = playback_delay_s
        self.output_delay = lambda: 0.0
        self.program = "idle"
        self.queue: list[Contestant] = []
        self.fight: Fight | None = None
        self.setting: str | None = None
        self.now_playing: str | None = None
        self.last_narration: str | None = None
        self._chat_seq: int | None = None
        self._enqueue_lock = asyncio.Lock()
        self._dirty = True
        self._playing_id: str | None = None
        self._autoplay: bool | None = None
        link.add_listener(self._on_model_message)

    async def _command(self, command: str, data: dict):
        reply = await asyncio.wait_for(self._link.send_command(command, data), _COMMAND_TIMEOUT_S)
        if isinstance(reply, dict) and reply.get("reason"):
            raise RuntimeError(f"{command} refused: {reply['reason']}")
        return reply

    async def _set_autoplay(self, enabled: bool) -> None:
        if self._autoplay != enabled:
            reply = await self._command("set_autoplay", {"enabled": enabled})
            if reply is None:
                raise RuntimeError("Could not set playback mode")
            self._autoplay = enabled

    async def run_chat(self) -> None:
        while True:
            try:
                if self._chat_seq is None:
                    self._chat_seq, _ = await self._arena.read_chat(0)
                else:
                    seq, messages = await self._arena.read_chat(self._chat_seq)
                    for message in messages:
                        self._chat_seq = max(self._chat_seq, int(message.get("seq", 0)))
                        if message.get("kind") == "user":
                            await self._on_chat(message)
                    self._chat_seq = max(self._chat_seq, seq)
            except Exception as error:
                logger.warning("[show] chat poll failed: %s", error)
            await asyncio.sleep(self._chat_poll_s)

    async def run_show(self) -> None:
        while True:
            await asyncio.sleep(_TICK_S)
            try:
                await self._tick()
            except Exception as error:
                logger.exception("[show] tick failed: %s", error)
                if self.fight:
                    self.fight.error = "The broadcast connection failed."

    async def run_publish(self) -> None:
        last = 0.0
        while True:
            await asyncio.sleep(0.5)
            if self._dirty or time.monotonic() - last >= 5:
                self._dirty = False
                last = time.monotonic()
                await self._arena.publish_show(self.show_state())

    async def run_idle(self) -> None:
        if self._idle_target <= 0:
            return
        while True:
            await asyncio.sleep(3)
            if not self._link.connected or self.fight or len(self.queue) >= 2:
                continue
            target = min(self._idle_target, max(1, self._link.playout_capacity - 1))
            if self._link.generation_queued + self._link.playout_queued < target:
                try:
                    await self._enqueue_idle()
                except Exception as error:
                    logger.warning("[show] idle fill failed: %s", error)

    async def _on_chat(self, message: dict) -> None:
        text = str(message.get("text", "")).strip()
        handle = str(message.get("handle", "someone"))
        player_id = str(message.get("playerId") or handle)
        parts = text.split(maxsplit=1)
        if not parts:
            return
        token = parts[0].lower()
        command = token.lstrip("#!%") if token[0] in "#!%" else ""
        arg = parts[1].strip() if len(parts) == 2 else ""
        if command == "fight":
            if not arg or len(arg) > 273:
                await self._say(f"{handle}: #fight <describe one contestant or swarm>, up to 273 characters.")
            elif any(e.player_id == player_id for e in self.queue):
                await self._say(f"{handle}, you're already in the queue. Use #leave before changing your entry.")
            else:
                self.queue.append(Contestant(handle, player_id, arg))
                suffix = " Waiting for an opponent." if len(self.queue) % 2 else " Pair filled."
                await self._say(f"{handle} enters as {arg} (#{len(self.queue)}).{suffix}")
                self._dirty = True
        elif command == "leave":
            before = len(self.queue)
            self.queue = [e for e in self.queue if e.player_id != player_id]
            await self._say(f"{handle} leaves the queue." if len(self.queue) < before else
                            f"{handle}, you have no pending entry. Paired contestants are locked.")
            self._dirty = True
        elif command == "queue":
            await self._say(self._queue_line())
        elif command == "prompt":
            if self.fight:
                await self._say(f"{handle}, change the arena setting between bouts.")
            elif not arg:
                await self._say("#prompt <arena setting> — for example, a 1990s wrestling stadium.")
            else:
                self.setting = arg[:273]
                await self._say(f"Arena setting updated: {self.setting}.")
        elif command == "help":
            await self._say("#fight <contestant or swarm> · two viewers fill a matchup and the full fight plays automatically. #queue · #leave · #prompt <arena setting>. !fight and %fight also work.")
        elif command == "attack":
            await self._say("Episodes play automatically from the two descriptions. Submit #fight <contestant> for a future matchup.")
        elif command:
            await self._say(f"{handle}, unknown command {token[:40]}. Use #help.")

    async def _tick(self) -> None:
        fight = self.fight
        if fight:
            if not self._link.connected:
                fight.error = "The video connection was interrupted."
                self._autoplay = None
            if fight.error:
                await self._abort_episode(fight.error)
                return
            if time.monotonic() - fight.progress_at > _GATE_TIMEOUT_S:
                await self._abort_episode("Video generation or playback timed out.")
                return
            if fight.state == "buffering":
                ready = {c["clip_id"] for c in self._link.playout_clips if c.get("ready")}
                buffer_size = min(2, self._link.playout_capacity, len(fight.clips))
                if buffer_size and all(c in ready for c in fight.clips[:buffer_size]):
                    # All filler was removed before enqueue. Chaining forces build
                    # order; autoplay can only play this episode in story order.
                    await self._set_autoplay(True)
            if fight.started and not fight.announced:
                fight.announced = True
                await self._say(f"ON AIR — {fight.a.description} vs {fight.b.description}.")
            for clip_id, (due, scene, narration) in list(fight.narration_due.items()):
                if time.monotonic() >= due and clip_id not in fight.narrated:
                    # Mark before sending: an ambiguous HTTP failure must not
                    # duplicate commentary. Never block the media callback.
                    fight.narrated.add(clip_id)
                    del fight.narration_due[clip_id]
                    try:
                        await self._say(narration, kind="narrator", handle=("Play-by-play" if fight.shots[scene - 1].get("announcer", (scene - 1) % 2) == 0 else "Analyst"))
                    except Exception as error:
                        logger.warning("[show] narration delivery failed: %s", error)
            if fight.verdict_at is not None and time.monotonic() >= fight.verdict_at:
                self.program = "verdict"
                fight.state = "finished"
                self.last_narration = fight.ending
                await self._say(f"VERDICT — {fight.ending}", kind="narrator", handle="Narrator")
                self.fight = None
                self.program = "idle"
                self._dirty = True
            return
        if not self._link.connected:
            self._autoplay = None
            return
        if len(self.queue) >= 2:
            await self._start_episode()
        else:
            await self._set_autoplay(True)

    async def _start_episode(self) -> None:
        a, b = self.queue.pop(0), self.queue.pop(0)
        fight = Fight(uuid.uuid4().hex[:12], a, b)
        self.fight = fight
        self.program = "card"
        self.last_narration = None
        self._dirty = True
        await self._say(f"PREPARING — {a.description} ({a.handle}) vs {b.description} ({b.handle}). Your descriptions are locked; the whole fight plays automatically.")
        try:
            plan = None
            for attempt in range(2):
                try:
                    plan = await self._arena.episode({"arenaName": self._arena_name,
                        "a": a.description, "b": b.description, "setting": self.setting})
                    if plan.get("winner") not in ("A", "B") or len(plan.get("shots", [])) != 12 or not plan.get("ending"):
                        raise ValueError("Incomplete episode plan")
                    break
                except Exception:
                    if attempt:
                        raise
                    await self._say("The narrator is retrying this matchup.")
            fight.shots = plan["shots"]
            fight.winner = a if plan["winner"] == "A" else b
            fight.ending = plan["ending"]
            if self._narrator:
                fight.speech = await self._narrator.prepare(fight.shots, self._link.min_seconds, self._link.max_seconds)
            await self._enqueue_episode(fight)
            fight.state = "buffering"
            fight.progress_at = time.monotonic()
            await self._say("Episode planned. Preparing the opening footage; new submissions join the next matchup.")
        except Exception as error:
            logger.warning("[show] episode preparation failed: %s", error)
            await self._abort_episode("This episode could not be prepared.")
        self._dirty = True

    async def _enqueue_episode(self, fight: Fight) -> None:
        async with self._enqueue_lock:
            await self._set_autoplay(False)
            await self._command("set_flush_on_clip_end", {"enabled": False})
            await self._clear_clips(filler=True)
            # Admission checks the actual deployment, never partially accepts a
            # story because the available capacity is smaller than the plan.
            if self._link.generation_capacity - self._link.generation_queued < len(fight.shots):
                raise RuntimeError("Not enough generation queue capacity for the episode")
            previous = None
            for index, shot in enumerate(fight.shots, 1):
                metadata = json.dumps({"group_id": fight.id, "fight_id": fight.id,
                    "kind": "episode", "title": shot["title"], "scene": index,
                    "scenes": len(fight.shots), "generated": False})
                payload = {"prompt": shot["prompt"], "metadata": metadata,
                    "seconds": max(self._link.min_seconds, min(self._link.max_seconds, shot["seconds"]))}
                if previous and index not in (3, 5):
                    payload["continue_from_clip_id"] = previous
                # A missing reply could mean accepted-but-unacknowledged. Do not
                # retry this mutation and risk duplicating a scene; abort instead.
                reply = await self._command("enqueue", payload)
                if not isinstance(reply, dict) or not reply.get("clip", {}).get("clip_id"):
                    raise RuntimeError(f"Scene {index} was not acknowledged")
                previous = reply["clip"]["clip_id"]
                fight.clips.append(previous)
                logger.info("[show] episode %s queued scene %d/%d (%s)", fight.id, index, len(fight.shots), previous)

    async def _clear_clips(self, *, filler: bool = False, fight_id: str | None = None) -> None:
        for clip in list(self._link.generation_clips) + list(self._link.playout_clips):
            tag = parse_group_tag(clip.get("metadata")) or {}
            if (filler and is_generated(clip)) or (fight_id and tag.get("fight_id") == fight_id):
                reply = await self._command("pop", {"clip_id": clip["clip_id"]})
                if reply is None:
                    raise RuntimeError("Could not clear queued footage")

    async def _abort_episode(self, reason: str) -> None:
        fight = self.fight
        if not fight:
            return
        # Keep the failed episode until cleanup is acknowledged. It must never
        # resume as stray footage ahead of the next pair after a reconnect.
        if self._narration_mixer:
            self._narration_mixer.clear()
        fight.error = reason
        fight.state = "failed"
        self._dirty = True
        if not self._link.connected:
            return
        try:
            await self._set_autoplay(False)
            if self._playing_id in fight.clips:
                await self._command("stop", {})
            await self._clear_clips(fight_id=fight.id)
        except Exception as error:
            logger.warning("[show] waiting to clear failed episode: %s", error)
            return
        await self._say(f"Episode cancelled: {reason} Moving to the next pair. You can submit #fight again.")
        self.fight = None
        self.program = "idle"
        self.now_playing = None
        self.last_narration = None
        self._dirty = True
        await self._set_autoplay(True)

    async def _enqueue_idle(self) -> None:
        async with self._enqueue_lock:
            if self.fight or len(self.queue) >= 2:
                return
            prompt = (f"Hard cut to a wide shot of {self.setting}. The arena awaits its challengers. "
                      "Slow eye-level push-in. Stylized realism. Sound: crowd murmur and a soft synth pulse.") if self.setting else _EMPTY_ARENA_PROMPT
            await self._command("enqueue", {"prompt": prompt, "seconds": max(self._link.min_seconds, min(self._link.max_seconds, 6)),
                "metadata": json.dumps({"group_id": uuid.uuid4().hex[:12], "kind": "idle",
                    "title": "The arena awaits", "scene": 1, "scenes": 1, "generated": True})})

    def _on_model_message(self, kind: str, data: dict) -> None:
        if kind == "state_update":
            self._autoplay = data.get("autoplay")
        clip = data.get("clip") if isinstance(data, dict) else None
        if not isinstance(clip, dict):
            return
        tag = parse_group_tag(clip.get("metadata", ""))
        clip_id = clip.get("clip_id")
        fight = self.fight
        ours = bool(fight and tag and tag.get("fight_id") == fight.id)
        if kind == "clip_started":
            self._playing_id = clip_id
            self.now_playing = f"{tag.get('title', '')} · {tag.get('scene')}/{tag.get('scenes')}" if tag else None
            if ours:
                scene = int(tag["scene"])
                if clip_id not in fight.started and 1 <= scene <= len(fight.shots):
                    if fight.speech and self._narration_mixer:
                        self._narration_mixer.start(fight.speech[scene - 1])
                    narration = fight.shots[scene - 1].get("narration")
                    if narration:
                        fight.narration_due[clip_id] = (time.monotonic() + self._playback_delay_s + self.output_delay(), scene, narration)
                fight.started.add(clip_id)
                fight.beat = int(tag["scene"])
                fight.state = "playing"
                self.program = "fight"
        elif kind in ("clip_finished", "clip_stopped"):
            if kind == "clip_stopped" and ours and self._playing_id == clip_id and self._narration_mixer:
                self._narration_mixer.clear()
            if self._playing_id == clip_id:
                self._playing_id = None
            if ours:
                if kind == "clip_stopped":
                    fight.error = "Episode playback was interrupted."
                else:
                    fight.completed.add(clip_id)
                    if fight.clips and fight.completed == set(fight.clips):
                        # Hold the reveal to allow for the downstream stream's
                        # delivery buffer. No winner is exposed in public state.
                        fight.verdict_at = time.monotonic() + self._playback_delay_s + self.output_delay()
        elif kind == "clip_failed" and ours:
            fight.error = "A scene failed to render."
        if ours and kind in ("clip_generated", "clip_started", "clip_finished"):
            logger.info("[show] episode %s scene %s/%d %s", fight.id, tag.get("scene"), len(fight.shots), kind)
            fight.progress_at = time.monotonic()
        self._dirty = True

    def _queue_line(self) -> str:
        if not self.queue:
            return "The queue is empty — #fight <contestant> to join."
        return "Queue: " + " · ".join(f"{e.handle}: {e.description[:60]}" for e in self.queue[:6])

    async def _say(self, text: str, *, kind: str = "system", handle: str = "Arena") -> None:
        logger.info("[chat:%s] %s", kind, text)
        await self._arena.say(text, kind=kind, handle=handle)

    def show_state(self) -> dict:
        fight = self.fight
        def side(c):
            return {"handle": c.handle, "playerId": c.player_id, "description": c.description}
        return {"program": self.program if self._link.connected else "offline",
            "updatedAt": int(time.time() * 1000), "nowPlaying": self.now_playing,
            "fight": None if not fight else {"id": fight.id, "a": side(fight.a), "b": side(fight.b),
                "state": fight.state, "beat": fight.beat, "beatCount": len(fight.shots) or 12},
            "queue": [{"handle": c.handle, "fighterName": c.description} for c in self.queue],
            "queued": {"building": self._link.generation_queued, "ready": self._link.playout_queued}}
