import { useMemo } from "react";
import type { Passage, SourceNote, TextAnchor } from "../types/corpus";
import styles from "./PassageView.module.css";

type PassageViewProps = {
  passage: Passage;
  sourceNotes: SourceNote[];
};

type Segment = {
  text: string;
  note?: SourceNote;
};

function buildSegments(passageText: string, notes: SourceNote[]): Segment[] {
  if (notes.length === 0) {
    return [{ text: passageText }];
  }

  const anchors: (TextAnchor & { note: SourceNote })[] = notes
    .map((note) => ({ ...note.anchor, note }))
    .sort((a, b) => a.start - b.start);

  const segments: Segment[] = [];
  let cursor = 0;

  for (const anchor of anchors) {
    if (anchor.start > cursor) {
      segments.push({ text: passageText.slice(cursor, anchor.start) });
    }
    const exact = passageText.slice(anchor.start, anchor.end);
    segments.push({ text: exact, note: anchor.note });
    cursor = anchor.end;
  }

  if (cursor < passageText.length) {
    segments.push({ text: passageText.slice(cursor) });
  }

  return segments;
}

export function PassageView({ passage, sourceNotes }: PassageViewProps) {
  const segments = useMemo(
    () => buildSegments(passage.text, sourceNotes),
    [passage.text, sourceNotes],
  );

  return (
    <p className={styles.passage} data-passage-id={passage.id}>
      {segments.map((segment, index) => {
        if (segment.note) {
          return (
            <span
              key={index}
              className={styles.sourceNote}
              title={`${segment.note.provenance}：${segment.note.text}`}
            >
              {segment.text}
            </span>
          );
        }
        return <span key={index}>{segment.text}</span>;
      })}
    </p>
  );
}
