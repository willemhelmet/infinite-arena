import { expect, test } from "@playwright/test";
import { createFighterViaUi, mockImageRoutes } from "./helpers";

// The arena list is live across devices: a room hosted in one browser shows
// up in another's list without a refresh, and disappears when the host
// leaves. (Two contexts stand in for a laptop and a phone.)
test("arena list updates live as rooms open and close", async ({ browser }) => {
  test.setTimeout(90_000);
  const host = await (await browser.newContext()).newPage();
  const watcher = await (await browser.newContext()).newPage();
  await mockImageRoutes(host);

  await watcher.goto("/games");
  await expect(watcher.getByTestId("game-list")).toBeVisible();

  await host.goto("/");
  await createFighterViaUi(host, "List Host");
  const arenaName = `Watchtower ${Date.now().toString(36)}`;
  await host.goto("/games/new");
  await host.getByTestId("arena-name-input").fill(arenaName);
  await host.getByTestId("roster-picker").getByText("List Host").click();
  await host.getByTestId("create-server-button").click();
  await host.waitForURL(/\/games\/[^/]+\/lobby/);

  // Appears on the other device's list, with the host's fighter and status.
  const item = watcher
    .getByTestId("game-list")
    .locator("div", { has: watcher.getByText(arenaName, { exact: true }) })
    .first();
  await expect(item).toBeVisible({ timeout: 15_000 });
  await expect(item).toContainText("List Host");
  await expect(item).toContainText("Waiting for a challenger");

  // Host walks out; the room vanishes from the list.
  await host.getByRole("button", { name: "Leave arena" }).click();
  await host.waitForURL(/\/games$/);
  await expect(watcher.getByText(arenaName, { exact: true })).toBeHidden({
    timeout: 15_000,
  });
});

test("a private arena stays off the list but is joinable by link", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  await mockImageRoutes(host);
  await mockImageRoutes(guest);

  await host.goto("/");
  await createFighterViaUi(host, "Secret Host");
  await guest.goto("/");
  await createFighterViaUi(guest, "Invited Guest");

  const arenaName = `Backroom ${Date.now().toString(36)}`;
  await host.goto("/games/new");
  await host.getByTestId("arena-name-input").fill(arenaName);
  await host.getByRole("button", { name: "Private arena" }).click();
  await host.getByTestId("roster-picker").getByText("Secret Host").click();
  await host.getByTestId("create-server-button").click();
  await host.waitForURL(/\/games\/[^/]+\/lobby/);
  const lobbyUrl = host.url();

  await guest.goto("/games");
  await expect(guest.getByTestId("game-list")).toBeVisible();
  // Give the list a poll cycle to settle, then assert absence.
  await guest.waitForTimeout(1500);
  await expect(guest.getByText(arenaName, { exact: true })).toBeHidden();

  // The shared link still works.
  await guest.goto(lobbyUrl);
  await guest.getByTestId("roster-picker").getByText("Invited Guest").click();
  await guest.getByTestId("join-with-fighter").click();
  await expect(host.getByText("Invited Guest")).toBeVisible({ timeout: 15_000 });
  await expect(guest.getByText("Secret Host")).toBeVisible({ timeout: 15_000 });
});
