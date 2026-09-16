import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";
import { mockFetch, resetFetchMock } from "./test/mockFetch";

const STORAGE_KEY = "guji-reader-preferences-v1";

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
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("第一卷正文第一段。")).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "測試古籍" })).toBeInTheDocument();
    expect(screen.getAllByText("第一卷").length).toBeGreaterThanOrEqual(1);
  });

  it("switches volume when clicking a volume in the sidebar", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("第一卷正文第一段。")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "第二卷" }));

    await waitFor(() => {
      expect(screen.getByText("第二卷正文。")).toBeInTheDocument();
    });
    expect(screen.queryByText("第一卷正文第一段。")).not.toBeInTheDocument();
  });

  it("cycles through themes and persists the choice", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("第一卷正文第一段。")).toBeInTheDocument();
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("paper");

    await userEvent.click(screen.getByRole("button", { name: "切換主題" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("rice");

    await userEvent.click(screen.getByRole("button", { name: "切換主題" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("night");

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).theme).toBe("night");
  });

  it("toggles writing mode and persists the choice", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("第一卷正文第一段。")).toBeInTheDocument();
    });

    const content = await screen.findByText("第一卷正文第一段。").then((el) => el.closest("[style]"));
    expect(content).toHaveStyle({ writingMode: "horizontal-tb" });

    await userEvent.click(screen.getByRole("button", { name: "切換橫豎排" }));

    const contentAfter = await screen.findByText("第一卷正文第一段。").then((el) => el.closest("[style]"));
    expect(contentAfter).toHaveStyle({ writingMode: "vertical-rl" });

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(raw!).writingMode).toBe("vertical");
  });

  it("renders source notes distinctly from canonical text", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("胡注標記")).toBeInTheDocument();
    });

    const marker = screen.getByText("胡注標記");
    expect(marker.tagName.toLowerCase()).toBe("span");
    expect(marker).toHaveAttribute("title", expect.stringContaining("胡三省注"));
  });

  it("adjusts font size and line height and persists them", async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("第一卷正文第一段。")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "展開設置" }));

    const fontSizeInput = screen.getByLabelText("字號") as HTMLInputElement;
    fireEvent.input(fontSizeInput, { target: { value: "24" } });

    const lineHeightInput = screen.getByLabelText("行距") as HTMLInputElement;
    fireEvent.input(lineHeightInput, { target: { value: "2.2" } });

    await waitFor(() => {
      const raw = localStorage.getItem(STORAGE_KEY);
      const prefs = JSON.parse(raw!);
      expect(prefs.fontSize).toBe(24);
      expect(prefs.lineHeight).toBe(2.2);
    });
  });
});
