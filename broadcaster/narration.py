"""Prepare Fish speech off the media path; mix mono PCM on the pacer's clock."""
from __future__ import annotations

import asyncio
import logging

import aiohttp
import numpy as np

SAMPLE_RATE = 48000
logger = logging.getLogger(__name__)


class NarrationMixer:
    """One bounded speech buffer. Clip changes replace it; aborts clear it."""

    def __init__(self, background_gain: float = 0.2):
        self.background_gain = background_gain
        self.clear()

    def clear(self):
        self.samples = np.empty(0, dtype=np.int16)
        self.position = 0

    def start(self, samples: np.ndarray):
        remaining = self.samples.size - self.position
        if remaining:
            logger.warning("[audio] next scene replaced %.2fs of unplayed commentary", remaining / SAMPLE_RATE)
        self.samples = samples
        self.position = 0

    def mix(self, background: np.ndarray) -> np.ndarray:
        count = min(background.size, self.samples.size - self.position)
        if count <= 0:
            return background
        result = background.astype(np.float32)
        result[:count] *= self.background_gain
        result[:count] += self.samples[self.position:self.position + count]
        self.position += count
        return np.clip(result, -32768, 32767).astype(np.int16)


class FishNarrator:
    def __init__(self, api_key: str, voices: tuple[str, str], model: str):
        self.api_key, self.voices, self.model = api_key, voices, model

    async def prepare(self, shots: list[dict], min_seconds: float, max_seconds: float):
        # Two requests at a time; all speech is ready before any episode enqueue.
        limit = asyncio.Semaphore(2)
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60)) as session:
            async def one(index, shot):
                # H3 owns the fighter line; no Fish request or background ducking.
                if shot.get("dialogue"):
                    logger.info("[audio] scene %d: announcer pause; %s says %r", index + 1, shot["dialogue"]["speaker"], shot["dialogue"]["text"])
                    return np.empty(0, dtype=np.int16)
                async with limit:
                    seconds = max(min_seconds, min(max_seconds, shot["seconds"]))
                    samples = await self.synthesize(session, shot["narration"], shot.get("announcer", index % 2), seconds)
                    logger.info("[audio] scene %d: %.2fs commentary / %.2fs scene", index + 1, samples.size / SAMPLE_RATE, seconds)
                    return samples
            tasks = [asyncio.create_task(one(i, shot)) for i, shot in enumerate(shots)]
            try:
                return await asyncio.wait_for(asyncio.gather(*tasks), 180)
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)

    async def synthesize(self, session, text: str, speaker: int, seconds: float):
        async with session.post("https://api.fish.audio/v1/tts",
                headers={"Authorization": f"Bearer {self.api_key}", "model": self.model},
                json={"text": text, "reference_id": self.voices[speaker],
                      "format": "wav", "sample_rate": 44100}) as response:
            if response.status != 200:
                # Error bodies can contain provider internals; never log credentials.
                raise RuntimeError(f"Fish speech request failed (HTTP {response.status})")
            chunks, size = [], 0
            async for chunk in response.content.iter_chunked(65536):
                size += len(chunk)
                if size > 10_000_000:
                    raise ValueError("Fish speech response exceeds the scene audio budget")
                chunks.append(chunk)
            audio = b"".join(chunks)
        # Decode first: streaming WAV headers may advertise an unknown length.
        samples = await self._decode(audio)
        duration = samples.size / SAMPLE_RATE
        speed = max(1.0, duration / (seconds - 0.4))
        if speed > 1.5:
            raise ValueError("Announcer line is too long for its scene; shorten the narration")
        if speed > 1:
            samples = await self._decode(samples.tobytes(), speed=speed, raw=True)
        if samples.size > int(seconds * SAMPLE_RATE):
            raise ValueError("Decoded narration exceeds scene duration")
        return samples

    @staticmethod
    async def _decode(audio: bytes, speed: float = 1, raw: bool = False):
        input_args = ["-f", "s16le", "-ar", str(SAMPLE_RATE), "-ac", "1"] if raw else []
        process = await asyncio.create_subprocess_exec(
            "ffmpeg", "-v", "error", *input_args, "-i", "pipe:0", "-af", f"atempo={speed}",
            "-ar", str(SAMPLE_RATE), "-ac", "1", "-f", "s16le", "pipe:1",
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE)
        try:
            pcm, _ = await asyncio.wait_for(process.communicate(audio), 15)
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()
        if process.returncode or not pcm:
            raise RuntimeError("Could not decode Fish speech with ffmpeg")
        return np.frombuffer(pcm, dtype="<i2").copy()
