"""HLS sink: encode the paced stream with ffmpeg into HLS and serve it.

This is how the arena streams itself, with no third-party platform in the
loop. ffmpeg writes a rolling HLS playlist plus short fMP4 segments into a
directory; a small aiohttp server serves that directory with CORS so the
web app's /watch page can play it with hls.js from any origin. Put a CDN or
reverse proxy in front for real audiences; point the web app's
NEXT_PUBLIC_STREAM_URL at the playlist.

The pipe and restart discipline is the RTMP sink's (see `rtmp.py`'s
docstring for the learnings): raw rgb24 video on stdin, int16 audio on an
inherited pipe, one writer thread per pipe behind a bounded drop-oldest
queue, a lazy rate-limited restart when ffmpeg dies. Only the output half
differs: `-f hls` with `delete_segments`, so the directory never grows.
"""

from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path

from aiohttp import web

from .base import AudioFormat, VideoFormat
from .rtmp import RtmpSink

logger = logging.getLogger(__name__)

PLAYLIST = "live.m3u8"


class HlsSink(RtmpSink):
    """ffmpeg → HLS directory, served over HTTP with CORS."""

    def __init__(
        self,
        directory: str,
        port: int,
        segment_seconds: int = 2,
        video_bitrate_k: int = 4500,
    ) -> None:
        if shutil.which("ffmpeg") is None:
            raise RuntimeError("ffmpeg not found on PATH; install it first")
        self._dir = Path(directory)
        self._port = port
        self._segment_s = max(1, segment_seconds)
        self._runner: web.AppRunner | None = None
        # RtmpSink's url is what the encoder writes to; for us the playlist.
        super().__init__(str(self._dir / PLAYLIST), video_bitrate_k=video_bitrate_k)

    # --------------------------------------------------------------- serve

    async def start(self, video: VideoFormat, audio: AudioFormat) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)
        for stale in self._dir.glob("*"):
            if stale.suffix in (".m3u8", ".m4s", ".mp4", ".ts"):
                stale.unlink(missing_ok=True)
        await self._serve()
        await super().start(video, audio)

    async def _serve(self) -> None:
        app = web.Application(middlewares=[_cors])
        app.router.add_get("/", self._index)
        app.router.add_static("/", str(self._dir), show_index=False)
        self._runner = web.AppRunner(app, access_log=None)
        await self._runner.setup()
        site = web.TCPSite(self._runner, "0.0.0.0", self._port)
        await site.start()
        logger.info("[hls] serving %s on http://0.0.0.0:%d/%s", self._dir, self._port, PLAYLIST)

    async def _index(self, _request: web.Request) -> web.Response:
        return web.Response(text=f"infinite-arena hls: /{PLAYLIST}\n")

    async def stop(self) -> None:
        await super().stop()
        if self._runner:
            await self._runner.cleanup()

    # -------------------------------------------------------------- encode

    def _spawn_ffmpeg(self) -> None:  # noqa: C901 — mirrors RtmpSink, HLS output
        import collections
        import subprocess
        import threading
        import time

        assert self._video is not None and self._audio is not None
        video, audio = self._video, self._audio
        self._last_start_attempt = time.monotonic()

        audio_read_fd, audio_write_fd = os.pipe()
        cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "warning",
            "-f", "rawvideo", "-pix_fmt", "rgb24",
            "-s", f"{video.width}x{video.height}", "-r", str(video.fps),
            "-i", "pipe:0",
            "-f", "s16le", "-ar", str(audio.sample_rate), "-ac", str(audio.channels),
            "-i", f"pipe:{audio_read_fd}",
            "-map", "0:v", "-map", "1:a",
            "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
            "-pix_fmt", "yuv420p",
            "-g", str(video.fps * self._segment_s),  # one keyframe per segment
            "-keyint_min", str(video.fps * self._segment_s), "-sc_threshold", "0",
            "-b:v", f"{self._bitrate_k}k",
            "-maxrate", f"{int(self._bitrate_k * 1.2)}k", "-bufsize", f"{self._bitrate_k * 2}k",
            "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
            # --- HLS output: rolling window, segments deleted as they age out ---
            "-f", "hls",
            "-hls_time", str(self._segment_s),
            "-hls_list_size", "6",
            "-hls_flags", "delete_segments+independent_segments+omit_endlist",
            "-hls_segment_type", "fmp4",
            "-hls_fmp4_init_filename", "init.mp4",
            "-hls_segment_filename", str(self._dir / "seg_%05d.m4s"),
            str(self._dir / PLAYLIST),
        ]
        try:
            self._process = subprocess.Popen(
                cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE, pass_fds=(audio_read_fd,),
            )
        except Exception:
            os.close(audio_write_fd)
            raise
        finally:
            os.close(audio_read_fd)

        self._audio_write_fd = audio_write_fd
        audio_pipe = os.fdopen(audio_write_fd, "wb", buffering=0)
        assert self._video_writer and self._audio_writer
        self._video_writer.attach(self._process.stdin)
        self._audio_writer.attach(audio_pipe)
        self._stderr_tail = collections.deque(maxlen=40)
        threading.Thread(
            target=self._drain_stderr, args=(self._process,), daemon=True, name="hls-stderr",
        ).start()
        logger.info(
            "[hls] ffmpeg started: %dx%d@%dfps → %s (%ds segments)",
            video.width, video.height, video.fps, self._dir / PLAYLIST, self._segment_s,
        )


@web.middleware
async def _cors(request: web.Request, handler):
    if request.method == "OPTIONS":
        response = web.Response(status=204)
    else:
        response = await handler(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "*"
    # Playlists must never be cached by a browser or proxy; segments may be.
    if request.path.endswith(".m3u8"):
        response.headers["Cache-Control"] = "no-store"
    return response
