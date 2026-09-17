import {
  CATEGORY_LABEL,
  LAYER_LABEL,
  type PublishedAnnotation,
} from "../types/annotations";
import { PopoverClose, PopoverShell } from "./PopoverShell";
import styles from "./AnnotationPopover.module.css";

type AnnotationPopoverProps = {
  annotation: PublishedAnnotation;
  referenceElement: HTMLElement | null;
  onClose: () => void;
};

export function AnnotationPopover({
  annotation,
  referenceElement,
  onClose,
}: AnnotationPopoverProps) {
  return (
    <PopoverShell referenceElement={referenceElement} label="AI 注釋" onClose={onClose}>
      <div className={styles.header}>
        <span className={styles.category}>{CATEGORY_LABEL[annotation.category]}</span>
        <span className={styles.layer}>{LAYER_LABEL[annotation.layer]}</span>
        <PopoverClose label="關閉注釋" onClose={onClose} />
      </div>
      <p className={styles.quote}>{annotation.anchor.exact}</p>
      <p className={styles.body}>{annotation.text}</p>
      <div className={styles.footer}>
        AI 註釋 · {annotation.source === "reviewer" ? "複核後" : "生成"}
      </div>
    </PopoverShell>
  );
}
