# Onboarding: Infinite Arena

Infinite Arena is a Next.js 15 (App Router) fighting game. You forge a
fighter (name, description, portrait), enter an arena against an opponent,
and each round both players type an attack in plain text. A narrator
resolves the two attacks, health drops, and after up to five rounds there
is a verdict. The end state is a live AI-generated video feed of the fight
on Reactor's `fast-h3` model, with an LLM "narrative coordinator" turning
each round into the next scene prompt.

The product is **one always-on channel**: a Python broadcaster
(`broadcaster/`) owns a fast-h3 session and streams it ourselves (HLS, no
Twitch or YouTube). Between fights it airs fighter bios. Viewers on the
`/watch` page type `!fight <fighter>` in the arena's own chat to line up,
and `!attack <text>` each round when they're on; an LLM narrative
coordinator judges each round and writes the fast-h3 shots that go on air.
The web app (Next.js on Vercel) is the fighter forge, the registry, the
chat, the show-state endpoint, the coordinator, and the player page.

There is also the older room-based web game (`/games/*`): two browsers,
rounds judged by the same coordinator, with a mock video panel. It still
works and shares the engine; the channel is the direction.

## Heads up: two docs in this repo are stale

- `README.md` and `skill/SKILL.md` describe **FastH3 Episodes**, the
  starter this repo was forked from (an episode composer with
  `app/FastH3App.tsx`, `EpisodeComposer.tsx`, etc.). None of those files
  exist here. Ignore the README's code tour.
- `skill/SKILL.md` is still worth reading for one thing: the fast-h3
  **model contract** (queue semantics, chaining via `continue_from_clip_id`,
  the hard-cut prompting rule, the token/auth rules). That knowledge is
  what the parked live feed will need. Its file paths are wrong for this
  repo.
- Nothing in `src/` imports `@reactor-models/fast-h3` or `@reactor-team/js-sdk`
  yet. They are in `package.json` for the live phase.

## Quick start

```bash
cp .env.example .env.local   # everything is optional for the graybox
pnpm install
pnpm dev                     # http://localhost:3000
```

Node 22 and pnpm 10 are what the lockfile was built with. The repo is its
own pnpm workspace root (`pnpm-workspace.yaml` with `packages: []`), so
installing here works even when the folder is nested in another workspace.

Environment variables (all optional right now, see `.env.example`):

