import { expect, test } from "@playwright/test";

// Route-level contract: the generate route reports its capability honestly
// given the environment it's started under. (CI runs without a real
// REPLICATE_API_KEY; the dev server picks up .env.local when present.)
test("generate-image GET reports capability shape", async ({ request }) => {
  const res = await request.get("/api/fighters/generate-image");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(typeof body.enabled).toBe("boolean");
});

test("generate-image POST rejects an empty prompt", async ({ request }) => {
  const res = await request.post("/api/fighters/generate-image", {
    data: { prompt: "" },
  });
  // 503 when unconfigured (checked before body validation), 400 otherwise.
  expect([400, 503]).toContain(res.status());
  const body = await res.json();
  expect(body.error).toBeTruthy();
});
