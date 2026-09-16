import { useFloating, offset } from "@floating-ui/react";
import { useEffect, useMemo } from "react";
import {
  CATEGORY_LABEL,
  LAYER_LABEL,
  type PublishedAnnotation,
} from "../types/annotations";
import styles from "./AnnotationPopover.module.css";

type AnnotationPopoverProps = {
  annotation: PublishedAnnotation | null;
  referenceElement: HTMLElement | null;
  onClose: () => void;
};

/*
 * Only `offset` is used. `flip`/`shift` were measured at ~7s per popover mount
 * under jsdom (they re-measure against zero-size layout) and they leaked across
 * tests, while `offset` alone stays sub-millisecond. The popover is 20rem wide
 * inside a 42rem column with max-width: 90vw, so collision handling is not
 * load-bearing for V0.1.
 */
const MIDDLEWARE = [offset(8)];

export function AnnotationPopover({
  annotation,
  referenceElement,
  onClose,
}: AnnotationPopoverProps) {
  // Memoized: floating-ui recomputes whenever `elements` changes identity.
  const elements = useMemo(() => ({ reference: referenceElement }), [referenceElement]);

  const { refs, floatingStyles } = useFloating({ elements, middleware: MIDDLEWARE });

  useEffect(() => {
    if (!annotation) {
      return;
    }
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
  }, [annotation, onClose, referenceElement, refs.floating]);

  if (!annotation) {
    return null;
  }

  return (
    <div
      ref={refs.setFloating}
      style={floatingStyles}
      className={styles.popover}
      role="dialog"
      aria-label="AI 注釋"
    >
      <div className={styles.header}>
        <span className={styles.category}>{CATEGORY_LABEL[annotation.category]}</span>
        <span className={styles.layer}>{LAYER_LABEL[annotation.layer]}</span>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="關閉注釋"
        >
          ×
        </button>
      </div>
      <p className={styles.quote}>{annotation.anchor.exact}</p>
      <p className={styles.body}>{annotation.text}</p>
      <div className={styles.footer}>AI 註釋 · {annotation.source === "reviewer" ? "複核後" : "生成"}</div>
    </div>
  );
}
