import { expect, test } from "@playwright/test";

// The channel's web half: the arena chat, the show state the broadcaster
// publishes, and the /watch page that renders both. The broadcaster itself
// is a Python process (broadcaster/); here its calls are made directly with
// the shared secret the Playwright config sets.
const SECRET = "test-broadcaster-secret";
const bcast = { "x-broadcaster-secret": SECRET, "Content-Type": "application/json" };

test("chat: viewers post, everyone polls, the broadcaster speaks as the Arena", async ({
  request,
}) => {
  const before = (await (await request.get("/api/chat?since=0")).json()) as { seq: number };

  const anon = await request.post("/api/chat", { data: { text: "hi", handle: "ghost" } });
  expect(anon.status()).toBe(400); // no player id

  const posted = await request.post("/api/chat", {
    headers: { "x-player-id": "player-aaaa-bbbb" },
    data: { text: "!fight Karg", handle: "alice" },
  });
  expect(posted.status()).toBe(201);

  const asArena = await request.post("/api/chat", {
    headers: bcast,
    data: { text: "alice enters the queue.", handle: "Arena", kind: "system" },
  });
  expect(asArena.status()).toBe(201);

  const delta = (await (await request.get(`/api/chat?since=${before.seq}`)).json()) as {
    seq: number;
    messages: { kind: string; handle: string; text: string }[];
  };
  expect(delta.messages.map((m) => [m.kind, m.handle, m.text])).toEqual([
    ["user", "alice", "!fight Karg"],
    ["system", "Arena", "alice enters the queue."],
  ]);
  expect(delta.seq).toBe(before.seq + 2);
});

test("show state: offline until the broadcaster publishes; secret required", async ({
  request,
}) => {
  const state = {
    program: "fight",
    updatedAt: 0,
    nowPlaying: "Round 1 · 1/2",
    fight: {
      id: "f1",
      a: { handle: "alice", playerId: "p1", health: 80, attacked: true, fighter: fighter("Karg") },
      b: { handle: "bob", playerId: "p2", health: 100, attacked: false, fighter: fighter("Vesper") },
      round: 1,
      maxRounds: 5,
      roundState: "open",
      deadlineAt: Date.now() + 60_000,
      narration: null,
    },
    queue: [{ handle: "carol", fighterName: "Brine" }],
    queued: { building: 2, ready: 1 },
  };
  const denied = await request.put("/api/show", { data: state });
  expect(denied.status()).toBe(403);
  const ok = await request.put("/api/show", { headers: bcast, data: state });
  expect(ok.status()).toBe(200);
  const read = (await (await request.get("/api/show")).json()) as typeof state;
  expect(read.program).toBe("fight");
  expect(read.fight?.a.health).toBe(80);
  expect(read.queue[0].handle).toBe("carol");

  // The coordinator endpoints are broadcaster-only too.
  expect((await request.post("/api/coordinator/resolve", { data: {} })).status()).toBe(403);
  expect((await request.post("/api/coordinator/program", { data: {} })).status()).toBe(403);
  const bio = await request.post("/api/coordinator/program", {
    headers: bcast,
    data: { kind: "bio", fighter: fighter("Karg"), setting: null },
  });
  expect(bio.status()).toBe(200);
  const body = (await bio.json()) as { shots: { prompt: string }[]; caption: string };
  expect(body.shots.length).toBeGreaterThanOrEqual(1);
  expect(body.shots[0].prompt).toMatch(/^Hard cut/);
});

test("/watch renders the show, the chat, and lets a viewer talk", async ({ page, request }) => {
  // Put the arena between fights so the panel has something to say.
  await request.put("/api/show", {
    headers: bcast,
    data: { program: "idle", updatedAt: 0, nowPlaying: "Karg · 1/2", fight: null, queue: [] },
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Watch the Arena" }).click();
  await expect(page).toHaveURL(/\/watch$/);
  await expect(page.getByTestId("stream-player")).toBeVisible();
  await expect(page.getByTestId("show-program")).toHaveText("Between fights", { timeout: 10_000 });

  const handle = `viewer${Date.now().toString(36).slice(-5)}`;
  await page.getByTestId("chat-handle").fill(handle);
  await page.getByTestId("chat-input").fill("!queue");
  await page.getByTestId("chat-send").click();
  await expect(
    page.getByTestId("chat-log").getByTestId("chat-message").filter({ hasText: handle }),
  ).toBeVisible({ timeout: 10_000 });
});

function fighter(name: string) {
  return {
    id: name.toLowerCase(),
    name,
    imageUrl: "https://placehold.co/64x64/png",
    description: `${name}, a test fighter`,
    createdBy: "p-test",
  };
}
