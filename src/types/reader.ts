export type Theme = "paper" | "rice" | "night";
export type WritingMode = "horizontal" | "vertical";

export type ReaderPreferences = {
  theme: Theme;
  writingMode: WritingMode;
  fontSize: number;
  lineHeight: number;
  sidebarOpen: boolean;
  settingsOpen: boolean;
  showProperNames: boolean;
};

export const DEFAULT_PREFERENCES: ReaderPreferences = {
  theme: "paper",
  writingMode: "horizontal",
  fontSize: 20,
  lineHeight: 1.8,
  sidebarOpen: true,
  settingsOpen: false,
  showProperNames: true,
};

export const FONT_SIZE_MIN = 14;
export const FONT_SIZE_MAX = 32;
export const LINE_HEIGHT_MIN = 1.2;
export const LINE_HEIGHT_MAX = 2.6;
