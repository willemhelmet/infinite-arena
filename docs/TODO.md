## Render MVP scope

VHS is deferred. The Render image contains Python and ffmpeg only, with
VHS_ENABLED=0. Deploy and validate the direct Twitch broadcast first.

## Twitch-only production direction

Twitch is now the player and prompt/chat frontend. The standalone Python
planner and IRC adapter remove the Vercel/Redis dependency in default mode.
Render deployment is live on codex/render-twitch-mvp; optional bot credentials enable chat replies.
Live anonymous join verified for willemhelmet. VHS synthetic pacing test passed;
Linux MVP Docker build passed; hosted full-fight validation remains pending.
The broadcaster deployment branch is committed and pushed; see HOSTING.md for
the active Render worker.

Real planner verification: Washington vs Napoleon returned all 12 scenes,
116 seconds, both fighter challenges and referee dialogue; longest prompt
572 characters. Preview saved locally; this does not verify rendered media.

## Longer broadcast flow (2026-09-08)

Implemented 12 stages / 116 seconds: solo introductions and challenges,
face-off, recurring referee signal, five causal fight scenes, held victory
with a spoken winner announcement. Three reference-frame prompt briefs are
returned privately; actual reference image generation and model ingestion
await the new model contract. No claim that images are already generated.

Audio: normal clip-end no longer clears pending speech. Added source-underflow,
mixed-output silence, unfinished-speech replacement and per-line timing logs.
These are diagnostics and a candidate cutoff fix, not verification that the
user's reported audio dropouts are solved. Live listening acceptance pending.

## Fighter dialogue (2026-09-08)

- User confirmed every narrative step played with the announcers, but H3 fighters improvised gibberish.
- Planner now assigns at most one short line to a named side; H3 gets that side's canonical appearance and exact English text. Fish stays silent for that entire scene; chat narration remains.
- Pending: live listening check of assigned speaker, exact words and lack of overlap. Non-dialogue scenes request closed mouths, but model compliance is not guaranteed.

## Fish integration verification (2026-09-08)

- Two voices configured locally; 18 Python tests and 7 planner/channel integration tests pass.
- After API funding, both configured voices synthesized successfully (3.90s and 3.10s samples).
- Hosted Bo Peep vs Drorgrokx test completed all six scenes and six announcer messages through Twitch, with zero reported video/audio drops. Broadcast stopped after verdict.
- Human listening verification of voice quality, speech/video alignment and background mix remains pending; transport logs alone do not establish perceived audio quality.

## Spoken commentary — 2026-09-08

H3 voiceover testing made visible fighters speak the narration. Fish now prepares
two alternating announcers separately and mixes them in the broadcaster.
Viewer-facing beat numbers are removed. Live audio timing and voice quality need listening verification.

## Narration implementation — 2026-09-08

Scene commentary and bounded repair of overlong generated plan fields are implemented locally.
Commentary follows clip start plus PLAYBACK_DELAY_S. Live Twitch verification on
2026-09-08 completed gorilla-man versus Skippy: six clips, six narrator messages
exactly once, then one verdict; zero encoder video/audio drops. Browser chat
submission and rendered commentary were verified. The 12-second allowance was
too long for the observed player (chat trailed video by roughly a beat); tune
against actual viewer latency before claiming synchronization. The broadcaster
was stopped after verification.

# Infinite Arena — outstanding work

Updated 2026-09-07 for the text-only episode MVP.

## Current scope — supersedes the earlier portrait/round acceptance criteria

- Website Arena chat: two `#fight <description>` submissions from distinct
  viewers create one automatic six-beat episode. No portrait or registry dependency.
- The complete story and winner are planned before H3 rendering. Canonical
  appearances/setting are repeated; shots are chained through clip IDs.
- Buffer the opening two clips; progress follows playback; reveal the ending
  after all six clips complete plus the configured delivery allowance.
- Queue new ideas during playback and start the next pair automatically.
- Validate turtle monk versus 1,000 gerbils through two fresh browser sessions,
  then watch real H3 output through the ending. Synthetic tests do not prove
  visual character consistency, readable action, or smooth live delivery.
- Runtime queue/episode state is currently process-local. Restart requires
  resubmission. Durable history/replays and portrait storage remain deferred.

## Verification on 2026-09-07

- Real narrator and hosted H3 completed turtle monk vs 1,000 gerbils through
  local HLS. All six clips generated, started and finished in story order.
- Second chat entry at 16:21:19 UTC; first episode clip started 16:21:43.
  Final clip finished 16:22:56; verdict posted 16:23:09, after the configured
  twelve-second delivery allowance. Five transitions were 0–3 ms apart.
