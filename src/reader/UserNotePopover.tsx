import { offset, useFloating } from "@floating-ui/react";
import { useEffect, useMemo, useState } from "react";
import type { UserAnnotation } from "../types/corpus";
import { USER_STYLE_LABEL, withOpacity } from "./userAnnotationStyle";
import styles from "./UserNotePopover.module.css";

const MIDDLEWARE = [offset(8)];

type UserNotePopoverProps = {
  annotation: UserAnnotation;
  referenceElement: HTMLElement | null;
  /** Open directly in edit mode — used by 寫批註 on a brand-new mark. */
  startEditing?: boolean;
  onSave: (note: string) => void;
  onDelete: () => void;
  onClose: () => void;
};

export function UserNotePopover({
  annotation,
  referenceElement,
  startEditing = false,
  onSave,
  onDelete,
  onClose,
}: UserNotePopoverProps) {
  const [editing, setEditing] = useState(startEditing);
  const [draft, setDraft] = useState(annotation.note);

  const elements = useMemo(() => ({ reference: referenceElement }), [referenceElement]);
  const { refs, floatingStyles } = useFloating({ elements, middleware: MIDDLEWARE });

  useEffect(() => {
    setDraft(annotation.note);
    setEditing(startEditing);
  }, [annotation.id, annotation.note, startEditing]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (refs.floating.current?.contains(target)) {
        return;
      }
      if (referenceElement?.contains(target)) {
        return;
      }
      onClose();
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [onClose, referenceElement, refs.floating]);

  return (
    <div
      ref={refs.setFloating}
      style={floatingStyles}
      className={styles.popover}
      role="dialog"
      aria-label="個人批註"
    >
      <div className={styles.header}>
        <span
          className={styles.swatch}
          style={{ backgroundColor: withOpacity(annotation.color, annotation.opacity) }}
        />
        <span className={styles.styleLabel}>{USER_STYLE_LABEL[annotation.style]}</span>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="關閉批註"
        >
          ×
        </button>
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
          <p className={styles.note} data-note-body>
            {annotation.note ? annotation.note : "（無批註文字）"}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => setEditing(true)}
            >
              編輯
            </button>
            <button type="button" className={styles.danger} onClick={onDelete}>
              刪除
            </button>
          </div>
        </>
      )}
    </div>
  );
}
