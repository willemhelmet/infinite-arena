import { defineConfig } from "@playwright/test";

// The suite boots its own server with fast timers, so the full
// lobby → countdown → fight → results loop runs in seconds, not minutes.
// Without Redis credentials the server uses its in-memory store, which is
// exactly right here: one `next start` process, rooms shared across every
// browser context the tests open.
//
// It runs against a PRODUCTION build (next build && next start), not next
// dev: under parallel workers, dev-mode on-demand compiles stall page loads
// past expect timeouts and make the suite flaky. The build runs once before
// workers spawn; pages then serve instantly and deterministically. NOTE:
// NEXT_PUBLIC_FAST_TIMERS is set for the build step too, so the fast-timer
// flag is baked into the client bundle (NEXT_PUBLIC_* inlines at build time).
//
// Port 3210 is dedicated to this suite: port 3000 on this machine belongs to
// other projects' dev servers, and reuseExistingServer must never mistake a
// sibling app for ours.
const PORT = 3210;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
  },
  webServer: {
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      NEXT_PUBLIC_FAST_TIMERS: "1",
    },
  },
});
