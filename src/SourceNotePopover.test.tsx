import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { mockFetch, resetFetchMock } from "./test/mockFetch";
import { resetDatabaseConnection } from "./db/userAnnotations";

async function renderReader() {
  render(<App />);
  await waitFor(() => {
    expect(screen.getByText("第一卷正文第一段。")).toBeInTheDocument();
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

function sourceNote(): HTMLElement {
  return document.querySelector("[data-source-note-id]") as HTMLElement;
}

describe("古注 popover", () => {
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

  it("opens on click with the note text and provenance", async () => {
    await renderReader();
    expect(sourceNote()).toBeInTheDocument();

    fireEvent.click(sourceNote());
    await flush();

    const dialog = screen.getByRole("dialog", { name: "古注" });
    expect(within(dialog).getByText("周威烈王")).toBeInTheDocument(); // 原文選段
    expect(
      within(dialog).getByText(/威烈王，名午，考王之子也/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("胡三省注《資治通鑑》卷第一"),
    ).toBeInTheDocument();
  });

  it("labels itself 古注, not AI 註釋", async () => {
    await renderReader();
    fireEvent.click(sourceNote());
    await flush();

    // Rule 4: the two layers must stay distinguishable, including in the UI.
    const dialog = screen.getByRole("dialog", { name: "古注" });
    expect(within(dialog).getByText("古注")).toBeInTheDocument();
    expect(within(dialog).queryByText(/AI 註釋/)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "AI 注釋" })).not.toBeInTheDocument();
  });

  it("closes when clicking outside", async () => {
    await renderReader();
    fireEvent.click(sourceNote());
    await flush();
    expect(screen.getByRole("dialog", { name: "古注" })).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    await flush();
    expect(screen.queryByRole("dialog", { name: "古注" })).not.toBeInTheDocument();
  });

  it("stays open when clicking inside it", async () => {
    await renderReader();
    fireEvent.click(sourceNote());
    await flush();

    fireEvent.mouseDown(screen.getByRole("dialog", { name: "古注" }));
    await flush();
    expect(screen.getByRole("dialog", { name: "古注" })).toBeInTheDocument();
  });

  it("closes via its close button", async () => {
    await renderReader();
    fireEvent.click(sourceNote());
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "關閉古注" }));
    await flush();
    expect(screen.queryByRole("dialog", { name: "古注" })).not.toBeInTheDocument();
  });

  it("toggles shut when the same note is clicked again", async () => {
    await renderReader();
    fireEvent.click(sourceNote());
    await flush();
    expect(screen.getByRole("dialog", { name: "古注" })).toBeInTheDocument();

    fireEvent.click(sourceNote());
    await flush();
    expect(screen.queryByRole("dialog", { name: "古注" })).not.toBeInTheDocument();
  });

  it("is reachable by keyboard", async () => {
    await renderReader();
    const note = sourceNote();
    expect(note).toHaveAttribute("role", "button");
    expect(note).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(note, { key: "Enter" });
    await flush();
    expect(screen.getByRole("dialog", { name: "古注" })).toBeInTheDocument();
  });

  it("does not open when the user is selecting text", async () => {
    await renderReader();
    const note = sourceNote();

    // Simulate a drag-selection that happens to end on the note.
    const range = document.createRange();
    range.selectNodeContents(note);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.click(note);
    await flush();

    expect(screen.queryByRole("dialog", { name: "古注" })).not.toBeInTheDocument();
  });

  it("shows one popover at a time", async () => {
    await renderReader();

    // Open the AI 注釋 popover first.
    const aiMarker = document.querySelector(
      '[data-annotation-marker^="ai:test-work:vol01:p1:PERSON"]',
    ) as HTMLElement;
    fireEvent.click(aiMarker);
    await flush();
    expect(screen.getByRole("dialog", { name: "AI 注釋" })).toBeInTheDocument();

    // Opening 古注 replaces it rather than stacking.
    fireEvent.click(sourceNote());
    await flush();
    expect(screen.getByRole("dialog", { name: "古注" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "AI 注釋" })).not.toBeInTheDocument();
  });

  it("closes when the writing mode changes", async () => {
    await renderReader();
    fireEvent.click(sourceNote());
    await flush();
    expect(screen.getByRole("dialog", { name: "古注" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "切換橫豎排" }));
    await flush();
    expect(screen.queryByRole("dialog", { name: "古注" })).not.toBeInTheDocument();
  });

  it("is not affected by the 專名線 toggle", async () => {
    await renderReader();

    fireEvent.click(screen.getByRole("button", { name: "切換專名線" }));
    await flush();

    // The note text is canonical text, so it stays even with lines hidden.
    expect(document.querySelectorAll("[data-source-note-id]")).toHaveLength(1);
    fireEvent.click(sourceNote());
    await flush();
    expect(screen.getByRole("dialog", { name: "古注" })).toBeInTheDocument();
  });
});
