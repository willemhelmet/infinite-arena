"""Real director + ArenaApi for Playwright; only Reactor media is simulated.

Run by channel-loop.spec.ts against its isolated local Next server. No hosted
model session is opened. This verifies HTTP integration, not video output.
"""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from arena_api import ArenaApi
from test_show import FakeLink, make_show


async def main():
    arena = ArenaApi(os.environ["ARENA_URL"], os.environ["BROADCASTER_SECRET"])
    link = FakeLink()
    show = make_show(link, arena)
    show._chat_poll_s = 0.1
    # Ignore previous tests' messages before browsers can submit commands.
    show._chat_seq, _ = await arena.read_chat(0)
    await arena.publish_show(show.show_state())

    async def play():
        while True:
            await asyncio.sleep(0.5)
            link.build()
            if link.playing:
                link.finish()
            await show._tick()
            if link.autoplay and link.playout_clips:
                link.start()

    print("READY", flush=True)
    try:
        await asyncio.gather(show.run_chat(), show.run_publish(), play())
    finally:
        await arena.close()


if __name__ == "__main__":
    asyncio.run(main())
