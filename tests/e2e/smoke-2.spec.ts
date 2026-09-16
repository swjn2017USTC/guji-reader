import { expect, test } from "@playwright/test";

test.describe("smoke-2 AI 註釋", () => {
  test("點擊「注」開啟 popover，點擊外部收起", async ({ page }) => {
    await page.goto("/");

    // 第一卷已發布 AI 註釋（由 scripts/annotate.py + review_annotations.py 產生）。
    const marker = page.locator("[data-annotation-marker]").first();
    await expect(marker).toBeVisible();

    const properName = page.locator("[data-proper-name-type]").first();
    await expect(properName).toBeVisible();

    await marker.click();

    const popover = page.getByRole("dialog", { name: "AI 注釋" });
    await expect(popover).toBeVisible();
    // 標籤與註文都要出現。
    await expect(popover).toContainText(/人物|地名|難詞|官職|首見/);
    await expect(popover).toContainText(/第一層|第二層/);

    // 點擊 popover 以外的區域收起。
    await page.locator("header").click();
    await expect(popover).toBeHidden();

    // 古注與 AI 註釋必須是不同元素。
    const sourceNote = page.locator("[data-source-note-id]").first();
    await expect(sourceNote).toBeVisible();
    await expect(sourceNote).not.toHaveAttribute("data-annotation-marker", /.+/);
  });

  test("專名線可開關", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-proper-name-type]").first()).toBeVisible();

    await page.getByRole("button", { name: "切換專名線" }).click();
    await expect(page.locator("[data-proper-name-type]")).toHaveCount(0);

    await page.getByRole("button", { name: "切換專名線" }).click();
    await expect(page.locator("[data-proper-name-type]").first()).toBeVisible();
  });

  test("豎排下註釋與專名線仍然渲染", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "切換橫豎排" }).click();

    const content = page.locator(".reader-main > div > div").first();
    await expect(content).toHaveCSS("writing-mode", "vertical-rl");
    await expect(page.locator("[data-proper-name-type]").first()).toBeVisible();

    await page.locator("[data-annotation-marker]").first().click();
    await expect(page.getByRole("dialog", { name: "AI 注釋" })).toBeVisible();
  });
});
