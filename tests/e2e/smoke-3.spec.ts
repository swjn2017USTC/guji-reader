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
    { passageSelector: PASSAGE, from: start, to: end },
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
    await page.getByRole("dialog", { name: "個人標記" }).getByRole("button", { name: "刪除" }).click();
    await expect(page.locator("[data-batch-marker]")).toHaveCount(0);
    await expect(page.locator("[data-user-annotation-id]")).toHaveCount(0);
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
    await page.getByRole("dialog", { name: "個人標記" }).getByRole("button", { name: "刪除" }).click();
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
    await page.getByRole("dialog", { name: "個人標記" }).getByRole("button", { name: "刪除" }).click();
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
    await inspector.getByRole("button", { name: "刪除" }).click();

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
