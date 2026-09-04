"""The broadcaster's client for the arena web app.

Four things live on the web side and nowhere else: the chat thread the game
is played in, the show state the /watch page renders, the fighter registry,
and the narrative coordinator. This module is the only code that talks to
them. Every call authenticates with the shared BROADCASTER_SECRET.
"""

from __future__ import annotations

import logging
from typing import Any

import aiohttp

logger = logging.getLogger(__name__)

_TIMEOUT = aiohttp.ClientTimeout(total=20)
_LLM_TIMEOUT = aiohttp.ClientTimeout(total=60)


class ArenaApi:
    def __init__(self, base_url: str, secret: str) -> None:
        self._base = base_url.rstrip("/")
        self._headers = {"x-broadcaster-secret": secret, "Content-Type": "application/json"}
        self._session: aiohttp.ClientSession | None = None

    async def _http(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(headers=self._headers)
        return self._session

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()

    async def _request(
        self, method: str, path: str, *, json: Any = None, params: dict | None = None,
        timeout: aiohttp.ClientTimeout = _TIMEOUT,
    ) -> Any:
        http = await self._http()
        async with http.request(
            method, f"{self._base}{path}", json=json, params=params, timeout=timeout
        ) as res:
            body = await res.json(content_type=None)
            if res.status >= 400:
                raise RuntimeError(f"{method} {path} → {res.status}: {body}")
            return body

    # ------------------------------------------------------------------ chat

    async def read_chat(self, since: int) -> tuple[int, list[dict]]:
        body = await self._request("GET", "/api/chat", params={"since": str(since)})
        return int(body.get("seq", since)), list(body.get("messages", []))

    async def say(self, text: str, *, kind: str = "system", handle: str = "Arena") -> None:
        try:
            await self._request(
                "POST", "/api/chat", json={"text": text[:600], "handle": handle, "kind": kind}
            )
        except Exception as error:
            logger.warning("[arena] chat post failed: %s", error)

    # ------------------------------------------------------------------ show

    async def publish_show(self, state: dict) -> None:
        try:
            await self._request("PUT", "/api/show", json=state)
        except Exception as error:
            logger.warning("[arena] show publish failed: %s", error)

    # -------------------------------------------------------------- fighters

    async def list_fighters(self) -> list[dict]:
        body = await self._request("GET", "/api/fighters/registry")
        return [rec["fighter"] for rec in body.get("fighters", []) if "fighter" in rec]

    # ----------------------------------------------------------- coordinator

    async def resolve_round(self, payload: dict) -> dict:
        return await self._request(
            "POST", "/api/coordinator/resolve", json=payload, timeout=_LLM_TIMEOUT
        )

    async def program(self, payload: dict) -> dict:
        return await self._request(
            "POST", "/api/coordinator/program", json=payload, timeout=_LLM_TIMEOUT
        )
