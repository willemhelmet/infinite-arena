import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from narration import NarrationMixer
from test_show import FakeLink, FakeArena, make_show
import test_show


class MixerTests(unittest.TestCase):
    def test_duck_saturate_and_resume_without_mutating_background(self):
        mixer = NarrationMixer()
        background = np.array([20000, -20000, 10000], dtype=np.int16)
        mixer.start(np.array([32000, -32000], dtype=np.int16))
        np.testing.assert_array_equal(mixer.mix(background), [32767, -32768, 10000])
        np.testing.assert_array_equal(background, [20000, -20000, 10000])
        np.testing.assert_array_equal(mixer.mix(background), background)

    def test_replacement_and_cancellation_do_not_leak_old_speech(self):
        mixer = NarrationMixer()
        mixer.start(np.array([10, 20, 30], dtype=np.int16))
        np.testing.assert_array_equal(mixer.mix(np.zeros(1, dtype=np.int16)), [10])
        mixer.start(np.array([99], dtype=np.int16))
        np.testing.assert_array_equal(mixer.mix(np.zeros(2, dtype=np.int16)), [99, 0])
        mixer.start(np.array([42], dtype=np.int16))
        mixer.clear()
        np.testing.assert_array_equal(mixer.mix(np.zeros(1, dtype=np.int16)), [0])


class SpeechShowTests(unittest.IsolatedAsyncioTestCase):
    async def test_prepared_before_enqueue_and_started_once_without_chat_delay(self):
        link, arena = FakeLink(), FakeArena()
        show = make_show(link, arena, playback_delay_s=12)
        mixer = NarrationMixer()
        async def prepare(*args):
            self.assertEqual(link.generation_clips, [])
            return [np.array([i, i], dtype=np.int16) for i in range(1, 13)]
        show._narrator = AsyncMock()
        show._narrator.prepare.side_effect = prepare
        show._narration_mixer = mixer
        await test_show.ShowTests.pair(self, show)
        while link.generation_clips:
            link.build()
        await show._tick()
        clip = link.start()
        np.testing.assert_array_equal(mixer.mix(np.zeros(1, dtype=np.int16)), [1])
        link.emit("clip_started", clip)
        self.assertEqual(mixer.position, 1)
        self.assertFalse(any(k == "narrator" for k, _ in arena.said))
        link.connected = False
        await show._tick()
        self.assertEqual(mixer.samples.size, 0)

    async def test_fish_failure_never_enqueues_video(self):
        link, arena = FakeLink(), FakeArena()
        show = make_show(link, arena)
        show._narrator = AsyncMock()
        show._narrator.prepare.side_effect = RuntimeError("Fish unavailable")
        await test_show.ShowTests.pair(self, show)
        self.assertEqual(link.generation_clips, [])
        self.assertIsNone(show.fight)

class FishPreparationTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_decoder_resamples_and_fits_speech_and_selects_both_voices(self):
        import io
        import wave
        from narration import FishNarrator
        from unittest.mock import MagicMock
        stream = io.BytesIO()
        with wave.open(stream, 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(44100)
            tone = (np.sin(np.arange(44100) * 2 * np.pi * 440 / 44100) * 10000).astype('<i2')
            wav.writeframes(tone.tobytes())
        class Content:
            async def iter_chunked(self, size):
                yield stream.getvalue()
        class Response:
            status = 200
            content = Content()
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
        session = MagicMock()
        session.post.return_value = Response()
        narrator = FishNarrator('not-a-secret', ('voice-a', 'voice-b'), 's2-pro')
        for speaker in (0, 1):
            pcm = await narrator.synthesize(session, 'Test line', speaker, 1.2)
            self.assertEqual(pcm.dtype, np.dtype('int16'))
            self.assertLessEqual(pcm.size, 48000 * 1.2)
            self.assertGreater(pcm.size, 30000)
            self.assertEqual(session.post.call_args.kwargs['json']['reference_id'], narrator.voices[speaker])
        with self.assertRaisesRegex(ValueError, 'too long'):
            await narrator.synthesize(session, 'Long line', 0, 0.8)


class FighterDialogueTests(unittest.IsolatedAsyncioTestCase):
    async def test_dialogue_skips_fish_and_preserves_later_voice_and_full_h3_audio(self):
        from narration import FishNarrator
        narrator = FishNarrator("test", ("a", "b"), "s2-pro")
        narrator.synthesize = AsyncMock(return_value=np.array([100, 200], dtype=np.int16))
        shots = [
            {"seconds": 12, "narration": "First call."},
            {"seconds": 12, "narration": "Chat only.", "dialogue": {"speaker": "B", "text": "Try catching me!"}},
            {"seconds": 12, "narration": "Next call."},
            {"seconds": 12, "narration": "Analysis."},
        ]
        clips = await narrator.prepare(shots, 5.167, 14.375)
        self.assertEqual(len(clips), 4)
        self.assertEqual(clips[1].size, 0)
        self.assertEqual(narrator.synthesize.await_count, 3)
        self.assertEqual([call.args[2] for call in narrator.synthesize.await_args_list], [0, 0, 1])
        mixer = NarrationMixer()
        mixer.start(clips[0])
        mixer.start(clips[1])
        h3 = np.array([1234, -2345], dtype=np.int16)
        np.testing.assert_array_equal(mixer.mix(h3), h3)


class EndOfClipAudioTests(unittest.IsolatedAsyncioTestCase):
    async def test_normal_finish_drains_speech_but_abort_clears_it(self):
        link, arena = FakeLink(), FakeArena()
        show = make_show(link, arena, playback_delay_s=12)
        mixer = NarrationMixer()
        show._narration_mixer = mixer
        await test_show.ShowTests.pair(self, show)
        while link.generation_clips:
            link.build()
        await show._tick()
        link.start()
        mixer.start(np.array([100, 200], dtype=np.int16))
        link.finish()
        np.testing.assert_array_equal(mixer.mix(np.zeros(1, dtype=np.int16)), [100])
        await show._abort_episode("test")
        self.assertEqual(mixer.samples.size, 0)
