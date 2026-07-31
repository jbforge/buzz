import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const SHOTS = "test-results/provider-usage";

test.describe("sidebar AI usage card", () => {
  test("renders provider meters when the preview feature is on", async ({
    page,
  }) => {
    // installMockBridge seeds every preview feature (incl. providerUsage) on.
    await installMockBridge(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const card = page.getByTestId("sidebar-usage-card");
    await expect(card).toBeVisible({ timeout: 10_000 });

    const claudeRow = page.getByTestId("sidebar-usage-row-claude");
    await expect(claudeRow).toContainText("Claude");
    await expect(claudeRow).toContainText("5-hour");
    await expect(claudeRow).toContainText("16%");
    await expect(claudeRow).toContainText("Extra usage: $34.47 of $200");

    const codexRow = page.getByTestId("sidebar-usage-row-codex");
    await expect(codexRow).toContainText("Codex · Plus");
    await expect(codexRow).toContainText("60%");

    // Nous renders as a link-out row; unconfigured OpenRouter stays hidden.
    await expect(page.getByTestId("sidebar-usage-row-nous")).toContainText(
      "No usage API yet",
    );
    await expect(page.getByTestId("sidebar-usage-row-openrouter")).toHaveCount(
      0,
    );

    await waitForAnimations(page);
    await card.screenshot({ path: `${SHOTS}/01-usage-card.png` });
    await page.screenshot({
      path: `${SHOTS}/02-sidebar-with-usage-card.png`,
      clip: { x: 0, y: 0, width: 256, height: 720 },
    });
  });

  test("stays hidden while the preview feature is off", async ({ page }) => {
    await installMockBridge(page, undefined, { seedPreviewFeatures: false });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("app-sidebar")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("sidebar-usage-card")).toHaveCount(0);
  });
});
