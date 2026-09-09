> Current production direction: **Twitch-only**. Run `CONTROL_PLANE=twitch`
> (default): Python reads Twitch chat and plans episodes directly; Vercel and
> Redis are not required. See `docs/HOSTING.md` at the repository root for the
> Render worker and secrets. The web workflows below are retained legacy mode
> (`CONTROL_PLANE=web`). Viewer commands use `!fight`, `!queue`, `!leave`, `!help`.

# Infinite Arena broadcaster

The arena's director: a Python process that owns a fast-h3 session and turns
the game in arena chat into video. Its default output is HLS for `/watch`;
the public `/` page embeds the configured Twitch channel. An RTMP sink is
also available. Both pages use the app's Arena chat for `#fight`.

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

The director accepts `#fight <description>` from the website Arena chat.
Two distinct browser identities fill a matchup, then `/api/coordinator/episode`
plans one complete twelve-scene story. `!fight` and `%fight` are aliases.
No registry lookup, image generation, portrait confirmation, or attack window
is involved. Ordinary chat continues while the narrator prepares the episode.

The twelve shots are enqueued sequentially, breaking continuity at the second
fighter entrance and the face-off. Other shots continue from the preceding
clip ID. Every prompt repeats its visible cast and the arena,
with a hard cut, one visible action, a camera instruction, and sound.
A capacity check admits the whole episode. A partial enqueue is cancelled and
cleaned up; an unacknowledged enqueue is not retried because that could duplicate
an accepted scene. The opening two clips buffer with autoplay off, then autoplay
runs the chain. Idle clips are cleared before the episode and are not inserted
during it. Clip durations are clamped to deployment bounds.

`clip_started` advances the public beat. Only completion of ALL episode clips
allows the result, after `PLAYBACK_DELAY_S` (default 12 seconds) to allow for
stream delivery. No result or future narration is published while rendering.
This delay is a deployment allowance, not exact synchronization with each
Twitch viewer. The next pending pair follows automatically.

Planner failures retry once. Invalid plans, failed or stopped clips, disconnects,
and a 150-second progress timeout cancel without a verdict. Cleanup holds the
failed episode until the link can remove its clips, avoiding stray footage on
reconnect. Runtime episode/queue state is temporary; restart requires resubmission.

`#queue`, `#leave`, `#help`, and `#prompt <arena setting>` provide the other
controls. One pending entry per browser identity; a paired entry is locked.
Participants may queue another idea during their current episode. Old `!attack`
commands explain that episodes now play automatically.

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
| `overlay/arena.py` | Episode state and matchup on every frame; queue depth.    |
| `sinks/hls.py`     | ffmpeg → HLS + the HTTP server. `rtmp.py` and `noop.py` as upstream.                  |
| `tests/`           | `test_show.py`: pairing, buffering, chaining, completion and failure recovery against fakes.       |

### Scene commentary and plan repair

The episode planner writes a short narrator line for each shot, explaining the
current tactic without revealing later events. The director posts it to Arena
chat once per clip start, after `PLAYBACK_DELAY_S`, using the same delivery
allowance as the verdict. This is approximate Twitch alignment, not per-viewer
synchronization. Failed episodes discard pending commentary. A failed chat send
is logged without retrying an ambiguous delivery or interrupting playback.

Plans with schema validation errors get one focused LLM repair request carrying
the original plan and validation errors. The repaired plan must pass the full
schema and the 800-character shot limit; malformed plans still fail explicitly.

### Spoken narration

Set `FISH_API_KEY`, `FISH_REFERENCE_ID` (play-by-play), and
`FISH_SECONDARY_REFERENCE_ID` (analyst) in the broadcaster's private env file.
`FISH_MODEL` defaults to `s2-pro`. Without the key, narration remains chat-only.
Odd scenes use play-by-play; even scenes use analysis. The same lines appear
in chat after `PLAYBACK_DELAY_S`; that delay never applies to broadcast audio.

`broadcaster/narration.py` prepares all announcer lines with at most two Fish requests
in flight before enqueueing video. ffmpeg converts speech to 48 kHz mono int16,
with pitch-preserving speed adjustment up to 1.5x when needed to fit the scene.
A failed or oversized line cancels preparation before any footage is queued.
The pacer mixes prepared speech on its existing audio clock, lowering H3 audio
to 20% while speech plays and saturating the mix to prevent integer overflow.
Clip-start events select speech once; cancellation and disconnect clear it. No network calls run in media callbacks. Timing follows clip events,
so transport skew still needs a live listening check.


### Episode staging and audio verification

Episodes contain twelve scenes totaling 116 seconds before the model snaps
lengths to its published bounds: A introduction (8s), A challenge (6s), B
introduction (8s), B challenge (6s), face-off (8s), referee signal (6s), opening
clash, counterplay, escalation, reversal and finishing move (12s each), then
victory (14s). Entrances are solo; face-off establishes left/right positions
and scale. A silver robot referee with an amber visor and striped vest recurs
in face-off, start and victory. The final spoken commentary uses the explicit
winner announcement; its image holds the celebration and visible loser.

The planner emits three private `referenceFrames` briefs and per-shot
`referenceRole` values for solo A, solo B and face-off. These are prompt briefs,
not generated images. No reference-image field is sent to H3 until the new
model's reference contract is verified. Current clips break the continuation
chain at B's entrance and the face-off, then chain combat through victory.

Only solo challenge scenes permit optional fighter dialogue (their own side,
at most eight words/60 characters). The referee start line is deterministic.
Fish skips those speaking scenes, keeping H3 speech at full volume; chat
commentary remains. Entrance announcers use different voices. Silent shots
request nonverbal sound and closed mouths; compliance needs listening tests.

Normal clip completion lets queued speech drain; stops, cancellation and
reconnects clear it. A new scene replaces old speech with a warning if any was
unfinished. Audio logs distinguish source underflow, completely silent mixed
output, transport drops, and the intentional announcer pauses. Silence metrics
include idle time and cannot by themselves prove perceived audio quality.
Each prepared line's duration and every fighter/referee line are logged for
comparison during a listening test. User-reported dropouts remain unresolved
until a fresh live test verifies the sound.

The planner writes `challengeA` and `challengeB` separately; code assigns them
to their solo challenge scenes. Decorative sound descriptions are bounded to
50 characters at a word boundary before prompt assembly. Invalid story fields
still require a successful validated repair.

## Buffered VHS and hosting

The optional `VHS_ENABLED=1` output adapter uses the Experiment 2 ntsc-rs preset
in `broadcaster/presets/vhs.json`. Set `NTSC_RS_CLI` to the native executable;
`VHS_PRESET` optionally overrides the preset. Eight-second segments are processed
in worker threads and replayed with unchanged mixed audio at 480 lines. This
adds startup delay; subsequent processing holds are logged. Buffers are bounded
and overload stops the worker rather than silently discarding content. Normal
shutdown discards the buffered tail, so finish a live test only after its delayed
verdict has aired. The broadcaster adds measured VHS delay to chat/verdict timing.

See `docs/HOSTING.md` at the repository root for the Twitch + single Render worker deployment. `render.yaml` and `broadcaster/Dockerfile` are the
deployment entry points. `REQUIRE_SHARED_STORE=1` checks the authenticated
`/api/broadcaster/status` endpoint before spending on a model session.
