"""Director behavior with simulated H3: queueing, continuity, playback and recovery."""
import asyncio
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import show as show_module
from show import Show


class FakeLink:
    def __init__(self):
        self.connected = True
        self.min_seconds, self.max_seconds = 5.167, 14.375
        self.generation_capacity, self.playout_capacity = 20, 20
        self.generation_clips, self.playout_clips = [], []
        self.listeners, self.commands = [], []
        self.autoplay = True
        self.playing = None
        self._n = 0

    @property
    def generation_queued(self):
        return len(self.generation_clips)

    @property
    def playout_queued(self):
        return len(self.playout_clips)

    def add_listener(self, fn):
        self.listeners.append(fn)

    def emit(self, kind, clip):
        for fn in self.listeners:
            fn(kind, {"clip": clip})

    async def send_command(self, command, data):
        self.commands.append((command, data))
        if command == "enqueue":
            self._n += 1
            clip = {**data, "clip_id": f"clip-{self._n}", "ready": False}
            self.generation_clips.append(clip)
            return {"clip": clip}
        if command == "set_autoplay":
            self.autoplay = data["enabled"]
        if command == "pop":
            for queue in (self.generation_clips, self.playout_clips):
                for clip in queue:
                    if clip["clip_id"] == data["clip_id"]:
                        queue.remove(clip)
                        return {"clip": clip}
        if command == "stop" and self.playing:
            self.emit("clip_stopped", self.playing)
            self.playing = None
        return {}

    def build(self):
        if self.generation_clips and len(self.playout_clips) < self.playout_capacity:
            clip = self.generation_clips.pop(0)
            clip["ready"] = True
            self.playout_clips.append(clip)
            self.emit("clip_generated", clip)

    def start(self):
        assert self.autoplay and not self.playing
        self.playing = self.playout_clips.pop(0)
        self.emit("clip_started", self.playing)
        return self.playing

    def finish(self):
        assert self.playing
        clip, self.playing = self.playing, None
        self.emit("clip_finished", clip)
        return clip


class FakeArena:
    def __init__(self):
        self.said, self.published, self.plans = [], [], []

    async def read_chat(self, since):
        return since, []

    async def say(self, text, *, kind="system", handle="Arena"):
        self.said.append((kind, text))

    async def publish_show(self, state):
        self.published.append(state)

    async def episode(self, payload):
        self.plans.append(payload)
        return {"winner": "A", "ending": f"{payload['a']} wins!", "setting": "test arena",
            "shots": [{"prompt": f"Hard cut to scene {i}.", "title": f"Beat {i}", "seconds": 12, "narration": f"Tactic {i}."} for i in range(1, 13)]}


def make_show(link, arena, **kw):
    return Show(link, arena, arena_name="Test Arena", idle_queue_target=2,
                chat_poll_s=0.1, playback_delay_s=kw.get("playback_delay_s", 0))


def chat(handle, text, player=None):
    return {"kind": "user", "handle": handle, "playerId": player or handle, "text": text, "seq": 1}


