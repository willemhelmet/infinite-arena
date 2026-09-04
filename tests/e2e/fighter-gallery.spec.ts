import { expect, test } from "@playwright/test";
import { createFighterViaUi, mockImageRoutes } from "./helpers";

// The shared roster: a fighter forged in one browser shows up in another's
// View Fighters list, can be pulled into that browser's own roster, and its
// creator can retire it. (Two contexts stand in for a laptop and a phone.)
test("fighters forged on one device are visible and usable on another", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const laptop = await (await browser.newContext()).newPage();
  const phone = await (await browser.newContext()).newPage();
  await mockImageRoutes(laptop);
  await mockImageRoutes(phone);

  const name = `Gallery Titan ${Date.now().toString(36)}`;
  await laptop.goto("/");
  await createFighterViaUi(laptop, name);

  // Phone sees it in the gallery with the creator's badge absent.
  await phone.goto("/");
  await phone.getByRole("button", { name: "View Fighters" }).click();
  await expect(phone).toHaveURL(/\/fighters$/);
  const card = phone
    .getByTestId("gallery-fighter")
    .filter({ has: phone.getByText(name, { exact: true }) });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText("Yours")).toHaveCount(0);
  await expect(card.getByTestId("gallery-remove")).toHaveCount(0);

  // "Use this fighter" adds it to the phone's own roster.
  await card.getByTestId("gallery-use").click();
  await expect(card.getByTestId("gallery-use")).toHaveText("In your roster");
  await phone.goto("/games/new");
  await expect(phone.getByTestId("roster-picker").getByText(name)).toBeVisible();

  // The creator sees their badge and can retire the fighter.
  await laptop.goto("/fighters");
  const mine = laptop
    .getByTestId("gallery-fighter")
    .filter({ has: laptop.getByText(name, { exact: true }) });
  await expect(mine).toBeVisible({ timeout: 15_000 });
  await expect(mine.getByText("Yours")).toBeVisible();
  await laptop.getByTestId("gallery-filter-mine").click();
  await expect(mine).toBeVisible();
  laptop.once("dialog", (d) => d.accept());
  await mine.getByTestId("gallery-remove").click();
  await expect(mine).toHaveCount(0);

  // Gone from the other device's list too.
  await phone.goto("/fighters");
  await expect(phone.getByTestId("fighter-gallery")).toBeVisible();
  await expect(phone.getByText(name, { exact: true })).toHaveCount(0);
});

test("registry refuses writes for someone else's fighter", async ({ request }) => {
  const res = await request.post("/api/fighters/registry", {
    headers: { "x-player-id": "attacker-0000-0000" },
    data: {
      id: "someone-elses",
      name: "Impostor",
      imageUrl: "https://placehold.co/64x64/png",
      description: "",
      createdBy: "victim-0000-0000-0000",
    },
  });
  expect(res.status()).toBe(403);
});
