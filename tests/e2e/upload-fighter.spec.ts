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

  // The pool now lives server-side — confirm the upload landed via the pool
  // fetch roundtrip.
  const poolFighters = await page.evaluate(async () => {
    const res = await fetch("/api/pool", { cache: "no-store" });
    const body = (await res.json()) as { fighters: { name: string; imageUrl: string }[] };
    return body.fighters;
  });
  expect(poolFighters.some((f) => f.name === "Upload Warrior")).toBe(true);
  expect(
    poolFighters.find((f) => f.name === "Upload Warrior")?.imageUrl,
  ).toBe(MOCK_IMAGE_URL);
});
