import { expect, test, type Page } from "@playwright/test";
import { MAX_ROUNDS } from "../../src/lib/game/rules";
import { createFighterViaUi, mockImageRoutes } from "./helpers";

// Two real players in two browser contexts, against the real HTTP game
// server: host creates an arena → joiner finds it on the live list → both
// ready → countdown → five rounds → the same verdict on both screens → rematch.
test("two players fight from the arena list to a shared verdict", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  await mockImageRoutes(host);
  await mockImageRoutes(guest);

  await host.goto("/");
  await createFighterViaUi(host, "Arena Host");
  await guest.goto("/");
  await createFighterViaUi(guest, "Arena Joiner");

  // Host opens an arena with a unique name.
  const arenaName = `Crucible ${Date.now().toString(36)}`;
  await host.goto("/games/new");
  await host.getByTestId("arena-name-input").fill(arenaName);
  await host.getByTestId("roster-picker").getByText("Arena Host").click();
  await host.getByTestId("create-server-button").click();
  await host.waitForURL(/\/games\/[^/]+\/lobby/);
  const roomId = host.url().match(/\/games\/([^/]+)\/lobby/)![1];

  // The joiner sees it appear on the list without refreshing, and joins.
  await guest.goto("/games");
  const item = guest
    .getByTestId("game-list")
    .locator("div", { has: guest.getByText(arenaName, { exact: true }) })
    .first();
  await expect(item).toBeVisible({ timeout: 15_000 });
  await item.getByRole("button", { name: "Join", exact: true }).click();
  await guest.waitForURL(new RegExp(`/games/${roomId}/lobby`));
  await guest.getByTestId("roster-picker").getByText("Arena Joiner").click();
  await guest.getByTestId("join-with-fighter").click();

  // Both lobbies show both fighters.
  await expect(host.getByText("Arena Joiner")).toBeVisible({ timeout: 15_000 });
  await expect(guest.getByText("Arena Host")).toBeVisible({ timeout: 15_000 });

  // Host readies first; the joiner sees the pill flip before readying too.
  await host.getByTestId("ready-toggle").click();
  await expect(
    guest.getByTestId("ready-pill").filter({ hasText: /^Ready$/ }),
  ).toBeVisible({ timeout: 15_000 });
  await guest.getByTestId("ready-toggle").click();

  // Countdown → fight, on both screens.
  await host.waitForURL(/\/fight/, { timeout: 20_000 });
  await guest.waitForURL(/\/fight/, { timeout: 20_000 });
  await expect(host.getByTestId("mock-h3-feed")).toBeVisible();

  // The graybox resolver favors the longer attack, and one round's damage is
  // at most 24, so a host who always writes more can only KO in round 5.
  // That makes the fight exactly MAX_ROUNDS long — no race on early exits.
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    await attack(
      guest,
      `Joiner round ${round}: a quick jab.`,
    );
    await attack(
      host,
      `Host round ${round}: a sweeping, thunderous strike that cannot be matched by mortal means.`,
    );
    // Both see the narrator's call for this round.
    await waitForNarration(host, round);
    await waitForNarration(guest, round);
  }

  // Same verdict on both screens.
  await host.waitForURL(/\/results/, { timeout: 30_000 });
  await guest.waitForURL(/\/results/, { timeout: 30_000 });
  await expect(host.getByTestId("winner-card")).toContainText("Victory");
  await expect(guest.getByTestId("winner-card")).toContainText("Defeat");
  await expect(guest.getByTestId("winner-card")).toContainText("Arena Host");
  await expect(
    host.getByTestId("rounds-recap").getByText(`Round ${MAX_ROUNDS}`, { exact: true }),
  ).toBeVisible();

  // Rematch resets the room and returns both players to the lobby.
  await host.getByTestId("rematch-button").click();
  await host.waitForURL(/\/lobby/, { timeout: 15_000 });
  await guest.waitForURL(/\/lobby/, { timeout: 15_000 });
  await expect(host.getByTestId("ready-toggle")).toBeVisible();
});

async function attack(page: Page, text: string) {
  const input = page.getByTestId("attack-input");
  await expect(input).toBeEnabled({ timeout: 15_000 });
  await input.fill(text);
  await page.getByTestId("attack-submit").click();
}

// The round's narration lands on the ticker (tagged R{n}). Evaluated inside
// the page: far more reliable than locator polling across fast-moving state.
async function waitForNarration(page: Page, round: number) {
  await page.waitForFunction(
    (r) =>
      (
        document.querySelector('[data-testid="narration-ticker"]')?.textContent ??
        ""
      ).includes(`R${r}`),
    round,
    { timeout: 15_000 },
  );
}
