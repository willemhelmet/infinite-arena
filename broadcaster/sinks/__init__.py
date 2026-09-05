"""Output sinks. `make_sink` is the one place a sink name maps to a class.

hls  — the arena streams itself: ffmpeg → HLS directory + a small HTTP server
       the web app's /watch page plays from (default).
rtmp — push to any RTMP ingest instead (a MediaMTX/nginx-rtmp you run, or a
       platform); kept from the upstream client, not used by default.
noop — discard everything; the full pipeline runs without an encoder.
"""

from __future__ import annotations

from .base import AudioFormat, StreamSink, VideoFormat
from .noop import NoOpSink
from .rtmp import RtmpSink

__all__ = ["AudioFormat", "NoOpSink", "RtmpSink", "StreamSink", "VideoFormat", "make_sink"]


def make_sink(
    name: str,
    *,
    hls_dir: str = "./hls",
    hls_port: int = 8088,
    hls_segment_s: int = 2,
    rtmp_url: str | None = None,
    video_bitrate_k: int = 4500,
) -> StreamSink:
    if name == "noop":
        return NoOpSink()
    if name == "hls":
        from .hls import HlsSink

        return HlsSink(hls_dir, hls_port, segment_seconds=hls_segment_s, video_bitrate_k=video_bitrate_k)
    if name == "rtmp":
        if not rtmp_url:
            raise ValueError("the rtmp sink needs an RTMP URL")
        return RtmpSink(rtmp_url, video_bitrate_k=video_bitrate_k)
    raise ValueError(f"unknown sink {name!r}")