| Variable                | Used by                                        | Without it                                   |
| ----------------------- | ---------------------------------------------- | -------------------------------------------- |
| `UPSTASH_REDIS_REST_URL` + `_TOKEN` | `src/server/game/kv.ts`            | Locally: rooms live in the dev server's memory. On Vercel: every game API call 500s, on purpose. `KV_REST_API_URL`/`_TOKEN` also accepted. |
| `REACTOR_API_KEY`       | `src/app/api/reactor/token/route.ts`           | Token route 500s. Nothing calls it yet.      |
| `REPLICATE_API_KEY`     | `src/app/api/fighters/generate-image/route.ts` | "Generate" portrait tab is disabled, upload still works. |
| `BLOB_READ_WRITE_TOKEN` | `src/lib/images/blobStore.ts`                  | Images become `data:` URIs (fine locally, not fetchable by H3). |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` | `src/server/game/coordinator.ts` | Rounds are judged by the deterministic fallback (longer attack wins, templated shots). Any OpenAI-compatible endpoint works. |
| `NEXT_PUBLIC_FAST_TIMERS=1` | `src/lib/game/rules.ts`                    | Countdown ticks and the client poll run at 1/5 speed. Set by the e2e config. |
| `NEXT_PUBLIC_H3_LIVE=1` | `src/features/fight/FightScreen.tsx`           | Fight screen mounts the (parked) live feed instead of the mock panel. |
| `BROADCASTER_SECRET`    | `src/server/broadcaster.ts`                    | Show publish, Arena chat posts, and coordinator endpoints are closed. Must equal the broadcaster's. |
| `NEXT_PUBLIC_STREAM_URL`| `src/features/watch/StreamPlayer.tsx`          | `/watch` shows "no stream configured" instead of the player. Point at the broadcaster's `live.m3u8`. |

## Scripts

```bash
pnpm dev          # next dev
pnpm build        # next build
pnpm start        # next start
pnpm typecheck    # tsc --noEmit  (strict mode; passes clean on main)
pnpm test:e2e     # playwright test (builds prod first, see below)
```

There is no lint script, no unit test runner, and no CI workflow. The
e2e suite is the only automated check besides `tsc`.

## Route map

| URL                      | Page file                                  | Screen component                  |
| ------------------------ | ------------------------------------------ | --------------------------------- |
| `/`                      | `src/app/page.tsx`                         | `features/entry/EntryMenu`        |
| `/fighters/new`          | `src/app/fighters/new/page.tsx`            | `features/fighter/CreateFighterForm` |
| `/fighters`              | `src/app/fighters/page.tsx`                | `features/roster/FighterGallery`  |
| `/watch`                 | `src/app/watch/page.tsx`                   | `features/watch/WatchScreen`      |
| `/games`                 | `src/app/games/page.tsx`                   | `features/games/GameList`         |
| `/games/new`             | `src/app/games/new/page.tsx`               | `features/games/CreateServerForm` |
| `/games/[roomId]/lobby`  | `src/app/games/[roomId]/lobby/page.tsx`    | `features/lobby/LobbyScreen`      |
| `/games/[roomId]/fight`  | `src/app/games/[roomId]/fight/page.tsx`    | `features/fight/FightScreen`      |
| `/games/[roomId]/results`| `src/app/games/[roomId]/results/page.tsx`  | `features/results/ResultsScreen`  |
| `/api/game/events`       | POST `{event, cursor}` → `SyncResponse`    | Applies one `ClientEvent`, returns what the client missed |
| `/api/game/poll`         | GET `?roomId=&seq=` → `SyncResponse`       | Polled every second by the client |
| `/api/reactor/token`     | GET, mints a scoped Reactor JWT            |                                   |
| `/api/fighters/generate-image` | GET capability, POST `{prompt}` → `{imageUrl}` | Replicate flux-schnell    |
| `/api/fighters/upload-image`   | POST multipart `file` → `{imageUrl}`  | 4 MB max, png/jpeg/webp/gif       |
| `/api/fighters/registry` | GET all, POST `Fighter`, DELETE `?id=`     | The shared fighter catalog in Redis; writes need `x-player-id` = `createdBy` |
| `/api/chat`              | GET `?since=seq`, POST `{text, handle}`    | The arena chat; the broadcaster posts as Arena/Narrator with the secret |
| `/api/show`              | GET, PUT (secret)                          | `ShowState` the broadcaster publishes; goes `offline` when stale |
| `/api/coordinator/resolve` | POST (secret)                            | Judge one chat-fight round; same `resolveRound` as the web game |
| `/api/coordinator/program` | POST (secret) `{kind: bio|card|verdict}` | Storyboards for the programming between rounds |

Pages are thin server components that wrap a client screen in
`ArenaShell`. All logic lives in `src/features/*` and `src/lib/*`.

## Architecture: client seam, HTTP transport, server engine

This is the most important thing to understand. Every screen talks to the
game through one interface and one React context. The transport is HTTP
polling, and the server owns all game state.

```
screens (features/*) ─useGame()─▶ GameProvider ─▶ GameClient (HttpGameClient)
                                      │                 │ POST /api/game/events
                                 gameReducer            │ GET  /api/game/poll (1s)
                                 TypedGameState         ▼
                                                 server/game/engine.ts
                                                        │ per-room lock
                                                 server/game/store.ts
                                                        │
                                                 server/game/kv.ts ─▶ Upstash Redis
                                                                     (MemoryKV locally)
```

Client side, in `src/lib/game/`:

- `gameClient.ts` is the `GameClient` interface: `connect`, `disconnect`,
  `send(ClientEvent)`, `subscribe(listener)`.
- `protocol.ts` defines the wire vocabulary. `ClientEventSchema` is a Zod
  discriminated union and the type is inferred from it, so the server
  validates exactly what the client type allows. `ServerEvent` is the
  broadcast side. `SyncResponse` and `EventCursor` describe the polling
  contract.
- `schemas.ts` holds the Zod schemas for `Fighter`, `Room`, `PlayerSlot`,
  `FightRound`, `FightResult`. Shared vocabulary for both sides.
- `state.ts` is the reducer. Every `ServerEvent` folds into one
  `TypedGameState` with a coarse `phase`. Screens gate on `phase` and
  navigate with `useEffect` when it changes.
- `GameProvider.tsx` creates the client once, subscribes, reduces events,
  and exposes `{ state, send, dispatchUi, selfPlayerId }` via `useGame()`.
  It queues `send` calls made before `connect()` resolves and keeps `send`
  referentially stable. Read the comment about the infinite-loop trap.
- `httpGameClient.ts` is the transport. Commands POST to the events route.
  A timer polls the room's event log every `POLL_INTERVAL_MS`. It tracks a
  cursor `{roomId, seq}` and drops events a racing request already
  delivered. When the server reports no room but the client had one, it
  synthesizes `room_closed`.
- `createGameClient.ts` is the one line that picks the transport.
- `rules.ts` holds `MAX_ROUNDS`, countdown timing, poll interval, room TTL,
  and the narration templates. Both sides import it.

Server side, in `src/server/game/`:

- `engine.ts` is the authoritative game logic. Every handler loads the room
  under a lock, mutates it, appends `ServerEvent`s to the room's log, and
  saves. `sync()` returns either a delta after the client's cursor or, for a
  client that isn't following this room yet, a snapshot that rebuilds the
  current phase (room state, countdown, fight history, verdict). The
  countdown is advanced lazily by whatever request touches the room next.
- `store.ts` is persistence: room record, append-only event log, the
  public-rooms set, the player → room index, and `withRoomLock`. Everything
  carries `ROOM_TTL_SECONDS` so abandoned arenas expire.
- `kv.ts` is the key-value layer. `UpstashKV` uses `@upstash/redis` over
  REST. `MemoryKV` is a process-local map. The factory refuses to fall back
  to memory when `VERCEL` is set, because separate function instances would
  each have their own rooms, which is the exact bug this layer fixes.
- `http.ts` is shared route plumbing: the `x-player-id` header check, the
  cursor schema, `no-store` JSON responses, and error mapping.
- `coordinator.ts` is the narrative coordinator. Given both attacks, the
  fighters, health, and the last rounds, it returns damage for each side,
  a narration, the arena's fixed `setting`, and 2 to 3 fast-h3 shots. It
  calls an OpenAI-compatible chat endpoint with a JSON response format and
  validates the reply with Zod. On no key, a failed call, or malformed
  output it uses `fallbackResolve`, so a fight never stalls on the LLM.
  `SYSTEM_PROMPT` in this file is the only place the H3 prompting rules
  live: a condensation of Reactor's FastH3 prompt guide (no memory between
  clips, 800-char cap, picture and sound co-equal, one camera instruction,
  hard cuts on continuation, positive descriptions only). Edit them there.

How a round resolves. The second `submit_prompt` marks the round
`resolvingSince` and commits under the lock, then releases it. The judge
runs with no lock held, so both players' polls keep flowing and show the
"narrator weighs both moves" state. A fresh lock then applies the verdict
if the round is still the one judged. If the judging request dies, the
next request to touch the room after `RESOLVE_TIMEOUT_MS` applies the
fallback judge from `advance()`. The events route sets `maxDuration = 60`
for this.

Rules that follow from this design:

1. Screens never hold game state themselves. Read `state`, dispatch a
   `ClientEvent`, react to `phase`.
2. New server behavior means a new `ServerEvent` in `protocol.ts`, a case
   in `state.ts`, an emit in `engine.ts`, and usually a line in
   `snapshot()` so a refreshing client can rebuild it. Keep all of them in
   step.
3. Event ordering matters. The engine pushes `room_state` **before**
   `fight_ended` because a `room_state` arriving on the results screen
   reads as a rematch signal and would cancel the results navigation. Read
   the `room_state` case in the reducer before touching either side.
4. Every read-modify-write of a room goes through `withRoomLock`. Vercel
   runs requests concurrently and both players act in the same second.
5. Humans only. There are no bots: a room waits until a second player
   joins, and a host leaving (or anyone leaving mid-fight) closes it.

## The channel: broadcaster + web

```
viewer's browser ── /watch ──┬── hls.js ──▶ broadcaster HLS (:8088/live.m3u8)
                             ├── GET /api/show   ◀── PUT (secret) ──┐
                             └── GET/POST /api/chat ◀── polls/posts ─┤
                                                                     │
                     broadcaster/ (Python, any box with ffmpeg) ─────┘
                       show.py ──▶ /api/coordinator/{resolve,program} (secret)
                       reactor_link.py ◀──▶ fast-h3 (REACTOR_API_KEY)
                       pacer → overlay → sinks/hls.py (ffmpeg)
```

- `src/lib/show/schema.ts` is the contract between the two halves:
  `ShowState`, `ChatMessage`, the chat command list. The Python side
  mirrors it by hand in `show.py`'s `show_state()`.
- `src/server/chat/store.ts` is the chat: a capped Redis list with a global
  sequence; pollers ask for everything after their seq.
- `src/server/show/store.ts` holds the latest `ShowState`; a state older
  than 30 seconds reads as `offline`, so a dead broadcaster can't leave a
  phantom fight on the page.
- `src/server/broadcaster.ts` is the one auth check: the
  `x-broadcaster-secret` header against `BROADCASTER_SECRET`.
- The coordinator's `programShots` (bio, card, verdict) lives next to
  `resolveRound` in `coordinator.ts`, same prompt rules, same fallback
  pattern.
- `broadcaster/README.md` covers the Python side: programs, gating, queue
  policy, the HLS sink, running it. `broadcaster/tests/test_show.py` runs a
  full idle → card → fight → verdict cycle against fakes.

## Things that live outside the protocol on purpose

- **Player identity**: `src/lib/identity.ts`. A UUID in localStorage under
  `infinite-arena:player-id`, sent to the server as the `x-player-id`
  header on every game request. There is no auth; whoever presents an id is
  that player. `getSelfPlayerId()` returns `""` during SSR; use
  `useSelfPlayerId()` in components.
- **Fighter roster and registry**: two layers. `src/lib/fighters/roster.ts`
  is this browser's hand: per-browser, in localStorage under
  `infinite-arena:roster`, validated with Zod on read, and what the roster
  picker offers. `src/server/fighters/registry.ts` is the shared catalog in
  Redis (never expires): saving a fighter publishes it there, the View
  Fighters page lists everyone's, "Use this fighter" imports one into the
  local roster keeping its id, and the gallery back-fills any local fighters
  the registry doesn't know. Only the creator (by `x-player-id`) can register
  or retire a fighter.
  This will become a REST resource, not a WS message, so it stays out of
  `GameClient`.
- **Fighter images**: `src/lib/fighters/api.ts` wraps the two image routes.
  Both routes re-host the image through `putPublicImage` in
  `src/lib/images/blobStore.ts` so the URL is durable and public. H3 will
  eventually consume these as first frames, and it cannot fetch `data:`
  URIs, so the Blob fallback warning is not noise.

## The parked live-video seams

Three files exist only to hold the shape of what comes next. Do not delete
them and do not wire them up piecemeal.

- `src/features/fight/H3Feed.tsx`: `mode="mock"` renders `MockH3Feed`;
  `mode="live"` renders a placeholder. The plan is `<FastH3Provider
  jwtToken={fetchToken}>` plus the video view, enqueueing one chained clip
  per resolved round.
- `src/lib/reactor/tokenResolver.ts`: the memoized JWT resolver, copied
  from the starter. Read the comment block. It must return the same token
  for the token's whole life and coalesce parallel calls.
- `src/lib/reactor/roundTag.ts`: the metadata tag `{roomId, round}` that
  will be written on every enqueued clip and read back off the echo.

The shots to render come from each `round_resolved` event's `shots`
array, already in the order to chain them. The live feed's job is one
`enqueue` per shot with `continue_from_clip_id` threaded from the previous
reply, and `metadata` from `roundTag.ts`.

## UI conventions

- Tailwind v4 via `@tailwindcss/postcss`. Theme tokens are declared in
  `src/app/globals.css` and alias Reactor brand variables from
  `@reactor-team/ui/styles.css`: `bg-brand`, `text-brand-fg`,
  `bg-active`, `font-sans`, `font-mono`.
- Do **not** import React components from `@reactor-team/ui`. They use
  hooks and break in server components. Use the CSS tokens.
- Shared primitives live in `src/components/`: `ArenaShell` (page frame),
  `ArenaPanel` (card), `ArenaButton` (variants `primary`, `ghost`,
  `danger`, plus a `testId` prop), `HealthBar`, `Modal`.
- The dark zinc palette (`bg-zinc-950`, `text-zinc-100`) is hardcoded
  everywhere. This is a graybox; there is no light theme.
- Interactive elements get a `data-testid`. The e2e suite depends on them,
  so keep existing ids stable and add one to anything new a test might
  click.
- Path alias `@/*` maps to `./src/*`.

## Testing

`pnpm test:e2e` runs Playwright against a **production build** on port
3210 with `NEXT_PUBLIC_FAST_TIMERS=1` baked in. No Redis is needed: the
single `next start` process uses `MemoryKV`, so rooms are shared across
every browser context a test opens. The config also starts
`tests/e2e/mock-llm.mjs` on port 3211, a deterministic OpenAI-compatible
stand-in, and points the app at it, so the coordinator's real LLM path runs
in the suite. An attack containing `GARBAGE` makes the mock reply with
non-JSON, which exercises the fallback judge. The config comment explains
why: dev-mode compiles under parallel workers made the suite flaky, and
`NEXT_PUBLIC_*` values inline at build time so the flag has to be set for
the build step too. Expect the first run to take a couple of minutes for
the build.

Specs in `tests/e2e/`:

- `entry.spec.ts`: menu renders, how-to-play modal, nav buttons route.
- `create-fighter.spec.ts` and `upload-fighter.spec.ts`: both portrait
  paths save to the roster in localStorage.
- `create-server-flow.spec.ts`: two browser contexts. Host creates, the
  joiner sees the arena appear on the list and joins, both ready, five
  rounds judged by the mock LLM (round 3 through the fallback), the
  storyboard renders, the same verdict on both screens, rematch returns
  both to the lobby.
- `join-game-flow.spec.ts`: the arena list updates live as rooms open and
  close, and a private arena stays off the list but is joinable by link.
- `generate-image-route.spec.ts`: route-level contract for the generate
  endpoint, works with or without a Replicate key.
- `fighter-gallery.spec.ts`: a fighter forged in one context appears in
  another's View Fighters, can be imported into that roster, and its creator
  can retire it; plus the registry refuses writes for someone else's fighter.
- `watch.spec.ts`: the chat API (viewer posts, Arena posts with the secret,
  seq-based polling), show state publish/read and its 403s, a bio program
  from the coordinator, and the `/watch` page sending a message.

`tests/e2e/helpers.ts` mocks both image routes with `page.route` so no
real Replicate or Blob calls happen. Use `mockImageRoutes` and
`createFighterViaUi` in any new flow spec.

The two-player fight spec makes the host's attack always longer than the
joiner's. One round's damage is at most 24, so the joiner can only be
knocked out in round 5, which makes the fight exactly `MAX_ROUNDS` long and
removes any race on early exits. Keep that property if you touch it.

One thing to know before trusting a red run:

- **Remote Claude Code sandbox**: the preinstalled Chromium at
  `/opt/pw-browsers/chromium` is a different build than the headless
  shell Playwright 1.62 looks for, so every test fails at browser launch
  with "Executable doesn't exist". Do not run `playwright install`. Instead
  run with a wrapper config that spreads the repo config and adds
  `use.launchOptions.executablePath: "/opt/pw-browsers/chromium"` plus
  `webServer.cwd` pointing at the repo. With that, the suite runs.
Verified on a fresh clone in the remote sandbox: `pnpm typecheck` clean
and all e2e tests pass with the executable-path wrapper.

## Suggested first tasks

- Fix `README.md` so it describes this repo instead of the starter.
- Add a lint script (`next lint` or ESLint flat config). There is an
  `eslint-disable` comment in `RosterPicker.tsx` but no ESLint config.
- Tune `SYSTEM_PROMPT` in the coordinator against real fights. The
  `lintShotPrompt` warnings in the Vercel function logs point at shots
  that break the FastH3 prompt guide (missing hard cut, no soundscape,
  negations, cross-clip references).
- Reconnect on the results screen: after a refresh mid-results the
  snapshot replays the verdict, but a refresh on the lobby URL of a room
  you're not in shows the join picker even when the room is full.
- Run the broadcaster against the real deployment and tune: round clock,
  idle target, gate timeout, the overlay's layout on the actual canvas.
- Retire or fold the room-based web game (`/games/*`) into the channel once
  the chat game is the way people play.

## Git and workflow

- Default branch is `main`. There is a single initial commit as of this
  writing, so history has no conventions to inherit yet.
- No CI, no PR template, no `.github/` directory.
- `.gitignore` excludes `.env`, `.env.local`, `.next`, `node_modules`.
  `test-results/.last-run.json` is committed; Playwright rewrites it on
  every run, so expect it to show as modified after `pnpm test:e2e`.
