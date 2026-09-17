import { offset, useFloating } from "@floating-ui/react";
import { useEffect } from "react";
import type { UserAnnotation } from "../types/corpus";
import {
  USER_COLORS,
  USER_STYLE_LABEL,
  withOpacity,
  type UserColor,
} from "./userAnnotationStyle";
import styles from "./UserAnnotationToolbar.module.css";

/*
 * Only `offset` is used: flip/shift measured at ~7s per mount under jsdom and
 * leaked across tests. The toolbar is a small fixed-width strip placed just
 * below the selection.
 */
const MIDDLEWARE = [offset(8)];

type UserAnnotationToolbarProps = {
  rect: DOMRect;
  style: UserAnnotation["style"];
  color: string;
  opacity: number;
  notice: string | null;
  onStyleChange: (style: UserAnnotation["style"]) => void;
  onColorChange: (color: UserColor) => void;
  onOpacityChange: (opacity: number) => void;
  onApply: () => void;
  onWriteNote: () => void;
  onCancel: () => void;
};

export function UserAnnotationToolbar({
  rect,
  style,
  color,
  opacity,
  notice,
  onStyleChange,
  onColorChange,
  onOpacityChange,
  onApply,
  onWriteNote,
  onCancel,
}: UserAnnotationToolbarProps) {
  const { refs, floatingStyles } = useFloating({ middleware: MIDDLEWARE });

  // A text selection is not an Element, so the toolbar is positioned against a
  // virtual reference built from the selection's bounding rect.
  useEffect(() => {
    refs.setPositionReference({
      getBoundingClientRect: () => rect,
    });
  }, [rect, refs]);

  return (
    <div
      ref={refs.setFloating}
      style={floatingStyles}
      className={styles.toolbar}
      role="toolbar"
      aria-label="標記工具"
    >
      <div className={styles.row}>
        <div className={styles.styles}>
          {(["highlight", "wavy"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={option === style ? styles.styleActive : styles.style}
              aria-pressed={option === style}
              onClick={() => onStyleChange(option)}
            >
              {USER_STYLE_LABEL[option]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={onCancel}
          aria-label="取消標記"
        >
          ×
        </button>
      </div>

      <div className={styles.colors} role="group" aria-label="顏色">
        {USER_COLORS.map((option) => (
          <button
            key={option}
            type="button"
            className={option === color ? styles.colorActive : styles.color}
            style={{ backgroundColor: option }}
            aria-label={`顏色 ${option}`}
            aria-pressed={option === color}
            data-color={option}
            onClick={() => onColorChange(option)}
          />
        ))}
      </div>

      <label className={styles.opacityRow}>
        <span className={styles.opacityLabel}>透明度</span>
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.05}
          value={opacity}
          aria-label="透明度"
          onChange={(event) => onOpacityChange(Number(event.target.value))}
        />
        <span className={styles.opacityValue}>{opacity.toFixed(2)}</span>
      </label>

      <div className={styles.preview} style={{ backgroundColor: withOpacity(color, opacity) }}>
        預覽
      </div>

      {notice && <p className={styles.notice}>{notice}</p>}

      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onApply}>
          標記
        </button>
        <button type="button" className={styles.secondary} onClick={onWriteNote}>
          寫批註
        </button>
      </div>
    </div>
  );
}
