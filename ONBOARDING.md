# Onboarding: Infinite Arena

Infinite Arena is a Next.js 15 (App Router) fighting game. You forge a
fighter (name, description, portrait), enter an arena against an opponent,
and each round both players type an attack in plain text. A narrator
resolves the two attacks, health drops, and after up to five rounds there
is a verdict. The end state is a live AI-generated video feed of the fight
on Reactor's `fast-h3` model, with an LLM "narrative coordinator" turning
each round into the next scene prompt.

Today the repo is a **graybox**: the whole lobby → countdown → fight →
results loop works end to end against an in-memory mock server with a bot
opponent. The live video feed and the LLM coordinator are parked behind
clearly marked seams. Read this doc to learn where those seams are.

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
| `REACTOR_API_KEY`       | `src/app/api/reactor/token/route.ts`           | Token route 500s. Nothing calls it yet.      |
| `REPLICATE_API_KEY`     | `src/app/api/fighters/generate-image/route.ts` | "Generate" portrait tab is disabled, upload still works. |
| `BLOB_READ_WRITE_TOKEN` | `src/lib/images/blobStore.ts`                  | Images become `data:` URIs (fine locally, not fetchable by H3). |
| `OPENAI_*`              | nothing yet                                    | Reserved for the narrative coordinator.      |
| `NEXT_PUBLIC_MOCK_FAST=1` | `src/lib/game/mockBotBehavior.ts`            | Bot/countdown timers run at 1/10 speed. Set by the e2e config. |
| `NEXT_PUBLIC_H3_LIVE=1` | `src/features/fight/FightScreen.tsx`           | Fight screen mounts the (parked) live feed instead of the mock panel. |

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
| `/games`                 | `src/app/games/page.tsx`                   | `features/games/GameList`         |
| `/games/new`             | `src/app/games/new/page.tsx`               | `features/games/CreateServerForm` |
| `/games/[roomId]/lobby`  | `src/app/games/[roomId]/lobby/page.tsx`    | `features/lobby/LobbyScreen`      |
| `/games/[roomId]/fight`  | `src/app/games/[roomId]/fight/page.tsx`    | `features/fight/FightScreen`      |
| `/games/[roomId]/results`| `src/app/games/[roomId]/results/page.tsx`  | `features/results/ResultsScreen`  |
| `/api/reactor/token`     | GET, mints a scoped Reactor JWT            |                                   |
| `/api/fighters/generate-image` | GET capability, POST `{prompt}` → `{imageUrl}` | Replicate flux-schnell    |
| `/api/fighters/upload-image`   | POST multipart `file` → `{imageUrl}`  | 4 MB max, png/jpeg/webp/gif       |

Pages are thin server components that wrap a client screen in
`ArenaShell`. All logic lives in `src/features/*` and `src/lib/*`.

## Architecture: the game client seam

This is the most important thing to understand. Every screen talks to the
game through one interface and one React context, and nothing else.

```
screens (features/*)  ──useGame()──▶  GameProvider  ──▶  GameClient
                                          │                  │
                                    gameReducer         MockGameServer (today)
                                    TypedGameState      WsGameClient   (later)
```

- `src/lib/game/gameClient.ts` is the `GameClient` interface: `connect`,
  `disconnect`, `send(ClientEvent)`, `subscribe(listener)`.
- `src/lib/game/protocol.ts` defines `ClientEvent` and `ServerEvent`
  unions. They are shaped like a real WebSocket protocol on purpose.
- `src/lib/game/schemas.ts` holds the Zod schemas and inferred types for
  `Fighter`, `Room`, `PlayerSlot`, `FightRound`, `FightResult`. These are
  the shared vocabulary; a real server must speak these exact shapes.
- `src/lib/game/state.ts` is the reducer. Every `ServerEvent` folds into
  one `TypedGameState` with a coarse `phase` (`menu`, `lobby`, `countdown`,
  `fight`, `results`, ...). Screens gate on `phase` and navigate with
  `useEffect` when it changes.
- `src/lib/game/GameProvider.tsx` creates the client once, subscribes,
  reduces events, and exposes `{ state, send, dispatchUi, selfPlayerId }`
  via `useGame()`. It queues `send` calls made before `connect()` resolves
  and keeps `send` referentially stable. Do not add a `send` dependency
  loop; the comment in the file explains the infinite-loop trap.
- `src/lib/game/createGameClient.ts` is the **one line to change** when a
  real backend arrives. Today it returns `new MockGameServer()`.