class ShowTests(unittest.IsolatedAsyncioTestCase):
    async def pair(self, show):
        await show._on_chat(chat("alice", "#fight sentient turtle monk"))
        await show._on_chat(chat("bob", "#fight 1000 gerbils"))
        await show._tick()

    async def air(self, show, link):
        while link.generation_clips:
            link.build()
        await show._tick()
        while link.playout_clips:
            link.start()
            await show._tick()
            link.finish()
            await show._tick()

    async def test_two_text_entries_complete_episode_then_next_pair(self):
        link, arena = FakeLink(), FakeArena()
        show = make_show(link, arena)
        await self.pair(show)
        first = show.fight.id
        self.assertEqual(arena.plans[0]["a"], "sentient turtle monk")
        self.assertEqual(arena.plans[0]["b"], "1000 gerbils")
        self.assertEqual(show.fight.state, "buffering")
        # No registry, portrait, attack, or additional input is involved.
        await show._on_chat(chat("carol", "#fight a paper dragon"))
        await show._on_chat(chat("dave", "#fight a librarian"))
        await self.air(show, link)
        self.assertIsNone(show.fight)
        self.assertTrue(any("VERDICT — sentient turtle monk wins!" in t for _, t in arena.said))
        await show._tick()
        self.assertNotEqual(show.fight.id, first)
        self.assertEqual(show.fight.a.handle, "carol")

    async def test_chain_and_two_clip_buffer_and_reveal_after_final_completion(self):
        link, arena = FakeLink(), FakeArena()
        show = make_show(link, arena, playback_delay_s=12)
        await self.pair(show)
        clips = list(link.generation_clips)
        self.assertNotIn("continue_from_clip_id", clips[0])
        for index, (before, after) in enumerate(zip(clips, clips[1:]), 2):
            if index in (3, 5):
                self.assertNotIn("continue_from_clip_id", after)
            else:
                self.assertEqual(after["continue_from_clip_id"], before["clip_id"])
        link.build()
        await show._tick()
        self.assertFalse(link.autoplay)
        link.build()
        await show._tick()
        self.assertTrue(link.autoplay)
        while link.generation_clips:
            link.build()
        for i in range(12):
            link.start()
            await show._tick()
            self.assertEqual(show.fight.beat, i + 1)
            self.assertNotIn("winner", json.dumps(show.show_state()))
            self.assertFalse(any("VERDICT" in t for _, t in arena.said))
            link.finish()
            await show._tick()
        self.assertIsNotNone(show.fight)
        self.assertFalse(any("VERDICT" in t for _, t in arena.said))
        show.fight.verdict_at -= 13
        await show._tick()
        self.assertIsNone(show.fight)
        self.assertEqual(sum("VERDICT" in t for _, t in arena.said), 1)
        # Duplicate old events never trigger another outcome.
        link.emit("clip_finished", clips[-1])
        await show._tick()
        self.assertEqual(sum("VERDICT" in t for _, t in arena.said), 1)

    async def test_commentary_waits_for_playback_delay_and_ignores_duplicate_events(self):
        link, arena = FakeLink(), FakeArena()
        show = make_show(link, arena, playback_delay_s=12)
        await self.pair(show)
        while link.generation_clips:
            link.build()
        await show._tick()
        self.assertFalse(any(k == "narrator" for k, _ in arena.said))
        clip = link.start()
        await show._tick()
        self.assertFalse(any(k == "narrator" for k, _ in arena.said))
        due, scene, line = show.fight.narration_due[clip["clip_id"]]
        show.fight.narration_due[clip["clip_id"]] = (due - 13, scene, line)
        link.emit("clip_started", clip)
        await show._tick()
        link.emit("clip_started", clip)
        await show._tick()
        self.assertEqual([t for k, t in arena.said if k == "narrator"], ["Tactic 1."])
        link.finish()
        link.start()
        await show._abort_episode("Test cancellation")
        await show._tick()
        self.assertEqual(sum(k == "narrator" for k, _ in arena.said), 1)

    async def test_aliases_duplicates_locked_pair_and_pending_leave(self):
        link, arena = FakeLink(), FakeArena()
        show = make_show(link, arena)
        await show._on_chat(chat("alice", "%FiGhT turtle"))
        await show._on_chat(chat("renamed", "!fight something else", "alice"))
        self.assertEqual(len(show.queue), 1)
        await show._on_chat(chat("bob", "!fight gerbils"))
        await show._tick()
        await show._on_chat(chat("alice", "#leave"))
        self.assertEqual(show.fight.a.description, "turtle")
        await show._on_chat(chat("alice", "#fight a future turtle"))
        await show._on_chat(chat("alice", "#leave"))
        self.assertEqual(show.queue, [])
        self.assertEqual(show.fight.a.description, "turtle")
        await show._on_chat(chat("alice", "#fight"))
        self.assertEqual(show.queue, [])

    async def test_planning_does_not_block_chat(self):
        link, arena = FakeLink(), FakeArena()
        show = make_show(link, arena)
        entered, release = asyncio.Event(), asyncio.Event()
        original = arena.episode
        async def slow(payload):
            entered.set()
            await release.wait()
            return await original(payload)
        arena.episode = slow
        task = asyncio.create_task(self.pair(show))
        await entered.wait()
        await show._on_chat(chat("carol", "#fight lightning"))
        self.assertEqual(show.queue[0].handle, "carol")
        release.set()
        await task

    async def test_idle_needs_no_registry_and_cannot_interleave_episode(self):
        link, arena = FakeLink(), FakeArena()
        show = make_show(link, arena)
        await show._on_chat(chat("alice", "#prompt a wrestling stadium"))
        await show._enqueue_idle()
        self.assertIn("wrestling stadium", link.generation_clips[0]["prompt"])
        await self.pair(show)
        self.assertTrue(all(not json.loads(c["metadata"])["generated"] for c in link.generation_clips))
        await show._enqueue_idle()
        self.assertEqual(len(link.generation_clips), 12)
        await show._on_chat(chat("carol", "#prompt a lake"))
        self.assertEqual(show.setting, "a wrestling stadium")

    async def test_generation_failure_cleans_remaining_scenes_and_starts_next(self):
        link, arena = FakeLink(), FakeArena()
        show = make_show(link, arena)
        await self.pair(show)
        await show._on_chat(chat("carol", "#fight c"))
        await show._on_chat(chat("dave", "#fight d"))
        failed = link.generation_clips[2]
        link.emit("clip_failed", failed)
        await show._tick()
        self.assertIsNone(show.fight)
        self.assertEqual(link.generation_clips, [])
        self.assertFalse(any("VERDICT" in t for _, t in arena.said))
        await show._tick()
        self.assertEqual(show.fight.a.handle, "carol")

    async def test_partial_enqueue_is_aborted_without_duplicate_retry(self):
        link, arena = FakeLink(), FakeArena()
        original = link.send_command
        async def fail(command, data):
            if command == "enqueue" and link._n == 2:
                # Accepted, but its response was lost.
                await original(command, data)
                return None
            return await original(command, data)
        link.send_command = fail
        show = make_show(link, arena)
        await self.pair(show)
        self.assertIsNone(show.fight)
        self.assertEqual(link.generation_clips, [])
        self.assertEqual(link._n, 3)
        self.assertTrue(any("cancelled" in t for _, t in arena.said))

    async def test_timeout_cancels_without_fabricated_verdict(self):
        link, arena = FakeLink(), FakeArena()
        show = make_show(link, arena)
        await self.pair(show)
        show.fight.progress_at -= show_module._GATE_TIMEOUT_S + 1
        await show._tick()
        self.assertIsNone(show.fight)
        self.assertFalse(any("VERDICT" in t for _, t in arena.said))
        self.assertEqual(link.generation_clips, [])

    async def test_planner_retries_once_then_cancels(self):
        link, arena = FakeLink(), FakeArena()
        show = make_show(link, arena)
        with patch.object(arena, "episode", side_effect=RuntimeError("unavailable")) as planner:
            await self.pair(show)
            self.assertEqual(planner.call_count, 2)
        self.assertIsNone(show.fight)
        self.assertTrue(any("cancelled" in t for _, t in arena.said))

    async def test_reconnect_discards_interrupted_episode(self):
        link, arena = FakeLink(), FakeArena()
        show = make_show(link, arena)
        await self.pair(show)
        link.connected = False
        await show._tick()
        self.assertEqual(show.show_state()["program"], "offline")
        link.connected = True
        await show._tick()
        self.assertIsNone(show.fight)
        self.assertEqual(link.generation_clips, [])

    async def test_insufficient_capacity_never_queues_half_story(self):
        link, arena = FakeLink(), FakeArena()
        link.generation_capacity = 3
        show = make_show(link, arena)
        await self.pair(show)
        self.assertEqual(link.generation_clips, [])
        self.assertIsNone(show.fight)

    async def test_twelve_scenes_complete_with_ten_slot_playout_queue(self):
        link, arena = FakeLink(), FakeArena()
        link.playout_capacity = 10
        show = make_show(link, arena)
        await self.pair(show)
        for _ in range(40):
            link.build()
            if link.playing:
                link.finish()
            await show._tick()
            if link.autoplay and link.playout_clips:
                link.start()
            if not show.fight:
                break
        self.assertIsNone(show.fight)
        self.assertEqual(sum("VERDICT" in text for _, text in arena.said), 1)

    async def test_normal_chat_quiet_unknown_command_explained(self):
        link, arena = FakeLink(), FakeArena()
        show = make_show(link, arena)
        await show._on_chat(chat("alice", "hello"))
        self.assertEqual(arena.said, [])
        await show._on_chat(chat("alice", "#figth turtle"))
        self.assertIn("#help", arena.said[-1][1])


if __name__ == "__main__":
    unittest.main()
