import type { SourceNote } from "../types/corpus";
import { PopoverClose, PopoverShell } from "./PopoverShell";
import styles from "./SourceNotePopover.module.css";

type SourceNotePopoverProps = {
  note: SourceNote;
  referenceElement: HTMLElement | null;
  onClose: () => void;
};

/**
 * 古注 reader (胡三省注 and similar).
 *
 * Deliberately styled apart from the AI 注釋 popover: a dashed, tinted chip for
 * the layer name instead of the solid accent chip, and the provenance line in
 * place of the "AI 註釋" footer. Rule 4 requires source notes, AI notes and user
 * notes to stay distinguishable in data and in UI, so this never borrows the AI
 * layer's visual language.
 */
export function SourceNotePopover({
  note,
  referenceElement,
  onClose,
}: SourceNotePopoverProps) {
  return (
    <PopoverShell referenceElement={referenceElement} label="古注" onClose={onClose}>
      <div className={styles.header}>
        <span className={styles.layerChip}>古注</span>
        <PopoverClose label="關閉古注" onClose={onClose} />
      </div>
      <p className={styles.quote} data-source-note-quote>
        {note.anchor.exact}
      </p>
      <p className={styles.body} data-source-note-body>
        {note.text}
      </p>
      <div className={styles.footer} data-source-note-provenance>
        {note.provenance}
      </div>
    </PopoverShell>
  );
}
