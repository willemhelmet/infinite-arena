# Twitch-only deployment on Render

Twitch is the frontend: video player, discovery, chat and viewer identities.
One Render background worker reads Twitch IRC, plans episodes with OpenAI,
generates video on Reactor, prepares Fish announcers, applies optional ntsc-rs
VHS processing, and sends the combined broadcast to Twitch over RTMP.
No Vercel deployment, Redis, public Python API, inbound port or GPU is required.
The previous web app remains in the repository as an optional legacy mode.

## Viewer flow

Two distinct Twitch viewers send `!fight <fighter description>` in the channel.
The worker pairs them FIFO and prepares the twelve-scene episode. `!queue`,
`!leave`, `!help` and `!prompt <setting>` are supported; # and % prefixes also
work. Submissions and show state are held in worker memory. A restart clears
pending entrants and abandons the interrupted episode; it does not replay chat.

Anonymous IRC reads chat without a bot token. Fish narration is still audible
on stream, and the broadcast overlay shows the matchup/queue. Chat confirmations
and narrator messages require TWITCH_BOT_USERNAME and TWITCH_OAUTH_TOKEN for that
user, with chat:read and chat:edit scopes. Store the token only in Render secret
environment variables or the local .env file. Outgoing replies are rate-limited
and bounded; no bot credentials means no outgoing chat messages. Tokens can
expire/revoke and need replacement; automatic token refresh is not implemented.
Official IRC auth: https://dev.twitch.tv/docs/chat/irc

## Render setup

Create a Blueprint from this repository using render.yaml. It builds
broadcaster/Dockerfile: Ubuntu 24.04, Python and ffmpeg. The MVP image omits
ntsc-rs and its GStreamer dependencies. No local secrets
or virtualenv are copied into the image. Set the prompted Render variables:

- TWITCH_CHANNEL: channel login, e.g. willemhelmet.
- OPENAI_API_KEY: narrative planning, now directly on the Python worker.
- REACTOR_API_KEY and RTMP_URL: generation and Twitch ingest credentials.
- FISH_API_KEY, FISH_REFERENCE_ID, FISH_SECONDARY_REFERENCE_ID: two announcers.
- Optional TWITCH_BOT_USERNAME and TWITCH_OAUTH_TOKEN: chat replies.

OPENAI_BASE_URL and OPENAI_MODEL may override the OpenAI-compatible writer.
CONTROL_PLANE=twitch is the default. No ARENA_URL or BROADCASTER_SECRET is needed.

The blueprint proposes 4 CPU / 8 GB as a benchmark starting point, not a measured
capacity guarantee. It includes a 10 GB scratch disk and one instance. A disk
prevents overlapping Render replacement instances; expect a broadcast restart
on deploy. Keep automatic deployments off. Stop the local broadcaster before
starting Render; never run two workers on the same channel. SIGTERM cancels
workers and closes ffmpeg; fatal task failures exit nonzero for supervision.
Render worker docs: https://render.com/docs/background-workers
Disk/deploy behavior: https://render.com/docs/disks

## VHS rollout and limits

VHS is deferred beyond the MVP. VHS_ENABLED stays 0 on Render; the deployment
image does not include the native CLI. Enabling it later requires installing
ntsc-rs and its dependencies, then validating throughput on the worker.
NTSC_RS_CLI overrides the executable and VHS_PRESET the JSON preset.
Eight-second segments are captured at 480 lines, processed off the event loop,
and replayed with their original PCM audio. This is buffered processing, not a
zero-latency filter. Bounded queues fail explicitly on overload.

On the Mac, a 32-second synthetic test processed segments in 4.06s cold and
1.87–1.96s warm, with first output after 12.04s. It verified 479 consecutive
paired frames without skipped/reordered audio. Real-fight throughput, visual
quality and cloud CPU capacity still need validation. Run
`python broadcaster/tests/vhs_smoke.py --ntsc-cli /path/to/ntsc-rs-cli`.

The adapter adds observed hold delay to chat/verdict timing. Initial holds are
black and silent; later processing stalls repeat the picture with silence.
Normal shutdown discards buffered tail; stop only after the delayed verdict
has aired. The MVP Docker image built successfully on Render on 2026-09-09; the
VHS-enabled image has not been validated there.

The worker still uses fast-h3. Migrating to the new reference-conditioned model
requires its upload/media adapter and actual reference assets; changing only
REACTOR_MODEL is insufficient. Native episode prompts and staging now live in
broadcaster/episode.py and episode_spec.json. The old Next planner belongs only
to CONTROL_PLANE=web. That legacy mode still requires ARENA_URL,
BROADCASTER_SECRET and shared Redis when hosted on Vercel; it is not used by
this Render blueprint.

## Active deployment

Created through the Render API on 2026-09-09 in Willem Helmet's workspace:
`infinite-arena-broadcaster`, service `srv-dagf9mf40ujc73euophg`, Virginia,
4 CPU / 8 GB, one worker and 10 GB disk. It deploys the GitHub branch
`codex/render-twitch-mvp` with automatic deploys disabled. The API-created
service follows render.yaml but is not managed by a Blueprint sync.

Dashboard: https://dashboard.render.com/worker/srv-dagf9mf40ujc73euophg

Linux image build, Twitch IRC join, Reactor READY and RTMP encoder startup
were verified. A complete viewer-submitted fight on the hosted worker remains
an acceptance check. Fish credentials are stored in Render; bot credentials
are not configured, so chat input works but outgoing chat replies are disabled.

First minute after restart: 1,440 frames sent, zero RTMP video/audio queue
drops; 1,302 source frames and 138 repeated frames, with 2.73 seconds of
source audio underflow. This measures transport pacing, not viewer perception.
Fish credential validation returned HTTP 401: replace FISH_API_KEY and redeploy
before testing fights. The director requires successful commentary preparation,
so this credential failure blocks episodes while idle broadcasting continues.
