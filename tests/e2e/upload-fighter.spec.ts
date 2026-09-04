import { expect, test } from "@playwright/test";
import { MOCK_IMAGE_URL, mockImageRoutes } from "./helpers";

test("upload flow: file input → preview → save", async ({ page }) => {
  await mockImageRoutes(page);
  await page.goto("/fighters/new");

  await page.getByTestId("fighter-name-input").fill("Upload Warrior");

  // Switch to upload mode and feed the hidden file input a PNG.
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const pngBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.getByTestId("fighter-file-input").setInputFiles({
    name: "warrior.png",
    mimeType: "image/png",
    buffer: pngBytes,
  });

  await expect(page.getByTestId("fighter-preview")).toBeVisible({
    timeout: 10_000,
  });
  await page.getByTestId("fighter-save-button").click();
  await page.waitForURL("**/");

  const roster = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem("infinite-arena:roster") ?? "[]"),
  );
  expect(roster[0]?.name).toBe("Upload Warrior");
  expect(roster[0]?.imageUrl).toBe(MOCK_IMAGE_URL);
});
