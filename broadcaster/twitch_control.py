"""Twitch IRC + local planning implement the Show's control interface.

Anonymous chat intake works without a bot token. Replies require the token;
otherwise fight commentary is still spoken via Fish and the broadcast overlay
shows the matchup/queue. System confirmations are not spoken.
The bounded incoming history and outgoing queue are local to this process.
"""
from __future__ import annotations
import asyncio
from collections import deque
import logging
import random
import ssl

logger = logging.getLogger(__name__)


def parse_message(line, channel):
    tags = {}
    if line.startswith("@"):
        raw, _, line = line.partition(" ")
        tags = dict(item.split("=", 1) for item in raw[1:].split(";") if "=" in item)
    if not line.startswith(":") or " PRIVMSG " not in line:
        return None
    prefix, _, rest = line[1:].partition(" PRIVMSG ")
    target, separator, text = rest.partition(" :")
    if not separator or target.lower() != "#" + channel.lower():
        return None
    login = prefix.split("!", 1)[0].lower()
    return {"kind": "user", "handle": login, "playerId": tags.get("user-id") or login,
            "text": text, "id": tags.get("id")}


def outgoing_line(channel, text):
    # Cap bytes, not Unicode characters; never allow IRC command injection.
    clean = " ".join(text.replace("\x00", "").split())
    return f"PRIVMSG #{channel} :".encode() + clean.encode()[:400].decode(errors="ignore").encode() + b"\r\n"


class TwitchControl:
    def __init__(self, channel, planner, username="", token=""):
        self.channel, self.planner, self.username, self.token = channel, planner, username, token
        self._history = deque(maxlen=1000)
        self._ids = deque(maxlen=1000)
        self._seq = 0
        self._outgoing = asyncio.Queue(maxsize=50)
        self._ready = asyncio.Event()
        self.task = None
        self.state = None

    async def start(self):
        self.task = asyncio.create_task(self.run(), name="twitch-connection")
        waiting = asyncio.create_task(self._ready.wait())
        try:
            done, _ = await asyncio.wait([self.task, waiting], timeout=30, return_when=asyncio.FIRST_COMPLETED)
            if self.task in done:
                await self.task
            if not self._ready.is_set():
                raise RuntimeError("Twitch did not confirm the channel join within 30 seconds")
        except BaseException:
            await self.close()
            raise
        finally:
            waiting.cancel()
            await asyncio.gather(waiting, return_exceptions=True)

    def accept(self, line):
        message = parse_message(line, self.channel)
        if not message or message["handle"] == self.username:
            return
        if message["id"]:
            if message["id"] in self._ids:
                return
            self._ids.append(message["id"])
        self._seq += 1
        self._history.append({**message, "seq": self._seq})

    async def run(self):
        backoff = 2
        while True:
            try:
                await self._session()
            except asyncio.CancelledError:
                raise
            except PermissionError:
                raise
            except Exception as error:
                logger.warning("[twitch] connection interrupted: %s", type(error).__name__)
            self._ready.clear()
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)

    async def _session(self):
        reader, writer = await asyncio.open_connection("irc.chat.twitch.tv", 6697, ssl=ssl.create_default_context())
        sender = None
        try:
            nick = self.username if self.token else f"justinfan{random.randint(10000, 99999)}"
            if self.token:
                token = self.token.removeprefix("oauth:")
                writer.write(f"PASS oauth:{token}\r\n".encode())
            writer.write(f"NICK {nick}\r\nCAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership\r\nJOIN #{self.channel}\r\n".encode())
            await writer.drain()
            async def send():
                while True:
                    text = await self._outgoing.get()
                    writer.write(outgoing_line(self.channel, text))
                    await writer.drain()
                    await asyncio.sleep(2.0)
            while True:
                raw = await asyncio.wait_for(reader.readline(), 300)
                if not raw:
                    raise ConnectionError("Twitch closed connection")
                line = raw.decode(errors="replace").rstrip("\r\n")
                if line.startswith("PING"):
                    writer.write(line.replace("PING", "PONG", 1).encode() + b"\r\n")
                    await writer.drain()
                elif "Login authentication failed" in line or "Login unsuccessful" in line:
                    raise PermissionError("Twitch rejected bot credentials")
                elif " 366 " in line:
                    self._ready.set()
                    logger.info("[twitch] joined #%s (%s)", self.channel, "bot replies enabled" if self.token else "read-only; no bot token")
                    if self.token and sender is None:
                        sender = asyncio.create_task(send())
                elif " RECONNECT" in line:
                    raise ConnectionError("Twitch requested reconnect")
                else:
                    self.accept(line)
                if sender and sender.done():
                    await sender
        finally:
            if sender:
                sender.cancel()
                await asyncio.gather(sender, return_exceptions=True)
            writer.close()
            await writer.wait_closed()

    async def read_chat(self, since):
        return self._seq, [message for message in self._history if message["seq"] > since]

    async def say(self, text, *, kind="system", handle="Arena"):
        if not self.token or not self._ready.is_set():
            return
        try:
            self._outgoing.put_nowait(f"{handle}: {text}")
        except asyncio.QueueFull:
            logger.warning("[twitch] reply queue full; omitted a chat reply")

    async def publish_show(self, state):
        self.state = state

    async def episode(self, inputs):
        return await self.planner.episode(inputs)

    async def close(self):
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
            self.task = None
