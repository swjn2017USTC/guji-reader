import { expect, test } from "@playwright/test";

const PASSAGE = '[data-passage-id="tongjian-jishi-benmo:vol01:p1"]';

/**
 * Select `[start, end)` code points of a passage's canonical text, the way a
 * user drag-selects. Builds a real DOM Range over the passage's text nodes,
 * skipping the 注 / 批 badges (which are UI, not text).
 */
async function selectInPassage(
  page: import("@playwright/test").Page,
  start: number,
  end: number,
  passageSelector: string = PASSAGE,
) {
  await page.evaluate(
    ({ passageSelector, from, to }) => {
      const passage = document.querySelector(passageSelector)!;
      const walker = document.createTreeWalker(passage, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      let node = walker.nextNode();
      while (node) {
        if (!(node as Text).parentElement?.closest("[data-ui-marker]")) {
          nodes.push(node as Text);
        }
        node = walker.nextNode();
      }

      let codePoints = 0;
      let startNode: Text | null = null;
      let startOffset = 0;
      let endNode: Text | null = null;
      let endOffset = 0;
      for (const textNode of nodes) {
        const value = textNode.nodeValue ?? "";
        const length = [...value].length;
        if (startNode === null && codePoints + length > from) {
          startNode = textNode;
          startOffset = from - codePoints;
        }
        if (endNode === null && codePoints + length >= to) {
          endNode = textNode;
          endOffset = to - codePoints;
        }
        codePoints += length;
      }

      const range = document.createRange();
      range.setStart(startNode!, startOffset);
      range.setEnd(endNode!, endOffset);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    },
    { passageSelector, from: start, to: end },
  );

  // The app listens on mouseup to convert the selection into an anchor.
  await page.locator("[data-reader-scroll]").dispatchEvent("mouseup");
}

test.describe("smoke-3 私人批註", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(PASSAGE);
    // Personal annotations live in IndexedDB, so start each test clean.
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase("guji-reader");
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      });
    });
    await page.reload();
    await page.waitForSelector(PASSAGE);
  });

  test("選字 → 高亮 → 寫批註 → reload 後仍在", async ({ page }) => {
    // 1. Select 魏斯 in canonical text.
    await selectInPassage(page, 14, 16);

    // 2. Toolbar appears with 10 colours and both styles.
    const toolbar = page.getByRole("toolbar", { name: "標記工具" });
    await expect(toolbar).toBeVisible();
    await expect(toolbar.getByRole("button", { name: /^顏色/ })).toHaveCount(10);

    // 3. Mark it as a highlight.
    await toolbar.getByRole("button", { name: "標記", exact: true }).click();
    const mark = page.locator("[data-user-annotation-id]").first();
    await expect(mark).toBeVisible();
    await expect(mark).toHaveAttribute("data-user-style", "highlight");

    // 4. A second, adjacent mark keeps wavy + its own opacity.
    await selectInPassage(page, 17, 18);
    const toolbar2 = page.getByRole("toolbar", { name: "標記工具" });
    await toolbar2.getByRole("button", { name: "波浪線" }).click();
    await toolbar2.getByRole("button", { name: "標記", exact: true }).click();
    await expect(page.locator('[data-user-style="wavy"]')).toHaveCount(1);

    // 5. Write a note on a third range → a 批 marker appears.
    await selectInPassage(page, 11, 12);
    const toolbar3 = page.getByRole("toolbar", { name: "標記工具" });
    await expect(page.locator("[data-batch-marker]")).toHaveCount(0);
    // The chosen style is sticky and the toolbar shows it as active.
    await expect(toolbar3.getByRole("button", { name: "波浪線" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await toolbar3.getByRole("button", { name: "高亮" }).click();
    await toolbar3.getByRole("button", { name: "寫批註" }).click();

    const editor = page.getByRole("dialog", { name: "個人標記" });
    await expect(editor).toBeVisible();
    await editor.getByLabel("批註內容").fill("晉，此處指晉國。");
    await editor.getByRole("button", { name: "儲存" }).click();

    const batch = page.locator("[data-batch-marker]");
    await expect(batch).toHaveCount(1);

    // 6. Reload: everything must come back from IndexedDB.
    await page.reload();
    await page.waitForSelector(PASSAGE);

    await expect(page.locator("[data-user-annotation-id]")).toHaveCount(3);
    await expect(page.locator('[data-user-style="highlight"]')).toHaveCount(2);
    await expect(page.locator('[data-user-style="wavy"]')).toHaveCount(1);
    await expect(page.locator("[data-batch-marker]")).toHaveCount(1);
  });

  test("開啟批註可見原文、可編輯、可刪除", async ({ page }) => {
    await selectInPassage(page, 14, 16);
    await page.getByRole("toolbar", { name: "標記工具" }).getByRole("button", { name: "寫批註" }).click();

    const editor = page.getByRole("dialog", { name: "個人標記" });
    await editor.getByLabel("批註內容").fill("魏斯即魏文侯。");
    await editor.getByRole("button", { name: "儲存" }).click();

    // Reopen from the 批 marker.
    await page.locator("[data-batch-marker]").click();
    const reopened = page.getByRole("dialog", { name: "個人標記" });
    await expect(reopened).toBeVisible();
    // Shows the quoted passage text and the note.
    await expect(reopened).toContainText("魏斯");
    await expect(reopened).toContainText("魏斯即魏文侯。");

    // Edit.
    await reopened.getByRole("button", { name: "編輯" }).click();
    await reopened.getByLabel("批註內容").fill("改：魏文侯，戰國魏國開國君主。");
    await reopened.getByRole("button", { name: "儲存" }).click();
    await expect(page.getByRole("dialog", { name: "個人標記" })).toBeHidden();

    await page.locator("[data-batch-marker]").click();
    await expect(page.getByRole("dialog", { name: "個人標記" })).toContainText(
      "戰國魏國開國君主",
    );

    // Delete.
    await page.getByRole("dialog", { name: "個人標記" }).getByRole("button", { name: "刪除標記", exact: true }).click();
    await expect(page.locator("[data-batch-marker]")).toHaveCount(0);
    await expect(page.locator("[data-user-annotation-id]")).toHaveCount(0);
  });

  test("個人標記可用鍵盤打開", async ({ page }) => {
    await selectInPassage(page, 14, 16);
    await page.getByRole("toolbar", { name: "標記工具" }).getByRole("button", { name: "標記", exact: true }).click();
    const mark = page.locator("[data-user-annotation-id]").first();
    await expect(mark).toBeVisible();
    await mark.focus();
    await mark.press("Enter");
    await expect(page.getByRole("dialog", { name: "個人標記" })).toBeVisible();
  });

  test("點擊高亮或波浪線可刪除", async ({ page }) => {
    // A highlight with no note has no 批 marker, so the marked text itself is
    // the only entry point. Both styles must be deletable the same way.
    await selectInPassage(page, 14, 16);
    await page
      .getByRole("toolbar", { name: "標記工具" })
      .getByRole("button", { name: "標記", exact: true })
      .click();
    await expect(page.locator('[data-user-style="highlight"]')).toHaveCount(1);
    await expect(page.locator("[data-batch-marker]")).toHaveCount(0);

    // Click the highlighted text → inspector opens with 刪除.
    await page.locator('[data-user-style="highlight"]').click();
    const inspector = page.getByRole("dialog", { name: "個人標記" });
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText("魏斯");
    await expect(inspector).toContainText("尚無批註");

    // Dismissing keeps the mark.
    await inspector.getByRole("button", { name: "關閉標記" }).click();
    await expect(page.locator('[data-user-style="highlight"]')).toHaveCount(1);

    // Deleting removes it, and it stays gone after a reload.
    await page.locator('[data-user-style="highlight"]').click();
    await page.getByRole("dialog", { name: "個人標記" }).getByRole("button", { name: "刪除標記", exact: true }).click();
    await expect(page.locator("[data-user-annotation-id]")).toHaveCount(0);

    await page.reload();
    await page.waitForSelector(PASSAGE);
    await expect(page.locator("[data-user-annotation-id]")).toHaveCount(0);

    // A wavy mark is deletable the same way.
    await selectInPassage(page, 14, 16);
    const toolbar = page.getByRole("toolbar", { name: "標記工具" });
    await toolbar.getByRole("button", { name: "波浪線" }).click();
    await toolbar.getByRole("button", { name: "標記", exact: true }).click();
    await expect(page.locator('[data-user-style="wavy"]')).toHaveCount(1);

    await page.locator('[data-user-style="wavy"]').click();
    await expect(page.getByRole("dialog", { name: "個人標記" })).toBeVisible();
    await page.getByRole("dialog", { name: "個人標記" }).getByRole("button", { name: "刪除標記", exact: true }).click();
    await expect(page.locator("[data-user-annotation-id]")).toHaveCount(0);
  });

  test("有批註的標記可從標記本身或「批」刪除", async ({ page }) => {
    await selectInPassage(page, 14, 16);
    await page
      .getByRole("toolbar", { name: "標記工具" })
      .getByRole("button", { name: "標記", exact: true })
      .click();
    await expect(page.locator("[data-user-annotation-id]")).toHaveCount(1);

    // Add a note from the mark inspector.
    await page.locator("[data-user-annotation-id]").click();
    await expect(page.getByRole("dialog", { name: "個人標記" })).toContainText("尚無批註");
    await page.getByRole("dialog", { name: "個人標記" }).getByRole("button", { name: "寫批註" }).click();
    await page.getByLabel("批註內容").fill("魏斯即魏文侯。");
    await page.getByRole("button", { name: "儲存" }).click();
    await expect(page.locator("[data-batch-marker]")).toHaveCount(1);

    // The 批 marker opens the same inspector, now showing the note.
    await page.locator("[data-batch-marker]").click();
    const inspector = page.getByRole("dialog", { name: "個人標記" });
    await expect(inspector).toContainText("魏斯即魏文侯。");
    await inspector.getByRole("button", { name: "刪除標記", exact: true }).click();

    // Deleting the mark removes its 批 marker too.
    await expect(page.locator("[data-user-annotation-id]")).toHaveCount(0);
    await expect(page.locator("[data-batch-marker]")).toHaveCount(0);
  });

  test("重疊時阻止建立並提示", async ({ page }) => {
    await selectInPassage(page, 14, 16);
    await page.getByRole("toolbar", { name: "標記工具" }).getByRole("button", { name: "標記", exact: true }).click();
    await expect(page.locator("[data-user-annotation-id]")).toHaveCount(1);

    // Overlaps by one character.
    await selectInPassage(page, 15, 17);

    const toolbar = page.getByRole("toolbar", { name: "標記工具" });
    await expect(toolbar).toBeVisible();
    await expect(toolbar).toContainText("重疊");
    await expect(page.locator("[data-user-annotation-id]")).toHaveCount(1);
  });

  test("豎排下仍可標記，且不破壞專名線與「注」", async ({ page }) => {
    await page.getByRole("button", { name: "切換橫豎排" }).click();
    await expect(page.locator(".reader-main > div > div").first()).toHaveCSS(
      "writing-mode",
      "vertical-rl",
    );

    await selectInPassage(page, 14, 16);
    const toolbar = page.getByRole("toolbar", { name: "標記工具" });
    await expect(toolbar).toBeVisible();
    await expect(toolbar).toHaveCSS("writing-mode", "horizontal-tb");
    await toolbar.getByRole("button", { name: "標記", exact: true }).click();

    await expect(page.locator("[data-user-annotation-id]")).toHaveCount(1);
    // AI 專名線 survives, and the 注 badge is still clickable.
    await expect(page.locator("[data-proper-name-type]").first()).toBeVisible();

    const badge = page.locator("[data-annotation-marker]").first();
    await badge.click();
    await expect(page.getByRole("dialog", { name: "AI 注釋" })).toBeVisible();
  });
});

test.describe("smoke-3 工具條不得出屏", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(PASSAGE);
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase("guji-reader");
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      });
    });
    await page.reload();
    await page.waitForSelector(PASSAGE);
  });

  test("豎排卷首選字時，工具條所有控制項仍在視口內", async ({ page }) => {
    /*
     * vertical-rl starts at the right-hand column, so the beginning of a volume
     * is the region most likely to push a 15.5rem toolbar past the right edge.
     * Every control must stay reachable, not merely "visible" to Playwright.
     */
    await page.getByRole("button", { name: "切換橫豎排" }).click();
    await expect(page.locator(".reader-main > div > div").first()).toHaveCSS(
      "writing-mode",
      "vertical-rl",
    );

    await selectInPassage(page, 14, 16); // 魏斯, near the right-hand column
    const toolbar = page.getByRole("toolbar", { name: "標記工具" });
    await expect(toolbar).toBeVisible();

    const viewport = page.viewportSize()!;
    const box = await toolbar.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);

    // Every control, including the ones that were previously clipped.
    for (const name of ["高亮", "波浪線", "寫批註", "標記"]) {
      const control = toolbar.getByRole("button", { name, exact: true });
      const controlBox = await control.boundingBox();
      expect(controlBox, `${name} has no box`).not.toBeNull();
      expect(controlBox!.x, `${name} clipped on the left`).toBeGreaterThanOrEqual(0);
      expect(
        controlBox!.x + controlBox!.width,
        `${name} clipped on the right`,
      ).toBeLessThanOrEqual(viewport.width);
    }

    const closeBox = await toolbar.getByRole("button", { name: "取消標記" }).boundingBox();
    expect(closeBox!.x + closeBox!.width).toBeLessThanOrEqual(viewport.width);

    // And it still works: the mark is created.
    await toolbar.getByRole("button", { name: "標記", exact: true }).click();
    await expect(page.locator("[data-user-annotation-id]")).toHaveCount(1);
  });

  test("橫排下工具條同樣不出屏", async ({ page }) => {
    await selectInPassage(page, 14, 16);
    const toolbar = page.getByRole("toolbar", { name: "標記工具" });
    await expect(toolbar).toBeVisible();

    const viewport = page.viewportSize()!;
    const box = await toolbar.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  });
});

