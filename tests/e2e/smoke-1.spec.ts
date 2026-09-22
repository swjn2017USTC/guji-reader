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

    // 卷內搜尋有結果計數，且結果帶有穩定的 passage 定位。
    const search = page.getByRole("search");
    await search.getByRole("searchbox").fill("高帝");
    await expect(search).toContainText("1/21");
    await expect(page.locator('[data-search-match="0"]')).toBeVisible();
    expect(await page.evaluate(() => window.location.hash)).toContain("vol02");
    await search.getByRole("searchbox").press("Escape");
    await expect(search).not.toContainText("1/21");

    // 切換為豎排。
    await page.getByRole("button", { name: "切換橫豎排" }).click();
    await expect(content).toHaveCSS("writing-mode", "vertical-rl");

    // 再切回橫排。
    await page.getByRole("button", { name: "切換橫豎排" }).click();
    await expect(content).toHaveCSS("writing-mode", "horizontal-tb");
  });

  test("可从 passage hash 直接打开对应卷", async ({ page }) => {
    await page.goto("/#passage=tongjian-jishi-benmo%3Avol02%3Ap0");
    await expect(page.locator("header")).toContainText("第二卷");
    await expect(
      page.locator('[data-passage-id="tongjian-jishi-benmo:vol02:p0"]'),
    ).toBeVisible();
  });

  test("窄视口仍可使用搜尋与目录控制", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 800 });
    await page.goto("/");
    await expect(page.getByRole("search")).toBeVisible();
    await expect(page.getByRole("button", { name: "收起目錄" })).toBeVisible();
    await page.getByRole("button", { name: "收起目錄" }).click();
    await page.getByRole("button", { name: "展開目錄" }).click();
    await expect(page.getByRole("navigation", { name: "卷目錄" })).toBeVisible();
  });
});