- Stream encoder reported zero dropped video/audio. Opening, middle, and ending
  frames and a contact sheet were inspected; contestants remained recognizable.
  Fight choreography and the clarity of defeat still benefit from creative
  iteration. This test does not establish exact counts of gerbils.
- Local recording: `artifacts/episode-mvp/turtle-monk-vs-gerbils.mp4` (ignored
  by Git). The live run was through HLS; Twitch delivery was not retested.
- Hosted H3 disconnected cleanly after the test. The temporary development
  server was stopped as well; no production deployment was made.
- Python director tests cover six-clip completion, two-clip buffering, aliases,
  duplicate prevention, queued follow-up, concurrent chat during planning,
  interrupted generation/connection and timeout/partial-enqueue cleanup.

Earlier handoff and original acceptance criteria are retained below as history;
they do not require restoring per-round attacks to the current episode flow.

## Current handoff

- Runtime stopped at the user's request on 2026-09-06: broadcaster disconnected
  its hosted Reactor session cleanly, Twitch ffmpeg exited, and the local web
  app stopped. Ports 3000, 8088, 3210, and 3211 are closed. Do not restart the
  broadcaster until the user is ready to resume credit-consuming live testing.
- Implemented: registry-backed creation and picker, retryable saves preserving
  fighter IDs, and private chat creation (`!create fighter` → name → description
  → portrait preview → `!save`; `!cancel` exits).
- Live command fixes: `!create <name>` skips the name question; unsupported
  commands explain available actions. `!prompt <arena setting>` changes new
  scenery between bouts, including empty-catalog footage. How to Play now
  describes the channel commands rather than the legacy browser lobby.
  TypeScript, all ten director tests, and seven targeted browser tests pass
  (the new creation test passed after correcting its alert selector). Browser
  tests ran in a temporary checkout so their build could not disrupt live video.
- Implemented: Twitch playback status belongs to its player; heartbeat labels
  describe the director. HLS errors come from the player, not the heartbeat.
- Implemented: round deadline beside chat, immediate registry refresh for
  `!fight`, ID selection for ambiguous names, and bounded recovery when model
  enqueue throws.
- Verified after recovery: all 19 browser tests passed, including two browsers
  using the real registry/chat APIs and Python director through submitted moves,
  missing moves, verdict, and the next queued bout. Portraits, coordinator LLM,
  and media generation/playback were simulated. TypeScript and all seven Python
  director tests also passed. Browser tests now force temporary memory storage
  even when local Redis credentials are configured; the status check also
  verifies that an online director does not produce a LIVE badge.
- Remaining: inspect and migrate legacy pool records before deleting
  `src/app/api/pool/route.ts` and `src/lib/fighters/poolStore.ts`. Active UI
  consumers and the pool mock are already removed; the old endpoint/storage
  remain pending migration. Do not interpret this as a completed migration.
- Storage blocker: refreshed Vercel credentials still cannot inspect Blob.
  The store rejects development OIDC; `vercel env pull --environment=preview`
  also produced a token rejected as development. `vercel blob list` returned
  access denied. Neither local nor freshly pulled development settings provide
  persistent Redis/KV credentials. No legacy records were changed or deleted.
- Follow-up inspection through `vercel blob get-store` succeeded: the configured
  public store `infinite-arena-blob` reports zero blobs. Its project connection
  has `envVarEnvironments: [production, preview]`, with Development absent.
  A real portrait-generation request reached storage and failed with Blob access
  denied. Enable Development on this existing project/store connection, refresh
  the local OIDC token, and verify a real upload before claiming creation works
  with the configured external services. Portrait mocks do not prove that.
- Still unverified: a full fight using real generated video and visual playback
  confirmation in Twitch. The browser walkthrough uses simulated media.
- Live testing follow-up: Twitch RTMP is configured from the working sibling
  streaming client. A fresh, empty local catalog exposed a black-screen stall:
  the director queued no bios and therefore generated no video. Empty catalogs
  now queue arena establishing shots through the existing evictable filler path.
  All eight director tests pass, including empty startup and fight priority.
  After restart, the first minute delivered 1,257 real video frames to the
  encoder with zero dropped frames and an established Twitch RTMP connection.

The original acceptance criteria follow. Items above describe current progress;
later projects remain deferred.

## Goal and stopping point

A viewer can watch the channel, create a fighter, find that same fighter
in chat, queue a bout, submit moves, and reach a verdict without an operator
unsticking the show. Prove that loop with two browsers before expanding it.

