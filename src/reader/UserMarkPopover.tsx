import { useEffect, useState } from "react";
import type { UserAnnotation } from "../types/corpus";
import { USER_STYLE_LABEL, withOpacity } from "./userAnnotationStyle";
import { PopoverClose, PopoverShell } from "./PopoverShell";
import styles from "./UserMarkPopover.module.css";

type UserMarkPopoverProps = {
  annotation: UserAnnotation;
  referenceElement: HTMLElement | null;
  /** Open directly in edit mode — used by 寫批註 on a brand-new mark. */
  startEditing?: boolean;
  onSave: (note: string) => void;
  onDelete: () => void;
  onClose: () => void;
};

/**
 * Inspector for one personal mark.
 *
 * highlight and wavy share a single record shape, so they share a single
 * popover: both can be deleted, and both can carry a note. The only difference
 * is the label on the primary action — a mark with no note yet offers 寫批註,
 * one that has a note offers 編輯.
 */
export function UserMarkPopover({
  annotation,
  referenceElement,
  startEditing = false,
  onSave,
  onDelete,
  onClose,
}: UserMarkPopoverProps) {
  const [editing, setEditing] = useState(startEditing);
  const [draft, setDraft] = useState(annotation.note);

  useEffect(() => {
    setDraft(annotation.note);
    setEditing(startEditing);
  }, [annotation.id, annotation.note, startEditing]);

  const hasNote = annotation.note.trim().length > 0;

  return (
    <PopoverShell referenceElement={referenceElement} label="個人標記" onClose={onClose}>
      <div className={styles.header}>
        <span
          className={styles.swatch}
          style={{ backgroundColor: withOpacity(annotation.color, annotation.opacity) }}
        />
        <span className={styles.styleLabel}>{USER_STYLE_LABEL[annotation.style]}</span>
        <PopoverClose label="關閉標記" onClose={onClose} />
      </div>

      <p className={styles.quote} data-note-quote>
        {annotation.anchor.exact}
      </p>

      {editing ? (
        <>
          <textarea
            className={styles.textarea}
            value={draft}
            aria-label="批註內容"
            rows={4}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => {
                onSave(draft);
                setEditing(false);
              }}
            >
              儲存
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                setDraft(annotation.note);
                setEditing(false);
              }}
            >
              取消
            </button>
          </div>
        </>
      ) : (
        <>
          {hasNote ? (
            <p className={styles.note} data-note-body>
              {annotation.note}
            </p>
          ) : (
            <p className={styles.hint} data-note-empty>
              尚無批註
            </p>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => setEditing(true)}
            >
              {hasNote ? "編輯" : "寫批註"}
            </button>
            <button
              type="button"
              className={styles.danger}
              data-delete-mark
              onClick={onDelete}
            >
              刪除
            </button>
          </div>
        </>
      )}
    </PopoverShell>
  );
}
