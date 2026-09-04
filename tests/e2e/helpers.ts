import type { Page } from "@playwright/test";

// A fixed public URL the mocked image routes return — no real Replicate/Blob
// calls happen in tests.
export const MOCK_IMAGE_URL = "https://placehold.co/512x512/18181b/f4f4f5/png?text=TEST";

export async function mockImageRoutes(page: Page) {
  await page.route("**/api/fighters/generate-image**", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ enabled: true }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ imageUrl: MOCK_IMAGE_URL }),
    });
  });
  await page.route("**/api/fighters/upload-image", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ imageUrl: MOCK_IMAGE_URL }),
    }),
  );
}

// Goes through the real Create Fighter UI with the image API mocked.
export async function createFighterViaUi(
  page: Page,
  name: string,
): Promise<void> {
  await page.goto("/fighters/new");
  await page.getByTestId("fighter-name-input").fill(name);
  await page
    .getByTestId("fighter-description-input")
    .fill("A test fighter forged for the arena suite.");
  await page.getByTestId("fighter-generate-button").click();
  await page.getByTestId("fighter-preview").waitFor({ timeout: 10_000 });
  await page.getByTestId("fighter-save-button").click();
  await page.waitForURL("**/");
}
