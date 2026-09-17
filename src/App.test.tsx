import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";
import { mockFetch, resetFetchMock } from "./test/mockFetch";
import {
  codePointLength,
  segmentByIntervals,
  sliceByCodePoints,
  toUtf16Index,
} from "./reader/anchors";

const STORAGE_KEY = "guji-reader-preferences-v1";

async function renderReader() {
  render(<App />);
  await waitFor(() => {
    expect(screen.getByText("第一卷正文第一段。")).toBeInTheDocument();
  });
}

describe("Reader UI", () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetch();
  });

  afterEach(() => {
    resetFetchMock();
    localStorage.clear();
  });

  it("renders the first volume passages on load", async () => {
    await renderReader();
    expect(screen.getByRole("heading", { name: "測試古籍" })).toBeInTheDocument();
    expect(screen.getAllByText("第一卷").length).toBeGreaterThanOrEqual(1);
  });

  it("switches volume when clicking a volume in the sidebar", async () => {
    await renderReader();
    await userEvent.click(screen.getByRole("button", { name: "第二卷" }));
    await waitFor(() => {
      expect(screen.getByText("第二卷正文。")).toBeInTheDocument();
    });
    expect(screen.queryByText("第一卷正文第一段。")).not.toBeInTheDocument();
  });

  it("cycles through themes and persists the choice", async () => {
    await renderReader();
    expect(document.documentElement.getAttribute("data-theme")).toBe("paper");

    await userEvent.click(screen.getByRole("button", { name: "切換主題" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("rice");

    await userEvent.click(screen.getByRole("button", { name: "切換主題" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("night");

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(raw!).theme).toBe("night");
  });

  it("toggles writing mode and persists the choice", async () => {
    await renderReader();
    const content = () =>
      screen.getByText("第一卷正文第一段。").closest("[style]") as HTMLElement;

    expect(content()).toHaveStyle({ writingMode: "horizontal-tb" });

    await userEvent.click(screen.getByRole("button", { name: "切換橫豎排" }));
    expect(content()).toHaveStyle({ writingMode: "vertical-rl" });

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(raw!).writingMode).toBe("vertical");
  });

  it("adjusts font size and line height and persists them", async () => {
    await renderReader();
    await userEvent.click(screen.getByRole("button", { name: "展開設置" }));

    fireEvent.input(screen.getByLabelText("字號"), { target: { value: "24" } });
    fireEvent.input(screen.getByLabelText("行距"), { target: { value: "2.2" } });

    await waitFor(() => {
      const prefs = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(prefs.fontSize).toBe(24);
      expect(prefs.lineHeight).toBe(2.2);
    });
  });

  it("renders source notes distinctly from AI annotations", async () => {
    await renderReader();

    const sourceNote = document.querySelector("[data-source-note-id]") as HTMLElement;
    expect(sourceNote).not.toBeNull();
    expect(sourceNote).toHaveAttribute(
      "title",
      expect.stringContaining("胡三省注"),
    );
    // A 古注 is not an AI annotation and must never carry a 注 marker.
    expect(sourceNote.querySelector("[data-annotation-marker]")).toBeNull();

    const annotation = document.querySelector("[data-annotation-id]") as HTMLElement;
    expect(annotation).not.toBeNull();
    expect(annotation).not.toHaveAttribute("data-source-note-id");
    // The 注 badge is a sibling of the decorated span, never a child: an
    // underline must not run underneath it (see P03 fix).
    expect(annotation.querySelector("[data-annotation-marker]")).toBeNull();
    expect(
      annotation.parentElement?.querySelector("[data-annotation-marker]"),
    ).not.toBeNull();
  });

  it("renders proper-name lines with their type", async () => {
    await renderReader();

    const spans = [...document.querySelectorAll("[data-proper-name-type]")];
    expect(spans.length).toBeGreaterThanOrEqual(3);
    const types = spans.map((span) => span.getAttribute("data-proper-name-type"));
    expect(types).toContain("PERSON");
    expect(types).toContain("STATE");
  });

  it("does not give annotated text a proper-name line", async () => {
    await renderReader();

    // 「諸侯」 is only an annotation (TERM), never a proper name.
    const term = document.querySelector(
      '[data-annotation-id*="TERM"]',
    ) as HTMLElement;
    expect(term).not.toBeNull();
    expect(term.getAttribute("data-proper-name-type")).toBeNull();
    expect(term.querySelector("[data-proper-name-type]")).toBeNull();
  });

  it("keeps the 注 badge outside any proper-name span", async () => {
    await renderReader();

    // 魏斯 is both a proper name and an annotated term.
    const badge = document.querySelector(
      '[data-annotation-marker^="ai:test-work:vol01:p1:PERSON"]',
    ) as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.closest("[data-proper-name-type]")).toBeNull();
    expect(badge.textContent).toBe("注");
  });

  it("toggles proper-name lines off while annotations stay", async () => {
    await renderReader();
    const markerCount = () =>
      document.querySelectorAll("[data-annotation-marker]").length;
    expect(markerCount()).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "切換專名線" }));

    expect(document.querySelectorAll("[data-proper-name-type]").length).toBe(0);
    // Turning lines off must not hide annotations.
    expect(markerCount()).toBeGreaterThan(0);
  });

  it("maps the wheel onto the inline axis in vertical mode", async () => {
    await renderReader();
    await userEvent.click(screen.getByRole("button", { name: "切換橫豎排" }));

    const scroller = document.querySelector("[data-reader-scroll]") as HTMLElement;
    scroller.scrollLeft = 500;
    fireEvent.wheel(scroller, { deltaY: 120 });
    expect(scroller.scrollLeft).toBe(380);
  });

  it("leaves the wheel alone in horizontal mode", async () => {
    await renderReader();
    const scroller = document.querySelector("[data-reader-scroll]") as HTMLElement;
    scroller.scrollLeft = 500;
    fireEvent.wheel(scroller, { deltaY: 120 });
    expect(scroller.scrollLeft).toBe(500);
  });

  it("toggles proper-name lines off and persists the choice", async () => {
    await renderReader();
    expect(document.querySelectorAll("[data-proper-name-type]").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "切換專名線" }));

    expect(document.querySelectorAll("[data-proper-name-type]").length).toBe(0);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).showProperNames).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "切換專名線" }));
    expect(document.querySelectorAll("[data-proper-name-type]").length).toBeGreaterThan(0);
  });

  it("opens an annotation popover with its label and text", async () => {
    await renderReader();

    const marker = document.querySelector(
      '[data-annotation-marker^="ai:test-work:vol01:p1:PERSON"]',
    ) as HTMLElement;
    expect(marker).not.toBeNull();
    fireEvent.click(marker);

    const popover = screen.getByRole("dialog", { name: "AI 注釋" });
    expect(within(popover).getByText("人物")).toBeInTheDocument();
    expect(within(popover).getByText("第一層")).toBeInTheDocument();
    expect(
      within(popover).getByText("魏斯，即魏文侯，戰國魏國開國君主。"),
    ).toBeInTheDocument();
  });

  it("closes the popover when clicking outside", async () => {
    await renderReader();

    const marker = document.querySelector(
      '[data-annotation-marker^="ai:test-work:vol01:p1:PERSON"]',
    ) as HTMLElement;
    fireEvent.click(marker);
    expect(screen.getByRole("dialog", { name: "AI 注釋" })).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog", { name: "AI 注釋" })).not.toBeInTheDocument();
  });

  it("keeps the popover open when clicking inside it", async () => {
    await renderReader();

    const marker = document.querySelector(
      '[data-annotation-marker^="ai:test-work:vol01:p1:TERM"]',
    ) as HTMLElement;
    fireEvent.click(marker);
    const popover = screen.getByRole("dialog", { name: "AI 注釋" });

    fireEvent.mouseDown(popover);
    expect(screen.getByRole("dialog", { name: "AI 注釋" })).toBeInTheDocument();
  });

  it("closes the popover via its close button", async () => {
    await renderReader();
    const marker = document.querySelector(
      "[data-annotation-marker]",
    ) as HTMLElement;
    fireEvent.click(marker);
    screen.getByRole("dialog", { name: "AI 注釋" });

    fireEvent.click(screen.getByRole("button", { name: "關閉注釋" }));
    expect(screen.queryByRole("dialog", { name: "AI 注釋" })).not.toBeInTheDocument();
  });
});

