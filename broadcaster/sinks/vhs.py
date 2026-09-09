"""Bounded ntsc-rs segment processor. Audio bypasses the effect, paired with video.

Capture and processing run in separate threads. The calling pacer clocks output;
while waiting for a processed segment it repeats the last picture with silence.
No disk I/O, subprocess wait, or image scaling runs in a media callback.
"""
from __future__ import annotations
import asyncio
import logging
import queue
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import numpy as np
from PIL import Image
from .base import StreamSink, VideoFormat, AudioFormat

logger = logging.getLogger(__name__)


class VhsSink(StreamSink):
    def __init__(self, downstream: StreamSink, executable: str, preset: str, seconds: int = 8):
        self.downstream, self.executable, self.preset = downstream, executable, preset
        self.seconds = seconds
        self._stop = threading.Event()
        self._error = None
        self._processes = set()
        self._lock = threading.Lock()
        self._threads = []
        self._temp = None
        self._pending_video = None
        self._current = None
        self._position = 0
        self.frames_out = 0
        self.hold_ticks = 0
        self._started_at = None

    async def start(self, video: VideoFormat, audio: AudioFormat):
        if not shutil.which(self.executable) or not Path(self.preset).is_file():
            raise ValueError("VHS requires an installed NTSC_RS_CLI and readable VHS_PRESET")
        if audio.channels != 1 or audio.sample_rate % video.fps:
            raise ValueError("VHS expects mono audio with an integer samples-per-frame ratio")
        self.video, self.audio = video, audio
        self.output = VideoFormat(round(video.width * 480 / video.height / 2) * 2, 480, video.fps)
        self._n = video.fps * self.seconds
        self._samples = audio.sample_rate // video.fps
        self._input = queue.Queue(maxsize=video.fps * 2)
        self._jobs = queue.Queue(maxsize=2)
        self._ready = queue.Queue(maxsize=2)
        self._last = np.zeros((480, self.output.width, 3), dtype=np.uint8)
        self._silence = np.zeros(self._samples, dtype=np.int16)
        self._temp = tempfile.TemporaryDirectory(prefix="arena-vhs-")
        try:
            await self.downstream.start(self.output, audio)
            for fn in (self._capture, self._process):
                thread = threading.Thread(target=self._guard, args=(fn,), daemon=True)
                self._threads.append(thread)
                thread.start()
            self._started_at = time.monotonic()
        except BaseException:
            await self.stop()
            raise

    def _guard(self, fn):
        try:
            fn()
        except Exception as error:
            if not self._stop.is_set():
                self._error = error
                logger.error("[vhs] worker failed: %s", error)

    def _get(self, q):
        while not self._stop.is_set():
            try:
                return q.get(timeout=0.2)
            except queue.Empty:
                pass
        return None

    def _put(self, q, value):
        while not self._stop.is_set():
            try:
                q.put(value, timeout=0.2)
                return
            except queue.Full:
                pass

    def _command(self, args):
        with self._lock:
            if self._stop.is_set():
                raise RuntimeError("VHS stopped")
            process = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            self._processes.add(process)
        try:
            try:
                _, error = process.communicate(timeout=60)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate()
                raise RuntimeError("VHS processor exceeded 60-second deadline")
            if process.returncode:
                raise RuntimeError(f"VHS media command failed ({process.returncode}): {error.decode(errors='replace')[-500:]}")
        finally:
            with self._lock:
                self._processes.discard(process)

    def _capture(self):
        sequence = 0
        while not self._stop.is_set():
            directory = Path(self._temp.name) / str(sequence)
            directory.mkdir()
            audio = []
            with (directory / "source.rgb").open("wb") as output:
                for _ in range(self._n):
                    item = self._get(self._input)
                    if item is None:
                        return
                    frame, samples = item
                    small = Image.fromarray(frame).resize((self.output.width, 480), Image.Resampling.BILINEAR)
                    output.write(small.tobytes())
                    audio.append(samples)
            self._put(self._jobs, (directory, np.concatenate(audio)))
            sequence += 1

    def _process(self):
        while not self._stop.is_set():
            job = self._get(self._jobs)
            if job is None:
                return
            directory, samples = job
            start = time.monotonic()
            source, encoded, processed, raw = [directory / name for name in ("source.rgb", "input.mp4", "vhs.mp4", "output.rgb")]
            self._command(["ffmpeg", "-v", "error", "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", f"{self.output.width}x480", "-framerate", str(self.video.fps), "-i", str(source), "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "16", "-pix_fmt", "yuv420p", str(encoded)])
            self._command([self.executable, "-i", str(encoded), "-o", str(processed), "-p", self.preset, "-n", "--codec", "h264", "--quality", "27", "--encoding-speed", "8", "--chroma-subsampling"])
            self._command(["ffmpeg", "-v", "error", "-i", str(processed), "-an", "-f", "rawvideo", "-pix_fmt", "rgb24", str(raw)])
            frames = np.fromfile(raw, dtype=np.uint8)
            frame_size = self.output.width * 480 * 3
            if frames.size % frame_size or not self._n <= frames.size // frame_size <= self._n + 1:
                raise RuntimeError("VHS changed the segment frame count")
            frames = frames.reshape(-1, 480, self.output.width, 3)[:self._n]
            shutil.rmtree(directory)
            elapsed = time.monotonic() - start
            logger.info("[vhs] processed %.1fs segment in %.2fs", self.seconds, elapsed)
            self._put(self._ready, (frames, samples.reshape(self._n, self._samples)))

    def send_video(self, frame):
        self._pending_video = frame

    def send_audio(self, samples):
        if self._error:
            raise RuntimeError("VHS processing failed; see worker log") from self._error
        if self._pending_video is None or samples.size != self._samples:
            raise ValueError("VHS requires paired video/audio ticks")
        try:
            self._input.put_nowait((self._pending_video.copy(), samples.copy()))
        except queue.Full:
            raise RuntimeError("VHS cannot keep up: input buffer full")
        self._pending_video = None
        if self._current is None:
            try:
                self._current = self._ready.get_nowait()
                self._position = 0
                if not self.frames_out:
                    logger.info("[vhs] first processed output after %.2fs", time.monotonic() - self._started_at)
            except queue.Empty:
                self.hold_ticks += 1
                if self.frames_out and self.hold_ticks % self.video.fps == 0:
                    logger.warning("[vhs] output waiting for processing; holding picture and silence")
                self.downstream.send_video(self._last)
                self.downstream.send_audio(self._silence)
                return
        frames, audio = self._current
        self._last = frames[self._position]
        self.downstream.send_video(self._last)
        self.downstream.send_audio(audio[self._position])
        self.frames_out += 1
        self._position += 1
        if self._position == self._n:
            self._current = None

    @property
    def alive(self):
        return self._error is None and self.downstream.alive

    async def stop(self):
        self._stop.set()
        with self._lock:
            for process in self._processes:
                process.kill()
        for thread in self._threads:
            await asyncio.to_thread(thread.join)
        self._threads.clear()
        await self.downstream.stop()
        if self._temp:
            self._temp.cleanup()
            self._temp = None