`/` is the public channel; `/watch` is the broadcaster view. The browser
`/games/...` flow still uses the mock server. Keep it working, but do not
build a second production game loop as part of this milestone.

## 1. One shared fighter catalog

Creation already calls `/api/fighters/registry`, and the broadcaster reads
that registry. The picker reads `/api/pool`, which has separate Blob records,
a manifest, and localStorage fallbacks. Adding a second best-effort write
would preserve the mismatch and generate a second fighter ID.

- Make gallery and picker use the existing registry and preserve fighter IDs.
- Migrate any existing pool-only fighters before removing the pool endpoint,
  Blob catalog/manifest code, and client pool cache. Inspect stored data first;
  do not assume the pool is empty. Keep Blob portrait storage.
- Show a failed shared save and allow retry with the same ID. A local draft
  must not look like a fighter successfully published to the channel.
- Use the registry's existing KV abstraction in development. MemoryKV is
  temporary process storage; a shared deployment needs persistent KV.
- Remove the pool mock when its consumers are migrated. Exercise the actual
  catalog through create/upload, gallery, picker, and broadcaster lookup.

**Done when:** a fighter created in one browser is visible in another and
resolves in `!fight` under the same ID. A failed save is visible and retryable.

Previously reported failing E2E specs: `create-fighter`, `upload-fighter`,
`fighter-gallery`, `join-game-flow` (two cases), and `create-server-flow`.
Run `pnpm test:e2e` after the change. If port 3210 is occupied, identify the
process before stopping it; do not blindly kill whatever owns the port.

## 2. Stop making unsupported stream-status claims

The broadcaster heartbeat says whether the arena director is responding;
it does not establish whether Twitch is live or an HLS video is playing.
`TwitchStream` currently covers the embed with an OFF AIR overlay based on
that heartbeat, and `ChannelHero` makes the same claim.

- Delete the custom Twitch OFF AIR overlay and LIVE badge. Let the embedded
  player present its own playback status.
- Label heartbeat-derived status as arena/director status in the surrounding
  UI. Do not describe it as video liveness or promise chat responses while
  the director is unavailable.
- Review the HLS overlay under the same distinction: a stale heartbeat can
  explain unavailable game control, but should not cover functioning video.

**Done when:** an offline director cannot obscure the Twitch player or
produce a false LIVE badge. Cover this with the existing page tests.

No Helix route, credentials, thumbnail probe, iframe-load heuristic, or
second polling loop is needed for this milestone. Reconsider only if a
separate stream-status display becomes a demonstrated requirement.

## 3. Prove the chat loop and close actual stalls

`broadcaster/show.py` already accepts queued challengers during a fight,
reports queue position, and matches names case-insensitively. Preserve and
verify those behaviors instead of implementing them again.

- Walk through create → `!fight` → card → `!attack` → verdict → next card
  with two browsers, then queue another challenger during the bout.
- Surface the existing `deadlineAt` where players submit moves.
- Verify missing moves and coordinator/generation failures cannot leave a
  bout stuck. Fix observed stalls using the existing round/verdict paths.
- Check ambiguous fighter names produce a usable selection path. Only add
  pagination or richer discovery when the current list becomes unwieldy.

**Done when:** both submitted and missing moves advance, verdicts finish,
and the next queued bout starts. Verify the real broadcaster loop as well
as browser UI tests; the mock game does not prove this behavior.

Do not add a new queue-policy flag, automatic queue expiry, or a forfeit
threshold until the walkthrough establishes the need and intended behavior.

## Later — revisit after the loop works

- **Verified identity:** required before claiming secure ownership or running
  meaningful competitive rankings. Current browser IDs and headers are
  forgeable. Choose a provider when implementing; session verification spans
  server routes, not just `identity.ts`. A local UUID alone cannot establish
  ownership for a migration claim.
- **Fight records:** if players need history, start with one authenticated,
  idempotent result per `fight_id` from the broadcaster's verdict. Retried
  delivery must not double-count. Keep playback history separate from game
  outcomes; a missing video clip must not change a verdict. Choose indexes
  and aggregates when access patterns justify them.
- **Navigation/about and visual design:** add what people need to find the
  existing loop; a new page or brand pass is not a prerequisite.
- **Episodes, manual composition, replays, tournaments, rankings, and a real
  browser lobby server:** separate projects with their own demonstrated need.
  The director already groups shots and tags them with `fight_id`; do not
  introduce an episode storage/director layer just to organize existing bouts.

Work in order: shared catalog → honest status → prove the chat loop. Stop
when the acceptance checks pass; later ideas are not release requirements.