describe("anchor offsets", () => {
  it("converts code-point offsets to UTF-16 indices", () => {
    // U+23C30 is a surrogate pair in JS but a single code point in Python.
    const text = "古文𣰰字";
    expect(codePointLength(text)).toBe(4);
    expect(text.length).toBe(5);
    expect(toUtf16Index(text, 3)).toBe(4);
    expect(sliceByCodePoints(text, 2, 3)).toBe("𣰰");
    expect(sliceByCodePoints(text, 0, 2)).toBe("古文");
  });

  it("segments a passage at every interval boundary", () => {
    const segments = segmentByIntervals("周威烈王二十三年", [
      { start: 0, end: 4, data: "pn" },
      { start: 0, end: 2, data: "note" },
    ]);
    expect(segments.map((segment) => segment.text)).toEqual([
      "周威",
      "烈王",
      "二十三年",
    ]);
    expect(segments[0].covering).toEqual(["pn", "note"]);
    expect(segments[1].covering).toEqual(["pn"]);
    expect(segments[2].covering).toEqual([]);
  });

  it("returns the whole passage when there are no intervals", () => {
    const segments = segmentByIntervals("古文", []);
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe("古文");
  });

  it("ignores intervals outside the passage bounds", () => {
    const segments = segmentByIntervals("古文", [{ start: 0, end: 99, data: "x" }]);
    expect(segments).toHaveLength(1);
    expect(segments[0].covering).toEqual([]);
  });
});