- `src/lib/game/mockGameServer.ts` is the fully client-side server: seeded
  public rooms hosted by bots, a "corridor bot" that joins rooms you host,
  a bot that readies after you, a 3-second countdown, and a round resolver
  that favors the longer attack text and knocks off 10 to 24 health.
- `src/lib/game/mockBotBehavior.ts` holds every timer constant, the seeded
  bots, and the canned bot prompts and narration templates.

Rules that follow from this design:

1. Screens never hold game state themselves. Read `state`, dispatch a
   `ClientEvent`, react to `phase`.
2. New server behavior means a new `ServerEvent` in `protocol.ts`, a case
   in `state.ts`, and a handler in `mockGameServer.ts`. Keep all three in
   step.
3. Event ordering matters. The mock server pushes `room_state` **before**
   `fight_ended` because a `room_state` arriving on the results screen
   reads as a rematch signal and would cancel the results navigation. Read
   the `room_state` case in the reducer before touching either side.

## Things that live outside the protocol on purpose

- **Player identity**: `src/lib/identity.ts`. A UUID in localStorage under
  `infinite-arena:player-id`. `getSelfPlayerId()` returns `""` during SSR;
  use `useSelfPlayerId()` in components.
- **Fighter roster**: `src/lib/fighters/roster.ts`. Per-browser, stored in
  localStorage under `infinite-arena:roster`, validated with Zod on read.
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

The `previousClipId` field on the mock server's fight loop state is also
reserved for chaining.

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
3210 with `NEXT_PUBLIC_MOCK_FAST=1` baked in. The config comment explains
why: dev-mode compiles under parallel workers made the suite flaky, and
`NEXT_PUBLIC_*` values inline at build time so the flag has to be set for
the build step too. Expect the first run to take a couple of minutes for
the build.

Specs in `tests/e2e/`:

- `entry.spec.ts`: menu renders, how-to-play modal, nav buttons route.
- `create-fighter.spec.ts` and `upload-fighter.spec.ts`: both portrait
  paths save to the roster in localStorage.
- `create-server-flow.spec.ts`: host path, entry to results.
- `join-game-flow.spec.ts`: joiner path, entry to results to rematch.
- `generate-image-route.spec.ts`: route-level contract for the generate
  endpoint, works with or without a Replicate key.

`tests/e2e/helpers.ts` mocks both image routes with `page.route` so no
real Replicate or Blob calls happen. Use `mockImageRoutes` and
`createFighterViaUi` in any new flow spec.

The fight-loop specs deliberately loop "until results URL or narration for
round N appears" instead of asserting a fixed round count, because a KO can
end the fight early and the mock's round resolver is random. Copy that
pattern rather than asserting on specific narration text.

Two things to know before trusting a red run:

- **Remote Claude Code sandbox**: the preinstalled Chromium at
  `/opt/pw-browsers/chromium` is a different build than the headless
  shell Playwright 1.62 looks for, so every test fails at browser launch
  with "Executable doesn't exist". Do not run `playwright install`. Instead
  run with a wrapper config that spreads the repo config and adds
  `use.launchOptions.executablePath: "/opt/pw-browsers/chromium"` plus
  `webServer.cwd` pointing at the repo. With that, the suite runs.
- **Known flake in the two fight-loop specs**: when no knockout happens,
  the fight ends after round 5 and the loop still enters a sixth
  iteration. It races the results navigation and fails on a detached
  `attack-input`. Cap the loop at `MAX_ROUNDS` or wait for the results URL
  after the fifth narration. On a fast machine the navigation usually
  wins; in the remote sandbox it usually loses.

Verified on a fresh clone in the remote sandbox: `pnpm typecheck` clean,
6 of 8 e2e tests pass, the 2 failures are the flake above.

## Suggested first tasks

- Fix `README.md` so it describes this repo instead of the starter.
- Fix the fight-loop e2e race described under Testing.
- Add a lint script (`next lint` or ESLint flat config). There is an
  `eslint-disable` comment in `RosterPicker.tsx` but no ESLint config.
- Wire the OpenAI-compatible narrative coordinator behind a new API route
  and make the mock server call it in `resolveRound` when a key is
  present, keeping the length-based resolver as the fallback.
- Implement `LiveH3Feed` per `skill/SKILL.md`'s queue and auth contract.

## Git and workflow

- Default branch is `main`. There is a single initial commit as of this
  writing, so history has no conventions to inherit yet.
- No CI, no PR template, no `.github/` directory.
- `.gitignore` excludes `.env`, `.env.local`, `.next`, `node_modules`.
  `test-results/.last-run.json` is committed; Playwright rewrites it on
  every run, so expect it to show as modified after `pnpm test:e2e`.