test.describe("smoke-3 長選取不出屏", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(PASSAGE);
    // Personal marks live in IndexedDB, so start each case clean.
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase("guji-reader");
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      });
    });
    await page.reload();
    await page.waitForSelector(PASSAGE);
  });

  test("豎排長選取（跨多欄）時工具條仍完全在視口內", async ({ page }) => {
    /*
     * Regression: in vertical mode a selection spanning several columns has a
     * full-height bounding box (measured 777px tall in a 945px viewport). The
     * toolbar was placed below it, overflowing the bottom by ~89px and putting
     * 標記 / 寫批註 out of reach, and `flip` could not help because "above" did
     * not fit either. The fix is main-axis clamping in the shared placement.
     */
    await page.getByRole("button", { name: "切換橫豎排" }).click();
    await expect(page.locator(".reader-main > div > div").first()).toHaveCSS(
      "writing-mode",
      "vertical-rl",
    );

    // p3 is 151 code points, so this selection spans multiple columns.
    await selectInPassage(page, 0, 150, '[data-passage-id="tongjian-jishi-benmo:vol01:p3"]');
    const toolbar = page.getByRole("toolbar", { name: "標記工具" });
    await expect(toolbar).toBeVisible();

    const viewport = page.viewportSize()!;
    const box = await toolbar.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y, "toolbar overflows the top").toBeGreaterThanOrEqual(0);
    expect(box!.x, "toolbar overflows the left").toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height, "toolbar overflows the bottom").toBeLessThanOrEqual(
      viewport.height,
    );
    expect(box!.x + box!.width, "toolbar overflows the right").toBeLessThanOrEqual(
      viewport.width,
    );

    // The controls the report said were unreachable.
    for (const name of ["標記", "寫批註"]) {
      const control = toolbar.getByRole("button", { name, exact: true });
      const controlBox = await control.boundingBox();
      expect(controlBox, `${name} has no box`).not.toBeNull();
      expect(controlBox!.y, `${name} clipped at the bottom`).toBeGreaterThanOrEqual(0);
      expect(
        controlBox!.y + controlBox!.height,
        `${name} clipped at the bottom`,
      ).toBeLessThanOrEqual(viewport.height);
    }

    // It must also still work, not merely render in-bounds. A long mark is cut
    // into several spans by the other layers' boundaries, so count distinct
    // annotation ids rather than DOM pieces.
    await toolbar.getByRole("button", { name: "標記", exact: true }).click();
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            new Set(
              [...document.querySelectorAll("[data-user-annotation-id]")].map((el) =>
                el.getAttribute("data-user-annotation-id"),
              ),
            ).size,
        ),
      )
      .toBe(1);
  });

  test("豎排長標記的標記 popover 也不出屏", async ({ page }) => {
    await page.getByRole("button", { name: "切換橫豎排" }).click();

    await selectInPassage(page, 0, 150, '[data-passage-id="tongjian-jishi-benmo:vol01:p3"]');
    await page
      .getByRole("toolbar", { name: "標記工具" })
      .getByRole("button", { name: "標記", exact: true })
      .click();

    // A long mark is itself a tall reference for the popover.
    await page.locator("[data-user-annotation-id]").first().click();
    const popover = page.getByRole("dialog", { name: "個人標記" });
    await expect(popover).toBeVisible();

    const viewport = page.viewportSize()!;
    const box = await popover.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);

    const del = await popover.getByRole("button", { name: "刪除標記", exact: true }).boundingBox();
    expect(del!.y + del!.height).toBeLessThanOrEqual(viewport.height);
  });
});

