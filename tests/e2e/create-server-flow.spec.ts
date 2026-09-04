import { expect, test } from "@playwright/test";
import { createFighterViaUi, mockImageRoutes } from "./helpers";

// The host path: create an arena → land in own lobby → a challenger walks in
// → both ready → countdown → fight → results.
test("host flow runs entry to results", async ({ page }) => {
  test.setTimeout(120_000);
  await mockImageRoutes(page);
  await page.goto("/");
  await createFighterViaUi(page, "Arena Host");

  // Host an arena with the created fighter.
  await page.goto("/games/new");
  await page.getByTestId("arena-name-input").fill("Test Crucible");
  await page.getByTestId("roster-picker").getByText("Arena Host").click();
  await page.getByTestId("create-server-button").click();

  // Own lobby: host is Challenger I; the corridor bot joins as Challenger II.
  await page.waitForURL(/\/games\/[^/]+\/lobby/);
  await expect(page.getByTestId("lobby-slots")).toBeVisible();
  await expect(page.getByText("Arena Host")).toBeVisible();
  await expect(page.getByText("Challenger", { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  // Host readies; the bot follows; the fast countdown runs straight into the
  // fight (the 3-2-1 overlay's 300ms beats are too quick to assert reliably).
  await page.getByTestId("ready-toggle").click();
  await page.waitForURL(/\/fight/, { timeout: 15_000 });

  // Play it out — attack whenever the input unlocks; a KO can end the fight
  // before round 5, so loop on "results reached", not a fixed count.
  for (let round = 1; round <= 6; round++) {
    const input = page.getByTestId("attack-input");
    await expect(input).toBeEnabled({ timeout: 15_000 });
    await input.fill(
      `Host round ${round}: a sweeping strike that cannot be matched by mortal means.`,
    );
    await page.getByTestId("attack-submit").click();
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

  await page.waitForURL(/\/results/, { timeout: 30_000 });
  await expect(page.getByTestId("winner-card")).toBeVisible();

  // Return to menu works.
  await page.getByTestId("return-to-menu-button").click();
  await page.waitForURL("**/", { timeout: 10_000 });
  await expect(page.getByTestId("game-title")).toBeVisible();
});
