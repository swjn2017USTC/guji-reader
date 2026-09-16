import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
} from "../types/reader";
import styles from "./SettingsPanel.module.css";

type SettingsPanelProps = {
  fontSize: number;
  lineHeight: number;
  onFontSizeChange: (size: number) => void;
  onLineHeightChange: (height: number) => void;
};

export function SettingsPanel({
  fontSize,
  lineHeight,
  onFontSizeChange,
  onLineHeightChange,
}: SettingsPanelProps) {
  return (
    <aside className={styles.panel} aria-label="閱讀設置">
      <h2 className={styles.title}>設置</h2>

      <div className={styles.row}>
        <label htmlFor="font-size">字號</label>
        <input
          id="font-size"
          type="range"
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          step={1}
          value={fontSize}
          onChange={(e) => onFontSizeChange(Number(e.target.value))}
        />
        <span className={styles.value}>{fontSize}px</span>
      </div>

      <div className={styles.row}>
        <label htmlFor="line-height">行距</label>
        <input
          id="line-height"
          type="range"
          min={LINE_HEIGHT_MIN}
          max={LINE_HEIGHT_MAX}
          step={0.1}
          value={lineHeight}
          onChange={(e) => onLineHeightChange(Number(e.target.value))}
        />
        <span className={styles.value}>{lineHeight.toFixed(1)}</span>
      </div>
    </aside>
  );
}
