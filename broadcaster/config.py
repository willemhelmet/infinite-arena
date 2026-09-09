"""Configuration for the Infinite Arena broadcaster.

Everything comes from the environment (a `.env` file is loaded when present),
with a few CLI overrides for the things you flip per run. `Config.load` is the
only reader; the rest of the broadcaster takes a `Config` and never touches
`os.environ`.
"""

from __future__ import annotations

import argparse
import os
import re
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


def _flag(value: str | None) -> bool:
    return (value or "").strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Config:
    """One immutable snapshot of everything the broadcaster is configured with."""

    # Reactor (the fast-h3 session this process owns)
    model: str
    api_key: str | None
    local: bool
    local_url: str

    # The arena web app: chat, show state, fighters, the coordinator
    arena_url: str
    broadcaster_secret: str
    arena_name: str

    # The show
    idle_queue_target: int
    playback_delay_s: float
    chat_poll_s: float

    # Output
    sink: str  # "hls" | "rtmp" | "noop"
    hls_dir: str
    hls_port: int
    hls_segment_s: int
    hls_public_url: str | None
    rtmp_url: str | None
    video_bitrate_k: int
    overlay_enabled: bool

    control_plane: str = "twitch"
    twitch_channel: str = ""
    twitch_bot_username: str = ""
    twitch_oauth_token: str = ""
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"
    require_shared_store: bool = False
    vhs_enabled: bool = False
    ntsc_rs_cli: str = "ntsc-rs-cli"
    vhs_preset: str = str(Path(__file__).parent / "presets" / "vhs.json")

    fish_api_key: str | None = None
    fish_reference_id: str = ""
    fish_secondary_reference_id: str = ""
    fish_model: str = "s2-pro"

    @staticmethod
    def load(argv: list[str] | None = None) -> "Config":
        parser = argparse.ArgumentParser(
            description="Infinite Arena broadcaster: fast-h3 → the arena's own stream."
        )
        parser.add_argument("--env-file", default=None, help="path to a .env file")
        parser.add_argument("--api-key", default=None, help="override REACTOR_API_KEY")
        parser.add_argument("--local", action="store_true", help="drive a local `reactor run`")
        parser.add_argument("--arena-url", default=None, help="override ARENA_URL")
        parser.add_argument("--sink", default=None, choices=("hls", "rtmp", "noop"))
        args = parser.parse_args(argv)

        if args.env_file:
            load_dotenv(args.env_file, override=True)
        else:
            load_dotenv()

        config = Config(
            control_plane=os.environ.get("CONTROL_PLANE", "twitch"),
            twitch_channel=(os.environ.get("TWITCH_CHANNEL") or os.environ.get("NEXT_PUBLIC_TWITCH_CHANNEL", "")).lstrip("#").lower(),
            twitch_bot_username=os.environ.get("TWITCH_BOT_USERNAME", "").lower(),
            twitch_oauth_token=os.environ.get("TWITCH_OAUTH_TOKEN", ""),
            openai_api_key=os.environ.get("OPENAI_API_KEY", ""),
            openai_base_url=os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1"),
            openai_model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            require_shared_store=_flag(os.environ.get("REQUIRE_SHARED_STORE")),
            vhs_enabled=_flag(os.environ.get("VHS_ENABLED")),
            ntsc_rs_cli=os.environ.get("NTSC_RS_CLI", "ntsc-rs-cli"),
            vhs_preset=os.environ.get("VHS_PRESET", Config.__dataclass_fields__["vhs_preset"].default),
            fish_api_key=os.environ.get("FISH_API_KEY") or None,
            fish_reference_id=os.environ.get("FISH_REFERENCE_ID", ""),
            fish_secondary_reference_id=os.environ.get("FISH_SECONDARY_REFERENCE_ID", ""),
            fish_model=os.environ.get("FISH_MODEL", "s2-pro"),
            model=os.environ.get("REACTOR_MODEL", "fast-h3"),
            api_key=args.api_key or os.environ.get("REACTOR_API_KEY") or None,
            local=args.local or _flag(os.environ.get("REACTOR_LOCAL")),
            local_url=os.environ.get("REACTOR_LOCAL_URL") or "http://localhost:8080",
            arena_url=(args.arena_url or os.environ.get("ARENA_URL") or "http://localhost:3000").rstrip("/"),
            broadcaster_secret=os.environ.get("BROADCASTER_SECRET", ""),
            arena_name=os.environ.get("ARENA_NAME", "Infinite Arena"),
            idle_queue_target=int(os.environ.get("IDLE_QUEUE_TARGET", "4")),
            playback_delay_s=float(os.environ.get("PLAYBACK_DELAY_S", "12")),
            chat_poll_s=float(os.environ.get("CHAT_POLL_S", "1.0")),
            sink=(args.sink or os.environ.get("SINK", "hls")).lower(),
            hls_dir=os.environ.get("HLS_DIR", "./hls"),
            hls_port=int(os.environ.get("HLS_PORT", "8088")),
            hls_segment_s=int(os.environ.get("HLS_SEGMENT_S", "2")),
            hls_public_url=os.environ.get("HLS_PUBLIC_URL") or None,
            rtmp_url=os.environ.get("RTMP_URL") or None,
            video_bitrate_k=int(os.environ.get("VIDEO_BITRATE_K", "4500")),
            overlay_enabled=_flag(os.environ.get("OVERLAY_ENABLED", "1")),
        )
        config.validate()
        return config

    def validate(self) -> None:
        if self.fish_api_key and not (self.fish_reference_id and self.fish_secondary_reference_id):
            raise SystemExit("Fish narration requires FISH_REFERENCE_ID and FISH_SECONDARY_REFERENCE_ID.")
        if not self.local and not self.api_key:
            raise SystemExit("Either REACTOR_API_KEY (hosted) or --local / REACTOR_LOCAL=1 is required.")
        if self.control_plane not in ("twitch", "web"):
            raise SystemExit("CONTROL_PLANE must be twitch or web")
        if self.control_plane == "twitch":
            if not re.fullmatch(r"[a-z0-9_]{1,25}", self.twitch_channel):
                raise SystemExit("TWITCH_CHANNEL is required")
            if not self.openai_api_key:
                raise SystemExit("OPENAI_API_KEY is required for standalone planning")
            if bool(self.twitch_bot_username) != bool(self.twitch_oauth_token):
                raise SystemExit("Set both TWITCH_BOT_USERNAME and TWITCH_OAUTH_TOKEN for bot replies")
            if self.twitch_oauth_token and (not re.fullmatch(r"[a-z0-9_]{1,25}", self.twitch_bot_username) or re.search(r"\s", self.twitch_oauth_token)):
                raise SystemExit("Invalid Twitch bot credentials format")
        if self.control_plane == "web" and not self.broadcaster_secret:
            raise SystemExit("BROADCASTER_SECRET is required (the same value the web app has).")
        if self.sink not in ("hls", "rtmp", "noop"):
            raise SystemExit(f"Unknown SINK {self.sink!r}; use hls, rtmp or noop.")
        if self.sink == "rtmp" and not self.rtmp_url:
            raise SystemExit("SINK=rtmp needs RTMP_URL.")
        if self.idle_queue_target < 0 or self.chat_poll_s <= 0:
            raise SystemExit("IDLE_QUEUE_TARGET must be nonnegative and CHAT_POLL_S positive.")
        if not 0 <= self.playback_delay_s <= 60:
            raise SystemExit("PLAYBACK_DELAY_S must be between 0 and 60.")
