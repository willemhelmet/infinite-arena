"""The show director against fakes: a fake fast-h3 link and a fake arena.

Drives a full program cycle without a model, a network, or an encoder:
idle bios → two `!fight`s → card → gate → round 1 opens → both `!attack` →
coordinator → shots enqueued → gate → round 2 opens → the round clock runs
out → ... → verdict → idle. Run with `python -m unittest` from broadcaster/.
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import show as show_module  # noqa: E402
from show import Show  # noqa: E402


class FakeLink:
    """Just enough of ReactorLink: capacities, queues, enqueue/pop/move, listeners."""

    def __init__(self) -> None:
        self.connected = True
        self.min_seconds, self.max_seconds = 5.167, 14.375
        self.generation_capacity, self.playout_capacity = 20, 10
        self.generation_clips: list[dict] = []
        self.playout_clips: list[dict] = []
        self.listeners = []
        self.commands: list[tuple[str, dict]] = []
        self._n = 0

    @property
    def generation_queued(self):
        return len(self.generation_clips)

    @property
    def playout_queued(self):
        return len(self.playout_clips)

    def add_listener(self, fn):
        self.listeners.append(fn)

    async def send_command(self, command, data):
        self.commands.append((command, data))
        if command == "enqueue":
            self._n += 1
            clip = {"clip_id": f"clip-{self._n}", "metadata": data["metadata"], "ready": False,
                    "prompt": data["prompt"], "seconds": data.get("seconds", 6)}
            pos = data.get("position")
            if pos is None or pos >= len(self.generation_clips):
                self.generation_clips.append(clip)
            else:
                self.generation_clips.insert(pos, clip)
            return {"clip": clip}
        if command == "pop":
            for lst in (self.generation_clips, self.playout_clips):
                for c in lst:
                    if c["clip_id"] == data["clip_id"]:
                        lst.remove(c)
                        return {"clip": c}
            return None
        if command == "move":
            return {"clip": {}}
        return {}

    def start_group(self, group_id: str) -> None:
        """Pretend the first clip of a group went on air."""
        for c in list(self.generation_clips) + list(self.playout_clips):
            if json.loads(c["metadata"])["group_id"] == group_id:
                for fn in self.listeners:
                    fn("clip_started", {"clip": c})
                return
        raise AssertionError(f"no clip for group {group_id}")


class FakeArena:
    def __init__(self) -> None:
        self.said: list[tuple[str, str]] = []
        self.published: list[dict] = []
        self.resolves: list[dict] = []
        self.fighters = [
            {"id": "f1", "name": "Karg", "imageUrl": "https://x/k.png", "description": "a rusted titan", "createdBy": "p1"},
            {"id": "f2", "name": "Vesper", "imageUrl": "https://x/v.png", "description": "a holographic duelist", "createdBy": "p2"},
        ]

    async def read_chat(self, since):
        return since, []

    async def say(self, text, *, kind="system", handle="Arena"):
        self.said.append((kind, text))

    async def publish_show(self, state):
        self.published.append(state)

    async def list_fighters(self):
        return self.fighters

    async def resolve_round(self, payload):
        self.resolves.append(payload)
        a, b = payload["fighters"]
        return {
            "winnerPlayerId": a["playerId"],
            "damage": {a["playerId"]: 0, b["playerId"]: 60},
            "narration": f"{a['fighter']['name']} lands it clean.",
            "shots": [{"prompt": "Hard cut to a wide shot. Test.", "seconds": 6}],
            "setting": "a test pit",
        }

    async def program(self, payload):
        return {"caption": payload["kind"], "setting": "a test pit",
                "shots": [{"prompt": f"Hard cut to a wide shot of the {payload['kind']}.", "seconds": 6}]}


def tag_of(link: FakeLink, clip_id: str) -> dict:
    for c in link.generation_clips + link.playout_clips:
        if c["clip_id"] == clip_id:
            return json.loads(c["metadata"])
    raise AssertionError(clip_id)


def make_show(link, arena, **kw):
    return Show(link, arena, arena_name="Test Arena", idle_queue_target=2,
                round_seconds=kw.get("round_seconds", 60), max_rounds=kw.get("max_rounds", 3), chat_poll_s=1)


def chat(handle, text, player=None):
    return {"kind": "user", "handle": handle, "playerId": player or handle, "text": text, "seq": 1}


class ShowTests(unittest.IsolatedAsyncioTestCase):
    async def test_bio_filler_is_tagged_generated(self):
        link, arena = FakeLink(), FakeArena()
        show = make_show(link, arena)
        await show._enqueue_bio()
        self.assertEqual(len(link.generation_clips), 1)
        tag = tag_of(link, "clip-1")
        self.assertTrue(tag["generated"])
        self.assertEqual(tag["kind"], "bio")
        self.assertEqual(tag["title"], "Karg")

    async def test_full_fight_cycle(self):
        link, arena = FakeLink(), FakeArena()
        show = make_show(link, arena, max_rounds=2)
        await show._enqueue_bio()  # filler waiting in the generation queue

        # Two viewers queue up; a fight card is announced and enqueued ahead of filler.
        await show._on_chat(chat("alice", "!fight karg"))
        self.assertEqual(show.program, "idle")
        await show._on_chat(chat("bob", "!fight ves"))
        self.assertEqual(show.program, "card")
        self.assertIsNotNone(show.fight)
        first = tag_of(link, link.generation_clips[0]["clip_id"])
        self.assertEqual(first["kind"], "card", "fight clips insert ahead of filler")
        self.assertTrue(any("NEXT FIGHT" in t for _, t in arena.said))

        # Attacks before the round opens are refused.
        await show._on_chat(chat("alice", "!attack a punch"))
        self.assertTrue(any("isn't open" in t for _, t in arena.said))

        # The card goes on air → round 1 opens.
        link.start_group(show._awaiting_group)
        await show._tick()
        self.assertEqual(show.program, "fight")
        self.assertEqual(show.fight.round, 1)
        self.assertEqual(show.fight.round_state, "open")

        # Spectators can't attack; both fighters can, once each.
        await show._on_chat(chat("carol", "!attack a kick"))
        self.assertIsNone(show.fight.a.attack)
        await show._on_chat(chat("alice", "!attack a rusted haymaker"))
        await show._on_chat(chat("alice", "!attack again"))
        self.assertEqual(show.fight.a.attack, "a rusted haymaker")
        self.assertEqual(show.fight.round_state, "open")
        await show._on_chat(chat("bob", "!attack a flicker step"))

        # Both in → judged → shots enqueued → waiting for them to air.
        self.assertEqual(len(arena.resolves), 1)
        self.assertEqual(show.fight.round_state, "playing")
        self.assertEqual(show.fight.b.health, 40)
        self.assertTrue(any(k == "narrator" for k, _ in arena.said))
        self.assertIsNotNone(show._awaiting_group)
        round_tag = tag_of(link, link.generation_clips[0]["clip_id"]) if link.generation_clips else None
        self.assertIn(round_tag["kind"], ("round", "card"))

        # Round 1's clips air → round 2 opens; the clock runs out with only
        # one attack in → the missing side gets the default and it resolves.
        link.start_group(show._awaiting_group)
        await show._tick()
        self.assertEqual(show.fight.round, 2)
        await show._on_chat(chat("alice", "!attack finish it"))
        show.fight.deadline_at = time.time() - 1  # the clock ran out
        await show._tick()
        self.assertEqual(len(arena.resolves), 2)
        self.assertEqual(arena.resolves[1]["fighters"][1]["prompt"]["text"], show_module._DEFAULT_ATTACK)
        self.assertTrue(show.fight.finished)
        self.assertEqual(show.fight.winner.handle, "alice")

        # The last round airs → verdict enqueued → airs → idle, fight cleared.
        link.start_group(show._awaiting_group)
        await show._tick()
        self.assertEqual(show.program, "verdict")
        self.assertTrue(any("VERDICT" in t and "Karg" in t for _, t in arena.said))
        link.start_group(show._awaiting_group)
        await show._tick()
        self.assertEqual(show.program, "idle")
        self.assertIsNone(show.fight)

        state = show.show_state()
        self.assertEqual(state["program"], "idle")
        self.assertEqual(state["queue"], [])

    async def test_gate_timeout_advances(self):
        link, arena = FakeLink(), FakeArena()
        show = make_show(link, arena)
        await show._on_chat(chat("alice", "!fight karg"))
        await show._on_chat(chat("bob", "!fight vesper"))
        self.assertEqual(show.program, "card")
        show._awaiting_since -= show_module._GATE_TIMEOUT_S + 1
        await show._tick()
        self.assertEqual(show.program, "fight")
        self.assertEqual(show.fight.round_state, "open")

    async def test_queue_and_leave(self):
        link, arena = FakeLink(), FakeArena()
        show = make_show(link, arena)
        await show._on_chat(chat("alice", "!fight karg"))
        await show._on_chat(chat("alice", "!fight karg"))
        self.assertEqual(len(show.queue), 1)
        self.assertTrue(any("already in the queue" in t for _, t in arena.said))
        await show._on_chat(chat("alice", "!leave"))
        self.assertEqual(show.queue, [])
        await show._on_chat(chat("zed", "!fight nobody-here"))
        self.assertTrue(any("no fighter matches" in t for _, t in arena.said))
        self.assertEqual(show.show_state()["program"], "idle")


if __name__ == "__main__":
    unittest.main()
