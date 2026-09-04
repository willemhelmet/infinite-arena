"""The arena overlay: fight status on every outgoing frame.

  top-left     idle:    type "!fight <fighter>" in the arena chat
               card:    NEXT  A vs B
               fight:   ROUND 2/5   A ▮▮▮▮▮▮▯▯▯▯ 61   B ▮▮▮▮▮▮▮▮▯▯ 84
               verdict: WINNER  A
  bottom-left  the narrator's latest call (two lines max)
  top-right    READY n · BUILDING m

State comes from the Show (the fight lives there, not on the wire) plus the
link's queue mirror. Panels are rasterized with Pillow only when their text
changes and alpha-blended with numpy per frame, per the Overlay contract.
"""

from __future__ import annotations

import logging
import textwrap
from typing import TYPE_CHECKING

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .base import Overlay

if TYPE_CHECKING:
    from reactor_link import ReactorLink
    from show import Show

logger = logging.getLogger(__name__)

_MARGIN = 16
_FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
)


def _load_font(size: int):
    for path in _FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _bar(health: int, width: int = 10) -> str:
    filled = max(0, min(width, round(health / 100 * width)))
    return "▮" * filled + "▯" * (width - filled)


class ArenaOverlay(Overlay):
    def __init__(self, link: "ReactorLink", show: "Show") -> None:
        self._link = link
        self._show = show
        self._font = _load_font(20)
        self._font_small = _load_font(16)
        self._cache: dict[tuple[str, str], np.ndarray] = {}

    # ------------------------------------------------------------ text lines

    def _headline(self) -> str:
        show = self._show
        fight = show.fight
        if not self._link.connected:
            return "reconnecting to the arena…"
        if show.program == "card" and fight:
            return f"NEXT  {fight.a.fighter['name']} vs {fight.b.fighter['name']}"
        if show.program == "fight" and fight:
            a, b = fight.a, fight.b
            state = {"open": "ATTACK NOW", "judging": "JUDGING", "playing": ""}[fight.round_state]
            return (f"ROUND {fight.round}/{fight.max_rounds}   {a.fighter['name']} {_bar(a.health)} {a.health}"
                    f"   {b.fighter['name']} {_bar(b.health)} {b.health}" + (f"   {state}" if state else ""))
        if show.program == "verdict" and fight:
            return f"WINNER  {fight.winner.fighter['name']}" if fight.winner else "A DRAW"
        if show.queue:
            nxt = ", ".join(f"{e.fighter['name']} ({e.handle})" for e in show.queue[:2])
            return f"UP NEXT  {nxt} — !fight <fighter> to join"
        return 'type "!fight <fighter>" in the arena chat'

    def _badge(self) -> str:
        return f"READY {self._link.playout_queued} · BUILDING {self._link.generation_queued}"

    # ------------------------------------------------------------- compose

    def compose(self, frame: np.ndarray) -> np.ndarray:
        h, w = frame.shape[:2]
        out = None
        headline = self._headline()[:110]
        out = self._blend(out, frame, self._panel(headline, "primary"), _MARGIN, _MARGIN)
        badge = self._panel(self._badge(), "badge", small=True)
        out = self._blend(out, frame, badge, w - _MARGIN - badge.shape[1], _MARGIN)
        narration = self._show.last_narration if self._show.program in ("fight", "verdict") else None
        if narration:
            text = "\n".join(textwrap.wrap(narration, 90)[:2])
            panel = self._panel(text, "dim", small=True)
            out = self._blend(out, frame, panel, _MARGIN, h - _MARGIN - panel.shape[0])
        return frame if out is None else out

    def _panel(self, text: str, style: str, small: bool = False) -> np.ndarray:
        key = (text, f"{style}:{small}")
        cached = self._cache.get(key)
        if cached is not None:
            return cached
        if len(self._cache) > 64:
            self._cache.clear()
        font = self._font_small if small else self._font
        probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
        box = probe.multiline_textbbox((0, 0), text, font=font, spacing=4)
        pw, ph = box[2] - box[0] + 20, box[3] - box[1] + 12
        text_alpha, plate_alpha = {"primary": (235, 150), "dim": (170, 100), "badge": (225, 150)}[style]
        image = Image.new("RGBA", (pw, ph), (10, 10, 12, plate_alpha))
        draw = ImageDraw.Draw(image)
        draw.multiline_text((10 - box[0], 6 - box[1]), text, font=font, fill=(240, 240, 240, text_alpha), spacing=4)
        raster = np.asarray(image, dtype=np.uint8)
        self._cache[key] = raster
        return raster

    @staticmethod
    def _blend(out: np.ndarray | None, frame: np.ndarray, panel: np.ndarray, x: int, y: int) -> np.ndarray:
        if out is None:
            out = frame.copy()
        h, w = frame.shape[:2]
        ph, pw = panel.shape[:2]
        x, y = max(0, x), max(0, y)
        ph, pw = min(ph, h - y), min(pw, w - x)
        if ph <= 0 or pw <= 0:
            return out
        region = out[y:y + ph, x:x + pw].astype(np.float32)
        alpha = panel[:ph, :pw, 3:4].astype(np.float32) / 255.0
        rgb = panel[:ph, :pw, :3].astype(np.float32)
        out[y:y + ph, x:x + pw] = (region * (1 - alpha) + rgb * alpha).astype(np.uint8)
        return out
