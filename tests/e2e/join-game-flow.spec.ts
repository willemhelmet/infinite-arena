import { expect, test } from "@playwright/test";
import { createFighterViaUi, mockImageRoutes } from "./helpers";

// The full loop as a joiner: browse seeded arenas → join → pick fighter →
// ready → bot readies → countdown → fight rounds → verdict → rematch/menu.
test("join flow runs entry to results", async ({ page }) => {
  test.setTimeout(120_000);
  await mockImageRoutes(page);
  await page.goto("/");
  await createFighterViaUi(page, "Arena Joiner");

  // Browse the seeded arenas.
  await page.goto("/games");
  await expect(page.getByTestId("game-list")).toBeVisible();
  const joinButtons = page.getByRole("button", { name: "Join", exact: true });
  // Seeded arenas arrive on the list_rooms roundtrip — wait for one to render.
  await expect(joinButtons.first()).toBeVisible({ timeout: 15_000 });
  await joinButtons.first().click();
  await page.waitForURL(/\/games\/[^/]+\/lobby/);

  // Choose the same fighter to enter with.
  await expect(page.getByTestId("roster-picker")).toBeVisible();
  await page.getByTestId("roster-picker").getByText("Arena Joiner").click();
  await page.getByTestId("join-with-fighter").click();

  // In the lobby: our slot shows the fighter.
  await expect(page.getByTestId("lobby-slots")).toBeVisible();
  await expect(page.getByText("Arena Joiner")).toBeVisible();

  // Ready up — the bot follows, the fast countdown (300ms beats in test mode)
  // flashes the 3-2-1 overlay, and the fight begins. The overlay is too quick
  // to assert reliably; the fight transition is the load-bearing signal.
  await page.getByTestId("ready-toggle").click();
  await page.waitForURL(/\/fight/, { timeout: 15_000 });
  await expect(page.getByTestId("mock-h3-feed")).toBeVisible();

  // Fight until the verdict: attack whenever the input unlocks. The fight can
  // end early on a KO, so loop on "results URL reached" rather than a fixed
  // round count.
  for (let round = 1; round <= 6; round++) {
    const input = page.getByTestId("attack-input");
    await expect(input).toBeEnabled({ timeout: 15_000 });
    // Long attacks win rounds in the graybox resolver.
    await input.fill(
      `Round ${round}: I launch a devastating combination of strikes that overwhelms any defense completely.`,
    );
    await page.getByTestId("attack-submit").click();
    // Either the round's narration lands (R{round} tag on the ticker) or the
    // fight ended outright. waitForFunction evaluates inside the page, which
    // proved far more reliable here than locator polling across a fast-moving
    // fight — with mock fast timers the whole fight can resolve in ~2s.
    await page.waitForFunction(
      (r) => {
        return (
          window.location.href.includes("/results") ||
          (document
            .querySelector('[data-testid="narration-ticker"]')
            ?.textContent ?? ""
          ).includes(`R${r}`)
        );
      },
      round,
      { timeout: 15_000 },
    );
    if (page.url().includes("/results")) break;
  }

  // Verdict.
  await page.waitForURL(/\/results/, { timeout: 30_000 });
  await expect(page.getByTestId("winner-card")).toBeVisible();
  await expect(page.getByTestId("rounds-recap")).toBeVisible();
  await expect(
    page.getByTestId("rounds-recap").getByText("Round 1", { exact: true }),
  ).toBeVisible();

  // Rematch returns us to the lobby of the same arena.
  await page.getByTestId("rematch-button").click();
  await page.waitForURL(/\/lobby/, { timeout: 10_000 });
  await expect(page.getByTestId("ready-toggle")).toBeVisible();
});
