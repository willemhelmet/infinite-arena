import { expect, test } from "@playwright/test";

test("entry screen shows title, five actions, and a working how-to-play modal", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByTestId("game-title")).toBeVisible();
  await expect(page.getByRole("button", { name: "Watch the Arena" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Fighter" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View Fighters" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Join Game" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Server" })).toBeVisible();

  // How to play opens and closes.
  await page.getByRole("button", { name: /How to Play/i }).click();
  await expect(page.getByTestId("how-to-play")).toBeVisible();
  await expect(page.getByText(/Forge a fighter/)).toBeVisible();

  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("how-to-play")).toBeHidden();
});

test("entry nav buttons route to their screens", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create Fighter" }).click();
  await expect(page).toHaveURL(/\/fighters\/new/);

  await page.goto("/");
  await page.getByRole("button", { name: "View Fighters" }).click();
  await expect(page).toHaveURL(/\/fighters$/);

  await page.goto("/");
  await page.getByRole("button", { name: "Join Game" }).click();
  await expect(page).toHaveURL(/\/games$/);

  await page.goto("/");
  await page.getByRole("button", { name: "Create Server" }).click();
  await expect(page).toHaveURL(/\/games\/new/);
});
