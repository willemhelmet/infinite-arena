"""Infinite Arena broadcaster. See README.md for the full picture.

    arena chat (web app) ──▶ Show ──▶ coordinator (web app) ──▶ shots
                               │
                               ▼ enqueue (tagged groups) · move · pop
                          ReactorLink ◀──▶ fast-h3 (hosted or local)
                               │ frames / audio
                               ▼
                             Pacer ──▶ Overlay ──▶ Sink (hls | rtmp | noop)

One asyncio process. The pacer and sink are created after the first
`state_update` (the deployment's canvas comes from there) and then live until
shutdown, across any number of Reactor reconnects.

    cp .env.example .env          # REACTOR_API_KEY, ARENA_URL, BROADCASTER_SECRET
    python main.py                # stream to ./hls, served on :8088
    python main.py --sink noop    # everything but the encoder
"""

from __future__ import annotations

import asyncio
import logging
import warnings

from arena_api import ArenaApi
from config import Config
from overlay import ArenaOverlay
from pacer import Pacer
from reactor_link import MODEL_FPS, MODEL_SAMPLE_RATE, ReactorLink
from show import Show
from sinks import AudioFormat, VideoFormat, make_sink

logger = logging.getLogger("broadcaster")


def setup_logging() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s")
    logging.getLogger("aiortc.codecs.vpx").setLevel(logging.ERROR)
    logging.getLogger("aiortc.codecs.h264").setLevel(logging.ERROR)
    logging.getLogger("aioice.ice").setLevel(logging.WARNING)
    warnings.filterwarnings("ignore", category=DeprecationWarning)


async def main() -> None:
    setup_logging()
    config = Config.load()
    link = ReactorLink(config)
    arena = ArenaApi(config.arena_url, config.broadcaster_secret)
    show = Show(
        link, arena,
        arena_name=config.arena_name,
        idle_queue_target=config.idle_queue_target,
        round_seconds=config.round_seconds,
        max_rounds=config.max_rounds,
        chat_poll_s=config.chat_poll_s,
    )
    sink = make_sink(
        config.sink,
        hls_dir=config.hls_dir, hls_port=config.hls_port, hls_segment_s=config.hls_segment_s,
        rtmp_url=config.rtmp_url, video_bitrate_k=config.video_bitrate_k,
    )

    tasks = [
        asyncio.create_task(link.run(), name="reactor-link"),
        asyncio.create_task(show.run_chat(), name="chat"),
        asyncio.create_task(show.run_show(), name="show"),
        asyncio.create_task(show.run_publish(), name="publish"),
        asyncio.create_task(show.run_playout(), name="playout"),
        asyncio.create_task(show.run_idle(), name="idle-filler"),
    ]
    try:
        await link.wait_first_state()
        width, height = link.canvas
        overlay = ArenaOverlay(link, show) if config.overlay_enabled else None
        pacer = Pacer(
            sink,
            VideoFormat(width=width, height=height, fps=MODEL_FPS),
            AudioFormat(sample_rate=MODEL_SAMPLE_RATE, channels=1),
            overlay=overlay,
        )
        link.attach_pacer(pacer)
        tasks.append(asyncio.create_task(pacer.run(), name="pacer"))
        logger.info(
            "on air: %dx%d@%dfps → sink=%s · arena=%s · rounds=%d × %.0fs",
            width, height, MODEL_FPS, config.sink, config.arena_url,
            config.max_rounds, config.round_seconds,
        )
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            if task.exception() is not None:
                logger.error("task %s died: %s", task.get_name(), task.exception())
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        try:
            await arena.publish_show({**show.show_state(), "program": "offline"})
        except Exception:
            pass
        await arena.close()
        await sink.stop()
        logger.info("shut down cleanly")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
