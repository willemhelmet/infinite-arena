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
const LLM_PORT = 3211;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
  },
  webServer: [
    {
      // A deterministic OpenAI-compatible stand-in (tests/e2e/mock-llm.mjs)
      // so the coordinator's LLM path runs in the suite without a key.
      command: `node tests/e2e/mock-llm.mjs`,
      url: `http://localhost:${LLM_PORT}/`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { MOCK_LLM_PORT: String(LLM_PORT) },
    },
    {
      command: `pnpm build && pnpm start --port ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        NEXT_PUBLIC_FAST_TIMERS: "1",
        BROADCASTER_SECRET: "test-broadcaster-secret",
        OPENAI_API_KEY: "test-key",
        OPENAI_BASE_URL: `http://localhost:${LLM_PORT}/v1`,
        OPENAI_MODEL: "mock",
      },
    },
  ],
});
