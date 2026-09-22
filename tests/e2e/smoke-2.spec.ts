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

    await marker.click();
    await expect(page.getByRole("dialog", { name: "AI 注釋" })).toBeVisible();
    await expect(page.getByRole("button", { name: "關閉注釋" })).toBeFocused();
    await page.getByRole("dialog", { name: "AI 注釋" }).press("Escape");
    await expect(page.getByRole("dialog", { name: "AI 注釋" })).toBeHidden();
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

test.describe("smoke-2 專名線與註釋不得混淆", () => {
  test("被註釋但不是專名的詞不畫線", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-annotation-marker]");

    // 「諸侯」只是一個 TERM 註釋，不是專名。
    const term = page.locator('[data-annotation-id*="TERM"]').first();
    await expect(term).toBeVisible();
    await expect(term).not.toHaveAttribute("data-proper-name-type", /.+/);
    const borders = await term.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        bottom: parseFloat(cs.borderBottomWidth),
        left: parseFloat(cs.borderLeftWidth),
      };
    });
    expect(borders.bottom).toBe(0);
    expect(borders.left).toBe(0);
  });

  test("「注」標記本身不被畫進線裡", async ({ page }) => {
    await page.goto("/");
    const badge = page.locator("[data-annotation-marker]").first();
    await expect(badge).toBeVisible();
    // 標記不得位於任何專名 span 之內。
    expect(await badge.evaluate((el) => el.closest("[data-proper-name-type]") !== null)).toBe(
      false,
    );
  });

  test("關閉專名線後所有線都消失但註釋仍在", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-proper-name-type]");
    const markersBefore = await page.locator("[data-annotation-marker]").count();
    expect(markersBefore).toBeGreaterThan(0);

    await page.getByRole("button", { name: "切換專名線" }).click();
    await expect(page.locator("[data-proper-name-type]")).toHaveCount(0);

    // 註釋與其標記不受專名線開關影響。
    await expect(page.locator("[data-annotation-marker]")).toHaveCount(markersBefore);

    const anyLine = await page.evaluate(() =>
      [...document.querySelectorAll("[data-annotation-id]")].some((el) => {
        const cs = getComputedStyle(el as HTMLElement);
        return parseFloat(cs.borderBottomWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
      }),
    );
    expect(anyLine).toBe(false);
  });

  test("豎排可用滑鼠滾輪捲動", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "切換橫豎排" }).click();
    await expect(page.locator(".reader-main > div > div").first()).toHaveCSS(
      "writing-mode",
      "vertical-rl",
    );

    const result = await page.evaluate(() => {
      const scroller = document.querySelector("[data-reader-scroll]") as HTMLElement;
      scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth;
      const before = scroller.scrollLeft;
      scroller.dispatchEvent(
        new WheelEvent("wheel", { deltaY: 400, bubbles: true, cancelable: true }),
      );
      const afterDown = scroller.scrollLeft;
      scroller.dispatchEvent(
        new WheelEvent("wheel", { deltaY: -200, bubbles: true, cancelable: true }),
      );
      return { before, afterDown, afterUp: scroller.scrollLeft };
    });

    // 向下滾＝往後讀，scrollLeft 必須減少；向上滾則回復。
    expect(result.afterDown).toBeLessThan(result.before);
    expect(result.afterUp).toBeGreaterThan(result.afterDown);
    expect(result.before - result.afterDown).toBe(400);
  });
});

test.describe("smoke-2 古注可點擊", () => {
  test("點擊古注開啟 popover，點擊外部收起", async ({ page }) => {
    await page.goto("/");
    const note = page.locator("[data-source-note-id]").first();
    await expect(note).toBeVisible();
    // The old behaviour was a native tooltip; it must be gone.
    await expect(note).not.toHaveAttribute("title", /.+/);

    await note.click();

    const popover = page.getByRole("dialog", { name: "古注" });
    await expect(popover).toBeVisible();
    await expect(popover).toContainText("古注");
    await expect(popover).toContainText("周威烈王"); // 原文選段
    await expect(popover).toContainText("胡三省注"); // provenance
    // Rule 4: never presented as an AI annotation.
    await expect(popover).not.toContainText("AI 註釋");

    await page.locator("header").click();
    await expect(popover).toBeHidden();
  });

  test("古注在豎排下也可點擊，且 popover 不出屏", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "切換橫豎排" }).click();
    await expect(page.locator(".reader-main > div > div").first()).toHaveCSS(
      "writing-mode",
      "vertical-rl",
    );

    await page.locator("[data-source-note-id]").first().click();
    const popover = page.getByRole("dialog", { name: "古注" });
    await expect(popover).toBeVisible();

    // Collision middleware must keep it on screen, as for the other popovers.
    const box = await popover.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  });

  test("同時只開一個 popover", async ({ page }) => {
    await page.goto("/");
    await page.locator("[data-annotation-marker]").first().click();
    await expect(page.getByRole("dialog", { name: "AI 注釋" })).toBeVisible();

    await page.locator("[data-source-note-id]").first().click();
    await expect(page.getByRole("dialog", { name: "古注" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "AI 注釋" })).toBeHidden();
  });
});
