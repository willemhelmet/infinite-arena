# Infinite Arena broadcaster

The arena's one channel: a Python process that owns a fast-h3 session, turns
the game in the arena's chat into video, and streams it itself — no Twitch,
no YouTube. Viewers watch on the web app's `/watch` page; the same page's
chat is where they type `!fight` and `!attack`.

```
arena chat (web app) ──▶ Show ──▶ coordinator (web app) ──▶ shots
                           │
                           ▼ enqueue (tagged groups) · move · pop
                      ReactorLink ◀──▶ fast-h3 (hosted, REACTOR_API_KEY)
                           │ 24 fps video + 48 kHz audio, clip-shaped
                           ▼
                         Pacer ──▶ ArenaOverlay ──▶ HlsSink (ffmpeg → HLS, served on :8088)
```

Derived from Reactor's
[infinite-livestream](https://github.com/reactor-team/infinite-livestream)
streaming client (Apache-2.0, see `LICENSE-infinite-livestream`). `pacer.py`,
`reactor_link.py`, `group_tag.py`, `sinks/base.py`, `sinks/noop.py`,
`sinks/rtmp.py` and `overlay/base.py` are that client's, unchanged or nearly
so — its README's RTMP/ffmpeg learnings apply here verbatim. What's new is the
show (`show.py`), the arena client (`arena_api.py`), the HLS sink, and the
overlay.

## The show

| Program   | What's on air                                                                 | What moves it on                              |
| --------- | ----------------------------------------------------------------------------- | --------------------------------------------- |
| `idle`    | Fighter bios from the registry, tagged `generated: true` (evictable filler)   | Two people in the queue                       |
| `card`    | The next fight announced: each fighter, then the face-off                     | The card's first clip starts playing          |
| `fight`   | Rounds: `!attack` window → coordinator judges → the round's shots air         | The round's first clip starts playing         |
| `verdict` | The winner's moment                                                            | Its first clip starts playing → back to idle  |

Rounds are **gated on the broadcast**: the next `!attack` window opens when
the previous round's clips start playing, read off the metadata echo on
`clip_started`. If the echo never comes (a build failed, the queue is deep)
the show moves on after `_GATE_TIMEOUT_S`. If a fighter doesn't attack within
`ROUND_SECONDS`, their side gets a default move and the round resolves.

Chat commands (from the web app's `/api/chat`, polled every `CHAT_POLL_S`):

- `!fight <fighter>` — enter the queue with a registry fighter (name match,
  case-insensitive, unique substring works). Two in the queue starts a card.
- `!attack <text>` — your move for the open round; one per round, 280 chars.
  Only the two fighters can; spectators are ignored silently.
- `!leave`, `!fighters`, `!queue`, `!help`.

The director answers in chat as **Arena** (system) and relays the
coordinator's calls as **Narrator**. It also publishes `ShowState` to the web
app every few seconds (and on every change), which is what the `/watch` page
renders: program, fight card with health, queue, "ready · building".

Queue policy is the upstream client's, ported: this process is the queue's
only writer; fight clips insert ahead of waiting filler (`viewer_insert_position`)
and evict it (`pop` on `generated: true` only) when they need room; a group is
enqueued whole or not at all; autoplay is on and `run_playout` curates the
playout front with `move` (`pick_next`); a full playout queue of filler that
blocks a fight build is relieved one pop per tick.

## Streaming ourselves: the HLS sink

`SINK=hls` (the default) has ffmpeg write a rolling HLS playlist and 2-second
fMP4 segments into `HLS_DIR`, and serves that directory on `HLS_PORT` with
CORS and `Cache-Control: no-store` on the playlist. The web app plays it with
hls.js when `NEXT_PUBLIC_STREAM_URL` points at
`http(s)://<this host>:<port>/live.m3u8`. Latency is a few segments (6-10 s).
Put a reverse proxy with TLS (Caddy, nginx) or a CDN in front for a real
audience; the process itself only needs to be reachable from the web app's
viewers. `SINK=rtmp` pushes to an RTMP ingest you run (MediaMTX, nginx-rtmp)
if you'd rather fan out from there; `SINK=noop` runs everything but the
encoder.

## Running

```sh
cd broadcaster
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt        # ffmpeg must be on PATH for SINK=hls|rtmp
cp .env.example .env                   # REACTOR_API_KEY, ARENA_URL, BROADCASTER_SECRET
python main.py                         # on air; playlist at http://localhost:8088/live.m3u8
python main.py --sink noop             # dry run, no encoder
python -m unittest discover -s tests   # the show director against fakes
```

`BROADCASTER_SECRET` must equal the web app's env var of the same name: it is
what lets this process publish show state, post as the Arena, and call the
coordinator. `REACTOR_API_KEY` is the same key the web app holds; this
process talks to Reactor directly through `reactor-sdk`.

## Where things live

| File               | Owns                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------- |
| `main.py`          | Wiring and task lifecycle.                                                            |
| `config.py`        | The only reader of `.env` / environment / CLI.                                        |
| `show.py`          | The programs, the fight state machine, chat commands, enqueue policy, show state.     |
| `arena_api.py`     | Everything that talks to the web app: chat, show, registry, coordinator.              |
| `reactor_link.py`  | Everything that touches `reactor_sdk`: connect/reconnect, media → pacer, state mirror. |
| `group_tag.py`     | The metadata tag and the shared queue policies (`pick_next`, `viewer_insert_position`). |
| `pacer.py`         | Clip-shaped output → constant-rate stream; hands frames to the overlay.               |
| `overlay/arena.py` | Fight status on every frame: round, health bars, the narrator's call, queue depth.    |
| `sinks/hls.py`     | ffmpeg → HLS + the HTTP server. `rtmp.py` and `noop.py` as upstream.                  |
| `tests/`           | `test_show.py`: a full idle → card → fight → verdict → idle cycle against fakes.       |
