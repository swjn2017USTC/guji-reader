import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Personal annotations live in IndexedDB, which can be unavailable: disabled by
 * policy, blocked in private mode, or out of quota. The reader must survive it —
 * canonical text, 古注 and AI annotations come from static JSON and do not
 * depend on the store (plan §1.1).
 */
vi.mock("./db/userAnnotations", () => ({
  loadUserAnnotations: vi.fn(async () => {
    throw new Error("IndexedDB unavailable");
  }),
  createUserAnnotation: vi.fn(async () => {
    throw new Error("IndexedDB unavailable");
  }),
  updateUserAnnotation: vi.fn(async () => {
    throw new Error("IndexedDB unavailable");
  }),
  deleteUserAnnotation: vi.fn(async () => {
    throw new Error("IndexedDB unavailable");
  }),
  resetDatabaseConnection: vi.fn(),
}));

import App from "./App";
import { mockFetch, resetFetchMock } from "./test/mockFetch";
import { resetDataCaches } from "./test/resetDataCaches";

describe("personal annotation store unavailable", () => {
  beforeEach(() => {
    localStorage.clear();
    resetDataCaches();
    mockFetch();
  });

  afterEach(() => {
    resetFetchMock();
    localStorage.clear();
  });

  it("still renders the text, AI annotations and 古注", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("第一卷正文第一段。")).toBeInTheDocument();
    });

    // The reader is intact, not replaced by an error screen.
    expect(screen.queryByText(/載入失敗/)).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-passage-id]").length).toBeGreaterThan(0);
    expect(document.querySelectorAll("[data-annotation-marker]").length).toBeGreaterThan(0);
    expect(document.querySelectorAll("[data-source-note-id]").length).toBeGreaterThan(0);
    expect(document.querySelectorAll("[data-proper-name-type]").length).toBeGreaterThan(0);
  });

  it("reports the degraded layer instead of failing silently or fatally", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("第一卷正文第一段。")).toBeInTheDocument();
    });

    const notice = await screen.findByRole("status");
    expect(notice).toHaveAttribute("data-annotation-store-error");
    expect(notice).toHaveTextContent(/個人標記暫時無法使用/);
  });
});
