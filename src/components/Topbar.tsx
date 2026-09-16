import type { Theme, WritingMode } from "../types/reader";
import styles from "./Topbar.module.css";

type TopbarProps = {
  bookTitle: string;
  volumeTitle: string;
  theme: Theme;
  writingMode: WritingMode;
  sidebarOpen: boolean;
  settingsOpen: boolean;
  onToggleSidebar: () => void;
  onToggleSettings: () => void;
  onCycleTheme: () => void;
  onToggleWritingMode: () => void;
};

const THEME_LABEL: Record<Theme, string> = {
  paper: "紙白",
  rice: "米黃",
  night: "夜褐",
};

const MODE_LABEL: Record<WritingMode, string> = {
  horizontal: "橫排",
  vertical: "豎排",
};

export function Topbar({
  bookTitle,
  volumeTitle,
  theme,
  writingMode,
  sidebarOpen,
  settingsOpen,
  onToggleSidebar,
  onToggleSettings,
  onCycleTheme,
  onToggleWritingMode,
}: TopbarProps) {
  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? "收起目錄" : "展開目錄"}
          aria-pressed={sidebarOpen}
        >
          目
        </button>
        <span className={styles.bookTitle}>{bookTitle}</span>
        <span className={styles.divider}>·</span>
        <span className={styles.volumeTitle}>{volumeTitle}</span>
      </div>
      <div className={styles.right}>
        <button
          type="button"
          className={styles.textButton}
          onClick={onToggleWritingMode}
          aria-label="切換橫豎排"
        >
          {MODE_LABEL[writingMode]}
        </button>
        <button
          type="button"
          className={styles.textButton}
          onClick={onCycleTheme}
          aria-label="切換主題"
        >
          {THEME_LABEL[theme]}
        </button>
        <button
          type="button"
          className={styles.iconButton}
          onClick={onToggleSettings}
          aria-label={settingsOpen ? "收起設置" : "展開設置"}
          aria-pressed={settingsOpen}
        >
          設
        </button>
      </div>
    </header>
  );
}
