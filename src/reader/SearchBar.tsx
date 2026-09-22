import { type RefObject, useEffect } from "react";
import styles from "./SearchBar.module.css";

type SearchBarProps = {
  query: string;
  resultIndex: number;
  resultCount: number;
  inputRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (query: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClear: () => void;
};

export function SearchBar({
  query,
  resultIndex,
  resultCount,
  inputRef,
  onQueryChange,
  onPrevious,
  onNext,
  onClear,
}: SearchBarProps) {
  const hasResults = resultCount > 0;

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.key !== "/" ||
        target?.matches("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, [inputRef]);

  return (
    <div className={styles.search} role="search" aria-label="搜尋正文">
      <label className={styles.label} htmlFor="reader-search">
        搜尋
      </label>
      <input
        ref={inputRef}
        id="reader-search"
        className={styles.input}
        type="search"
        value={query}
        placeholder="搜尋本卷正文"
        autoComplete="off"
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) onPrevious();
            else onNext();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClear();
          }
        }}
      />
      {query && (
        <button type="button" className={styles.clear} onClick={onClear} aria-label="清除搜尋">
          ×
        </button>
      )}
      <span className={styles.count} aria-live="polite">
        {hasResults ? `${resultIndex + 1}/${resultCount}` : query ? "0/0" : ""}
      </span>
      <button
        type="button"
        className={styles.navButton}
        onClick={onPrevious}
        disabled={!hasResults}
        aria-label="上一個搜尋結果"
      >
        ↑
      </button>
      <button
        type="button"
        className={styles.navButton}
        onClick={onNext}
        disabled={!hasResults}
        aria-label="下一個搜尋結果"
      >
        ↓
      </button>
    </div>
  );
}
