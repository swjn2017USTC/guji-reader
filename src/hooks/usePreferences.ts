import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_PREFERENCES,
  type ReaderPreferences,
  type Theme,
  type WritingMode,
} from "../types/reader";

const STORAGE_KEY = "guji-reader-preferences-v1";

function loadPreferences(): ReaderPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ReaderPreferences>;
      return { ...DEFAULT_PREFERENCES, ...parsed };
    }
  } catch {
    // Ignore corrupted storage.
  }
  return DEFAULT_PREFERENCES;
}

function savePreferences(preferences: ReaderPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Ignore storage errors.
  }
}

export function usePreferences() {
  const [preferences, setPreferences] = useState<ReaderPreferences>(loadPreferences);

  useEffect(() => {
    savePreferences(preferences);
  }, [preferences]);

  const setTheme = useCallback((theme: Theme) => {
    setPreferences((prev) => ({ ...prev, theme }));
  }, []);

  const setWritingMode = useCallback((writingMode: WritingMode) => {
    setPreferences((prev) => ({ ...prev, writingMode }));
  }, []);

  const setFontSize = useCallback((fontSize: number) => {
    setPreferences((prev) => ({ ...prev, fontSize }));
  }, []);

  const setLineHeight = useCallback((lineHeight: number) => {
    setPreferences((prev) => ({ ...prev, lineHeight }));
  }, []);

  const toggleSidebar = useCallback(() => {
    setPreferences((prev) => ({ ...prev, sidebarOpen: !prev.sidebarOpen }));
  }, []);

  const toggleSettings = useCallback(() => {
    setPreferences((prev) => ({ ...prev, settingsOpen: !prev.settingsOpen }));
  }, []);

  const cycleTheme = useCallback(() => {
    const order: Theme[] = ["paper", "rice", "night"];
    const next = order[(order.indexOf(preferences.theme) + 1) % order.length];
    setTheme(next);
  }, [preferences.theme, setTheme]);

  const toggleWritingMode = useCallback(() => {
    setWritingMode(preferences.writingMode === "horizontal" ? "vertical" : "horizontal");
  }, [preferences.writingMode, setWritingMode]);

  return {
    preferences,
    setTheme,
    setWritingMode,
    setFontSize,
    setLineHeight,
    toggleSidebar,
    toggleSettings,
    cycleTheme,
    toggleWritingMode,
  };
}