test.describe("smoke-3 分開刪除", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(PASSAGE);
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase("guji-reader");
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      });
    });
    await page.reload();
    await page.waitForSelector(PASSAGE);
  });

  test("刪除批註保留高亮，刪除標記才移除全部", async ({ page }) => {
    // One mark carrying a note, so both destructive actions are available.
    await selectInPassage(page, 14, 16);
    await page
      .getByRole("toolbar", { name: "標記工具" })
      .getByRole("button", { name: "寫批註" })
      .click();
    await page.getByLabel("批註內容").fill("魏斯即魏文侯。");
    await page.getByRole("button", { name: "儲存" }).click();
    await expect(page.locator("[data-batch-marker]")).toHaveCount(1);

    const markPieces = () => page.locator("[data-user-annotation-id]");
    expect(await markPieces().count()).toBeGreaterThan(0);

    // Both actions are present and separately labelled.
    await page.locator("[data-batch-marker]").click();
    const popover = page.getByRole("dialog", { name: "個人標記" });
    await expect(popover.getByRole("button", { name: "刪除批註" })).toBeVisible();
    await expect(
      popover.getByRole("button", { name: "刪除標記", exact: true }),
    ).toBeVisible();

    // 刪除批註 drops the note and its 批 marker but keeps the highlight.
    await popover.getByRole("button", { name: "刪除批註" }).click();
    await expect(page.locator("[data-batch-marker]")).toHaveCount(0);
    await expect(page.locator('[data-user-style="highlight"]')).not.toHaveCount(0);
    expect(await markPieces().count()).toBeGreaterThan(0);

    // It survives a reload, i.e. the note is really gone and the mark really kept.
    await page.reload();
    await page.waitForSelector(PASSAGE);
    await expect(page.locator("[data-batch-marker]")).toHaveCount(0);
    expect(await markPieces().count()).toBeGreaterThan(0);

    // The note can still be re-added, and 刪除標記 then removes everything.
    await markPieces().first().click();
    const reopened = page.getByRole("dialog", { name: "個人標記" });
    await expect(reopened).toContainText("尚無批註");
    await expect(reopened.getByRole("button", { name: "刪除批註" })).toHaveCount(0);
    await reopened.getByRole("button", { name: "刪除標記", exact: true }).click();
    await expect(markPieces()).toHaveCount(0);
  });
});
