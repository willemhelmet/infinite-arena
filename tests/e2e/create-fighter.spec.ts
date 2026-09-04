import { expect, test } from "@playwright/test";
import { MOCK_IMAGE_URL, mockImageRoutes } from "./helpers";

test("generate flow: mock forge → preview → save → roster persists", async ({
  page,
}) => {
  await mockImageRoutes(page);
  await page.goto("/fighters/new");

  await page.getByTestId("fighter-name-input").fill("Test Titan");
  await page
    .getByTestId("fighter-description-input")
    .fill("A colossus of pure testing energy.");

  // Save is locked until an image exists.
  await expect(page.getByTestId("fighter-save-button")).toBeDisabled();

  await page.getByTestId("fighter-generate-button").click();
  await expect(page.getByTestId("fighter-preview")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("fighter-save-button")).toBeEnabled();

  await page.getByTestId("fighter-save-button").click();
  await page.waitForURL("**/");

  // The community pool is what the lobby reads — verify via the network and
  // the UI, not localStorage.
  await page.goto("/games/new");
  await expect(page.getByTestId("roster-picker")).toBeVisible();
  await expect(page.getByTestId("roster-picker").getByText("Test Titan")).toBeVisible();
});
