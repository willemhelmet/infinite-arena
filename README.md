> Current production direction: **Twitch-only**. Run `CONTROL_PLANE=twitch`
> (default): Python reads Twitch chat and plans episodes directly; Vercel and
> Redis are not required. See `docs/HOSTING.md` at the repository root for the
> Render worker and secrets. The web workflows below are retained legacy mode
> (`CONTROL_PLANE=web`). Viewer commands use `!fight`, `!queue`, `!leave`, `!help`.

# Infinite Arena

Watch the channel and create a complete fight with two text submissions in Arena chat.
The Next.js app owns the fighter registry and chat APIs; the Python
[broadcaster](broadcaster/README.md) runs the fight director and video output.

## Run locally

```sh
pnpm install
cp .env.example .env.local  # on a fresh checkout; preserve existing settings
pnpm dev
```

Open <http://localhost:3000>. Configure services in `.env.local` using
[.env.example](.env.example). Without Redis credentials the app uses temporary
process memory for fighters, chat, show state, and rooms. Persistent Redis
is required on Vercel. Blob stores portraits; it is not the active fighter
catalog. Generated portraits require the configured image service; uploaded
portraits use the same creation form and registry.

Start the broadcaster separately using its [setup instructions](broadcaster/README.md).
Its `ARENA_URL` must point at the app and its `BROADCASTER_SECRET` must match
the app's value. Without a running director, viewers can create fighters and
chat, but fights will not advance.

### Run the web app and broadcaster together locally

With the broadcaster dependencies installed, run these in two terminals from
the repository root. Both processes read the existing `.env.local`; it must
contain `REACTOR_API_KEY` and `BROADCASTER_SECRET`.

For Twitch, also set `RTMP_URL` to your Twitch ingest URL including its stream
key, `NEXT_PUBLIC_TWITCH_CHANNEL` to your channel, and leave
`NEXT_PUBLIC_STREAM_URL` empty. Keep the stream key only in `.env.local`.

```sh
# Terminal 1: embed Twitch on / and /watch.
pnpm dev --port 3000
```

```sh
# Terminal 2: publish this arena to Twitch using the existing RTMP sink.
broadcaster/.venv/bin/python broadcaster/main.py --env-file .env.local --arena-url http://localhost:3000 --sink rtmp
```

For direct local HLS playback, use these commands instead:

```sh
# Terminal 1: use this Python client's HLS on both / and /watch.
NEXT_PUBLIC_TWITCH_CHANNEL= NEXT_PUBLIC_STREAM_URL=http://localhost:8088/live.m3u8 pnpm dev --port 3000
```

```sh
# Terminal 2: connect to hosted FastH3 and publish to the local web app.
HLS_DIR=/tmp/infinite-arena-local/hls HLS_PORT=8088 broadcaster/.venv/bin/python broadcaster/main.py --env-file .env.local --arena-url http://localhost:3000 --sink hls
```

Open <http://localhost:3000/watch>. In HLS mode, the broadcaster starts its
server on port 8088 after connecting to Reactor. In RTMP mode, it sends to
the configured ingest and the web app plays Twitch. Between episodes, the director generates arena establishing shots. The first shot takes time to generate after startup.
Stop each process with Ctrl+C when finished. Only one broadcaster should run
against this local app, and only one publisher should use the Twitch stream key.

## Play

1. Pick a chat handle and send `#fight sentient turtle monk`.
2. A second viewer sends `#fight 1000 gerbils`. Both descriptions lock.
3. The narrator plans twelve scenes: solo introductions and challenges, a face-off,
   referee start, a causal fight and victory. H3 renders about two minutes of video.
4. The director buffers the opening two clips, then plays the chained story.
   Watch through the ending; no portraits, saved fighters, or attacks required.
5. New submissions queue during the episode. The next pair starts automatically.

One pending entry per browser identity. `#queue` lists entries; `#leave`
removes an unpaired entry. `#prompt <arena setting>` changes the setting
between episodes. `!fight` and `%fight` are aliases; either prefix also
works for queue/help/leave/prompt. Each description may contain up to 273
characters, including a collective contestant such as a swarm.

The website's Arena chat controls the show. Twitch chat is not connected.
Existing portrait creation and gallery pages remain optional experiments;
they are not required by the episode flow. A `#fight` argument is always a
literal description, not a saved fighter ID.

The director retries story planning once. Invalid plans, failed generation,
interrupted playback, or 150 seconds without progress cancel the episode,
clear its remaining clips, and move to the next pair without inventing a
winner. Chat announces the result only after all twelve clips finish plus
`PLAYBACK_DELAY_S` (default 12 seconds). This allowance must be tuned against
the actual player latency; it is not per-viewer synchronization.

The queue and in-progress episode live in the director process. A restart
requires resubmission; replay/history and durable episode recovery are outside
this MVP. The existing shared chat/show store still needs Redis for persistent
multi-instance web deployment.

| Route | Purpose |
| --- | --- |
| `/` | Public channel with Twitch by default and arena chat |
| `/watch` | Broadcaster HLS view when configured; otherwise Twitch |
| `/fighters` | Shared fighter gallery, including IDs for chat selection |
| `/fighters/new` | Generate or upload a fighter portrait and publish it |
| `/games` | Existing browser game prototype using the mock game server |

The director heartbeat describes game control availability. Twitch presents
its own playback status; HLS reports player errors independently of the director.

## Verify

The browser suite needs Chromium and Python with `aiohttp`. For a fresh setup:

```sh
pnpm exec playwright install chromium
python3 -m venv broadcaster/.venv
broadcaster/.venv/bin/pip install aiohttp
```

Then run:

```sh
pnpm typecheck
broadcaster/.venv/bin/python -m unittest discover -s broadcaster/tests
pnpm test:e2e
```

Playwright builds and starts the app on port 3210 and a simulated coordinator
LLM on 3211. It clears Redis environment variables for the test server to keep
test state in memory. `BROADCASTER_PYTHON` can override the Python executable.
The two-browser channel test uses real chat/episode APIs and the Python
director, with the narrator LLM and Reactor media simulated. It does not
verify actual video generation or delivery to Twitch/HLS.

See [docs/TODO.md](docs/TODO.md) for acceptance checks and the remaining legacy
pool migration. The old pool endpoint and Blob records remain until storage
access permits inspection and migration; no legacy data has been deleted.

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
