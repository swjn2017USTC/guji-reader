import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { mockFetch, resetFetchMock } from "./test/mockFetch";
import { resetDatabaseConnection } from "./db/userAnnotations";

const STORAGE_KEY = "guji-reader-preferences-v1";
const WORK_ID = "test-work";
const PASSAGE_ID = `${WORK_ID}:vol01:p1`;

async function renderReader() {
  render(<App />);
  await waitFor(() => {
    expect(screen.getByText("第一卷正文第一段。")).toBeInTheDocument();
  });
}

/**
 * Flush pending promises and effects inside act.
 *
 * Polling helpers (findBy@@/waitFor) are unusably slow here: floating-ui
 * resolves its position inside act, and the polling loop interacts badly with
 * that (measured ~10s per call). Flushing explicitly and asserting
 * synchronously is both fast and deterministic.
 */
async function flush(): Promise<void> {
  await act(async () => {
    // Several macrotasks, not one: creating a mark round-trips through Dexie
    // (write, then re-read), so a single tick is not enough for the new record
    // to reach the DOM.
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

/** Select `[start, end)` code points of a passage's canonical text in the DOM. */
function selectInPassage(passageId: string, start: number, end: number): void {
  const passage = document.querySelector(`[data-passage-id="${passageId}"]`)!;
  const walker = document.createTreeWalker(passage, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    const element = (node as Text).parentElement;
    if (!element?.closest("[data-ui-marker]")) {
      textNodes.push(node as Text);
    }
    node = walker.nextNode();
  }

  let codePoints = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;
  for (const textNode of textNodes) {
    const value = textNode.nodeValue ?? "";
    const length = [...value].length;
    if (startNode === null && codePoints + length > start) {
      startNode = textNode;
      startOffset = start - codePoints;
    }
    if (endNode === null && codePoints + length >= end) {
      endNode = textNode;
      endOffset = end - codePoints;
    }
    codePoints += length;
  }
  if (!startNode || !endNode) {
    throw new Error("selection outside passage text");
  }

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);

  const scroller = document.querySelector("[data-reader-scroll]")!;
  act(() => {
    fireEvent.mouseUp(scroller, { target: scroller });
  });
}

async function createMark(style: "highlight" | "wavy" = "highlight") {
  await renderReader();
  selectInPassage(PASSAGE_ID, 14, 16); // 魏斯
  const toolbar = await screen.findByRole("toolbar", { name: "標記工具" });
  if (style === "wavy") {
    fireEvent.click(within(toolbar).getByRole("button", { name: "波浪線" }));
  }
  fireEvent.click(within(toolbar).getByRole("button", { name: "標記" }));
  return toolbar;
}

describe("personal annotations", () => {
  beforeEach(async () => {
    localStorage.clear();
    mockFetch();
    resetDatabaseConnection();
    await indexedDB.deleteDatabase("guji-reader");
  });

  afterEach(() => {
    resetDatabaseConnection();
    resetFetchMock();
    localStorage.clear();
    window.getSelection()?.removeAllRanges();
  });

  it("shows the toolbar after selecting text in a passage", async () => {
    await renderReader();
    expect(screen.queryByRole("toolbar", { name: "標記工具" })).not.toBeInTheDocument();

    selectInPassage(PASSAGE_ID, 14, 16);

    const toolbar = await screen.findByRole("toolbar", { name: "標記工具" });
    // 10 colours, both styles, and an opacity slider.
    expect(within(toolbar).getAllByRole("button", { name: /^顏色/ })).toHaveLength(10);
    expect(within(toolbar).getByRole("button", { name: "高亮" })).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: "波浪線" })).toBeInTheDocument();
    expect(within(toolbar).getByLabelText("透明度")).toBeInTheDocument();
  });

  it("creates a highlight and renders it with the chosen colour and opacity", async () => {
    await createMark();

    await waitFor(() => {
      const mark = document.querySelector(
        `[data-user-annotation-id][data-user-style="highlight"]`,
      );
      expect(mark).not.toBeNull();
      expect(mark).toHaveAttribute("data-user-annotation-id");
      expect((mark as HTMLElement).style.backgroundColor).toBe("rgba(245, 197, 66, 0.28)");
    });
  });

  it("creates a wavy underline with its own default opacity", async () => {
    await createMark("wavy");

    await waitFor(() => {
      const mark = document.querySelector('[data-user-style="wavy"]') as HTMLElement;
      expect(mark).not.toBeNull();
      expect(mark.style.textDecorationStyle).toBe("wavy");
      expect(mark.style.textDecorationColor).toBe("rgba(245, 197, 66, 0.75)");
    });
  });

  it("opens a personal mark with the keyboard", async () => {
    await createMark();
    await waitFor(() =>
      expect(document.querySelector("[data-user-annotation-id]")).not.toBeNull(),
    );

    const mark = document.querySelector("[data-user-annotation-id]") as HTMLElement;
    expect(mark).toHaveAttribute("role", "button");
    fireEvent.keyDown(mark, { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "個人標記" })).toBeInTheDocument();
  });

  it("persists annotations and restores them after a reload", async () => {
    await createMark();
    await waitFor(() =>
      expect(document.querySelector("[data-user-annotation-id]")).not.toBeNull(),
    );

    // Simulate a reload: unmount and render a fresh app against the same DB.
    document.body.innerHTML = "";
    window.getSelection()?.removeAllRanges();
    await renderReader();

    await waitFor(() => {
      const marks = document.querySelectorAll("[data-user-annotation-id]");
      expect(marks).toHaveLength(1);
    });
  });

  it("blocks an overlapping selection and explains why", async () => {
    await createMark();
    await waitFor(() =>
      expect(document.querySelector("[data-user-annotation-id]")).not.toBeNull(),
    );

    // Overlaps 魏斯 (14..16) by one character.
    selectInPassage(PASSAGE_ID, 15, 17);

    await flush();
    expect(screen.getByText(/重疊/)).toBeInTheDocument();
    expect(document.querySelectorAll("[data-user-annotation-id]")).toHaveLength(1);
  });

  it("allows a non-overlapping selection next to an existing mark", async () => {
    await createMark();
    await waitFor(() =>
      expect(document.querySelector("[data-user-annotation-id]")).not.toBeNull(),
    );

    selectInPassage(PASSAGE_ID, 11, 12); // 晉, adjacent but not overlapping
    await flush();
    const toolbar = screen.getByRole("toolbar", { name: "標記工具" });
    expect(within(toolbar).queryByText(/重疊/)).not.toBeInTheDocument();
    fireEvent.click(within(toolbar).getByRole("button", { name: "標記" }));

    await waitFor(() =>
      expect(document.querySelectorAll("[data-user-annotation-id]")).toHaveLength(2),
    );
  });

  it("adds a 批 marker only when a note is written, and edits it", async () => {
    await renderReader();
    selectInPassage(PASSAGE_ID, 14, 16);

    const toolbar = await screen.findByRole("toolbar", { name: "標記工具" });
    expect(document.querySelectorAll("[data-batch-marker]")).toHaveLength(0);

    fireEvent.click(within(toolbar).getByRole("button", { name: "寫批註" }));

    // The note editor opens directly on the new mark.
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "個人標記" })).toBeInTheDocument(),
    );
    const editor = screen.getByRole("dialog", { name: "個人標記" });
    const textarea = within(editor).getByLabelText("批註內容");
    fireEvent.change(textarea, { target: { value: "魏斯即魏文侯。" } });
    fireEvent.click(within(editor).getByRole("button", { name: "儲存" }));

    // A 批 marker appears beside the marked text.
    await waitFor(() =>
      expect(document.querySelectorAll("[data-batch-marker]")).toHaveLength(1),
    );
    expect(screen.queryByRole("dialog", { name: "個人標記" })).not.toBeInTheDocument();

    // Reopen it and confirm the stored note, then edit.
    fireEvent.click(document.querySelector("[data-batch-marker]") as HTMLElement);
    await flush();
    const reopened = screen.getByRole("dialog", { name: "個人標記" });
    expect(within(reopened).getByText("魏斯即魏文侯。")).toBeInTheDocument();
    expect(within(reopened).getByText("魏斯")).toBeInTheDocument(); // 原文選段

    fireEvent.click(within(reopened).getByRole("button", { name: "編輯" }));
    fireEvent.change(within(reopened).getByLabelText("批註內容"), {
      target: { value: "改：魏文侯，戰國魏國開國君主。" },
    });
    fireEvent.click(within(reopened).getByRole("button", { name: "儲存" }));

    // Let the save settle before reopening: the popover toggle would otherwise
    // close the still-open dialog instead of opening it.
    await flush();
    expect(screen.queryByRole("dialog", { name: "個人標記" })).not.toBeInTheDocument();

    fireEvent.click(document.querySelector("[data-batch-marker]") as HTMLElement);
    await flush();
    const again = screen.getByRole("dialog", { name: "個人標記" });
    expect(within(again).getByText("改：魏文侯，戰國魏國開國君主。")).toBeInTheDocument();
  });

  it("opens a mark by clicking its text, and deletes it (highlight, no note)", async () => {
    await createMark();
    await waitFor(() =>
      expect(document.querySelector("[data-user-annotation-id]")).not.toBeNull(),
    );

    // No note yet, so there is no 批 marker to click — the marked text itself
    // is the entry point.
    expect(document.querySelectorAll("[data-batch-marker]")).toHaveLength(0);

    fireEvent.click(document.querySelector("[data-user-annotation-id]") as HTMLElement);
    await flush();

    const popover = screen.getByRole("dialog", { name: "個人標記" });
    expect(within(popover).getByText("魏斯")).toBeInTheDocument(); // 原文選段
    expect(within(popover).getByText("尚無批註")).toBeInTheDocument();
    expect(within(popover).getByRole("button", { name: "刪除標記" })).toBeInTheDocument();

    fireEvent.click(within(popover).getByRole("button", { name: "刪除標記" }));

    await waitFor(() => {
      expect(document.querySelectorAll("[data-user-annotation-id]")).toHaveLength(0);
      expect(screen.queryByRole("dialog", { name: "個人標記" })).not.toBeInTheDocument();
    });
  });

  it("deletes a wavy mark by clicking its text", async () => {
    await createMark("wavy");
    await waitFor(() =>
      expect(document.querySelector('[data-user-style="wavy"]')).not.toBeNull(),
    );

    fireEvent.click(document.querySelector('[data-user-style="wavy"]') as HTMLElement);
    await flush();

    const popover = screen.getByRole("dialog", { name: "個人標記" });
    expect(within(popover).getByText("波浪線")).toBeInTheDocument();
    fireEvent.click(within(popover).getByRole("button", { name: "刪除標記" }));

    await waitFor(() =>
      expect(document.querySelectorAll("[data-user-annotation-id]")).toHaveLength(0),
    );
  });

  it("keeps the mark when deletion is dismissed", async () => {
    await createMark();
    await waitFor(() =>
      expect(document.querySelector("[data-user-annotation-id]")).not.toBeNull(),
    );

    fireEvent.click(document.querySelector("[data-user-annotation-id]") as HTMLElement);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "關閉標記" }));

    await flush();
    expect(document.querySelectorAll("[data-user-annotation-id]")).toHaveLength(1);
  });

  it("writes a note from a note-less mark and then deletes both together", async () => {
    await createMark();
    await waitFor(() =>
      expect(document.querySelector("[data-user-annotation-id]")).not.toBeNull(),
    );

    fireEvent.click(document.querySelector("[data-user-annotation-id]") as HTMLElement);
    await flush();
    // Primary action is 寫批註 while there is no note.
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "個人標記" })).getByRole("button", {
        name: "寫批註",
      }),
    );
    fireEvent.change(screen.getByLabelText("批註內容"), {
      target: { value: "魏斯即魏文侯。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));

    // The 批 marker now exists.
    await waitFor(() =>
      expect(document.querySelectorAll("[data-batch-marker]")).toHaveLength(1),
    );

    // Deleting via the marked text removes the note as well.
    fireEvent.click(document.querySelector("[data-user-annotation-id]") as HTMLElement);
    await flush();
    const popover = screen.getByRole("dialog", { name: "個人標記" });
    expect(within(popover).getByText("魏斯即魏文侯。")).toBeInTheDocument();
    fireEvent.click(within(popover).getByRole("button", { name: "刪除標記" }));

    await waitFor(() => {
      expect(document.querySelectorAll("[data-user-annotation-id]")).toHaveLength(0);
      expect(document.querySelectorAll("[data-batch-marker]")).toHaveLength(0);
    });
  });

  it("deletes a mark that still has a note via the 批 marker", async () => {
    await createMark();
    await waitFor(() =>
      expect(document.querySelector("[data-user-annotation-id]")).not.toBeNull(),
    );

    selectInPassage(PASSAGE_ID, 17, 19); // 趙籍, no overlap
    const toolbar = screen.getByRole("toolbar", { name: "標記工具" });
    fireEvent.click(within(toolbar).getByRole("button", { name: "寫批註" }));
    await waitFor(() =>
      expect(screen.getByLabelText("批註內容")).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText("批註內容"), { target: { value: "待刪除" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() =>
      expect(document.querySelectorAll("[data-batch-marker]")).toHaveLength(1),
    );
    fireEvent.click(document.querySelector("[data-batch-marker]") as HTMLElement);
    await flush();
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "個人標記" })).getByRole("button", {
        name: "刪除標記",
      }),
    );

    await waitFor(() => {
      expect(document.querySelectorAll("[data-batch-marker]")).toHaveLength(0);
      // The first highlight is untouched.
      expect(document.querySelectorAll("[data-user-annotation-id]")).toHaveLength(1);
    });
  });

  it("persists a deletion across a reload", async () => {
    await createMark();
    await waitFor(() =>
      expect(document.querySelector("[data-user-annotation-id]")).not.toBeNull(),
    );

    fireEvent.click(document.querySelector("[data-user-annotation-id]") as HTMLElement);
    await flush();
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "個人標記" })).getByRole("button", {
        name: "刪除標記",
      }),
    );
    await waitFor(() =>
      expect(document.querySelectorAll("[data-user-annotation-id]")).toHaveLength(0),
    );

    document.body.innerHTML = "";
    window.getSelection()?.removeAllRanges();
    await renderReader();
    await flush();

    expect(document.querySelectorAll("[data-user-annotation-id]")).toHaveLength(0);
  });

  it("deletes only the note, keeping the highlight", async () => {
    await createMark();
    await waitFor(() =>
      expect(document.querySelector("[data-user-annotation-id]")).not.toBeNull(),
    );

    // Write a note so both destructive actions are on offer.
    fireEvent.click(document.querySelector("[data-user-annotation-id]") as HTMLElement);
    await flush();
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "個人標記" })).getByRole("button", {
        name: "寫批註",
      }),
    );
    fireEvent.change(screen.getByLabelText("批註內容"), { target: { value: "魏斯即魏文侯。" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));
    await waitFor(() =>
      expect(document.querySelectorAll("[data-batch-marker]")).toHaveLength(1),
    );

    // Both deletions are offered, separately labelled.
    fireEvent.click(document.querySelector("[data-batch-marker]") as HTMLElement);
    await flush();
    const popover = screen.getByRole("dialog", { name: "個人標記" });
    expect(within(popover).getByRole("button", { name: "刪除批註" })).toBeInTheDocument();
    expect(
      within(popover).getByRole("button", { name: "刪除標記" }),
    ).toBeInTheDocument();

    fireEvent.click(within(popover).getByRole("button", { name: "刪除批註" }));
    await flush();

    // The note and its 批 marker are gone; the mark itself survives.
    expect(document.querySelectorAll("[data-batch-marker]")).toHaveLength(0);
    expect(document.querySelectorAll("[data-user-annotation-id]").length).toBeGreaterThan(0);
    expect(document.querySelector('[data-user-style="highlight"]')).not.toBeNull();
    expect(screen.queryByRole("dialog", { name: "個人標記" })).not.toBeInTheDocument();

    // The mark is still editable and can take a new note.
    fireEvent.click(document.querySelector("[data-user-annotation-id]") as HTMLElement);
    await flush();
    const reopened = screen.getByRole("dialog", { name: "個人標記" });
    expect(within(reopened).getByText("尚無批註")).toBeInTheDocument();
    expect(within(reopened).getByRole("button", { name: "寫批註" })).toBeInTheDocument();
    // With no note there is nothing to delete separately.
    expect(within(reopened).queryByRole("button", { name: "刪除批註" })).not.toBeInTheDocument();
  });

  it("keeps AI 注 and 專名線 clickable alongside a user highlight", async () => {
    await createMark();
    await waitFor(() =>
      expect(document.querySelector("[data-user-annotation-id]")).not.toBeNull(),
    );

    // The AI 注 badge on the same word must still open its popover.
    const noteBadge = document.querySelector(
      '[data-annotation-marker^="ai:test-work:vol01:p1:PERSON"]',
    ) as HTMLElement;
    expect(noteBadge).not.toBeNull();
    fireEvent.click(noteBadge);
    await flush();

    expect(screen.getByRole("dialog", { name: "AI 注釋" })).toBeInTheDocument();
    // 專名線 still rendered under the personal highlight.
    expect(document.querySelectorAll("[data-proper-name-type]").length).toBeGreaterThan(0);
  });

  it("persists across a theme change", async () => {
    await createMark();
    await waitFor(() =>
      expect(document.querySelector("[data-user-annotation-id]")).not.toBeNull(),
    );

    await userEvent.click(screen.getByRole("button", { name: "切換主題" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("rice");
    expect(document.querySelectorAll("[data-user-annotation-id]")).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).theme).toBe("rice");
  });
});
