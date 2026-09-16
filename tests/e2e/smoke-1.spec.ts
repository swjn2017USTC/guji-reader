import { expect, test } from "@playwright/test";

test.describe("smoke-1 閱讀", () => {
  test("打開首頁後可直接閱讀，切換卷與橫豎排", async ({ page }) => {
    await page.goto("/");

    // 首屏就是書，能看見正文。
    await expect(
      page.locator('[data-passage-id="tongjian-jishi-benmo:vol01:p1"]'),
    ).toContainText("周威烈王");

    // 頂部顯示書名與卷名。
    await expect(page.locator("header")).toContainText("通鑑紀事本末");
    await expect(page.locator("header")).toContainText("第一卷");

    // 切換到第二卷。
    await page.getByRole("button", { name: "第二卷" }).click();
    await page.waitForTimeout(500);
    await expect(
      page.locator('[data-passage-id="tongjian-jishi-benmo:vol02:p0"]'),
    ).toBeVisible({ timeout: 10000 });

    // 橫排為默認。
    const content = page.locator(".reader-main > div > div").first();
    await expect(content).toHaveCSS("writing-mode", "horizontal-tb");

    // 切換為豎排。
    await page.getByRole("button", { name: "切換橫豎排" }).click();
    await expect(content).toHaveCSS("writing-mode", "vertical-rl");

    // 再切回橫排。
    await page.getByRole("button", { name: "切換橫豎排" }).click();
    await expect(content).toHaveCSS("writing-mode", "horizontal-tb");
  });
});
