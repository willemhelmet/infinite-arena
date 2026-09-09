"""Audio underflow must include partial ticks, not just empty buffers."""
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pacer import Pacer
from sinks import AudioFormat, VideoFormat

class PacerAudioTests(unittest.TestCase):
    def test_counts_partial_and_full_underflow_separately_from_drops(self):
        pacer = Pacer(Mock(), VideoFormat(width=2, height=2, fps=24), AudioFormat(sample_rate=48000, channels=1))
        pacer.submit_audio(np.full(500, 42, dtype=np.int16))
        mixed = pacer._pull_audio_tick()
        self.assertEqual(mixed.size, 2000)
        np.testing.assert_array_equal(mixed[:500], 42)
        np.testing.assert_array_equal(mixed[500:], 0)
        self.assertEqual(pacer.underflow_samples, 1500)
        self.assertEqual(pacer.silent_ticks, 0)
        pacer._pull_audio_tick()
        self.assertEqual(pacer.underflow_samples, 3500)
        self.assertEqual(pacer.silent_ticks, 1)
        self.assertEqual(pacer.dropped_samples, 0)
