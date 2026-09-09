"""Infinite Arena broadcaster. See README.md for the full picture.

    Twitch chat -> Show -> EpisodePlanner -> shots
                     | enqueue (tagged groups), move, pop
                 ReactorLink <-> fast-h3 (hosted or local)
                     | frames / audio + Fish narration
                   Pacer -> Overlay -> optional VHS -> Sink

One asyncio process. The pacer and sink are created after the first
`state_update` (the deployment's canvas comes from there) and then live until
shutdown, across any number of Reactor reconnects. CONTROL_PLANE=web selects
the legacy web coordinator instead of Twitch and the Python episode planner.

    cp .env.example .env          # fill generation, chat and ingest settings
    python main.py --sink rtmp    # broadcast to Twitch
    python main.py --sink noop    # run without an ingest
"""

from __future__ import annotations

import asyncio
import logging
import signal
import warnings

from arena_api import ArenaApi
from config import Config
from overlay import ArenaOverlay
from pacer import Pacer
from narration import FishNarrator, NarrationMixer
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
    current = asyncio.current_task()
    asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, current.cancel)
    config = Config.load()
    link = ReactorLink(config)
    if config.control_plane == "twitch":
        from twitch_control import TwitchControl
        from episode import EpisodePlanner
        arena = TwitchControl(config.twitch_channel,
            EpisodePlanner(config.openai_api_key, config.openai_base_url, config.openai_model),
            config.twitch_bot_username, config.twitch_oauth_token)
        await arena.start()
    else:
        arena = ArenaApi(config.arena_url, config.broadcaster_secret)
    logger.info("announcer audio: %s", "Fish enabled (two voices)" if config.fish_api_key else "disabled")
    mixer = NarrationMixer()
    narrator = FishNarrator(config.fish_api_key,
        (config.fish_reference_id, config.fish_secondary_reference_id), config.fish_model) if config.fish_api_key else None
    if config.control_plane == "web" and config.require_shared_store:
        try:
            ready = await arena._request("GET", "/api/broadcaster/status")
            if not ready.get("sharedStore"):
                raise RuntimeError("Deploy a shared Redis store before starting the hosted broadcaster")
        except BaseException:
            await arena.close()
            raise
    show = Show(
        link, arena, narrator=narrator, narration_mixer=mixer,
        arena_name=config.arena_name,
        idle_queue_target=config.idle_queue_target,
        playback_delay_s=config.playback_delay_s,
        chat_poll_s=config.chat_poll_s,
    )
    sink = make_sink(
        config.sink,
        hls_dir=config.hls_dir, hls_port=config.hls_port, hls_segment_s=config.hls_segment_s,
        rtmp_url=config.rtmp_url, video_bitrate_k=config.video_bitrate_k,
    )

    if config.vhs_enabled:
        from sinks.vhs import VhsSink
        sink = VhsSink(sink, config.ntsc_rs_cli, config.vhs_preset)
        show.output_delay = lambda: sink.hold_ticks / MODEL_FPS

    tasks = [
        asyncio.create_task(link.run(), name="reactor-link"),
        asyncio.create_task(show.run_chat(), name="chat"),
        asyncio.create_task(show.run_show(), name="show"),
        asyncio.create_task(show.run_publish(), name="publish"),
    ]
    if config.control_plane == "twitch":
        tasks.append(arena.task)
    if config.idle_queue_target > 0:
        tasks.append(asyncio.create_task(show.run_idle(), name="idle-filler"))
    try:
        await link.wait_first_state()
        width, height = link.canvas
        overlay = ArenaOverlay(link, show) if config.overlay_enabled else None
        pacer = Pacer(
            sink,
            VideoFormat(width=width, height=height, fps=MODEL_FPS),
            AudioFormat(sample_rate=MODEL_SAMPLE_RATE, channels=1),
            overlay=overlay, narration=mixer,
        )
        link.attach_pacer(pacer)
        tasks.append(asyncio.create_task(pacer.run(), name="pacer"))
        logger.info(
            "on air: %dx%d@%dfps → sink=%s · arena=%s · episode mode",
            width, height, MODEL_FPS, config.sink,
            f"twitch:{config.twitch_channel}" if config.control_plane == "twitch" else config.arena_url,
        )
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            if task.exception() is not None:
                logger.error("task %s died: %s", task.get_name(), task.exception())
                raise task.exception()
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
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
