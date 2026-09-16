import { useEffect, useMemo, useRef } from "react";
import type { Passage, SourceNote } from "../types/corpus";
import type { WritingMode } from "../types/reader";
import { PassageView } from "./PassageView";
import styles from "./Reader.module.css";

type ReaderProps = {
  passages: Passage[];
  sourceNotes: SourceNote[];
  writingMode: WritingMode;
  scrollKey: string;
};

export function Reader({ passages, sourceNotes, writingMode, scrollKey }: ReaderProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const notesByPassage = useMemo(() => {
    const map = new Map<string, SourceNote[]>();
    for (const note of sourceNotes) {
      const list = map.get(note.passageId) ?? [];
      list.push(note);
      map.set(note.passageId, list);
    }
    return map;
  }, [sourceNotes]);

  useEffect(() => {
    // Reset scroll when volume changes.
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      scrollRef.current.scrollLeft = 0;
    }
  }, [scrollKey]);

  return (
    <div ref={scrollRef} className={styles.scroll}>
      <div
        className={
          writingMode === "vertical" ? styles.contentVertical : styles.contentHorizontal
        }
        style={{
          writingMode: writingMode === "vertical" ? "vertical-rl" : "horizontal-tb",
        }}
      >
        {passages.map((passage) => (
          <PassageView
            key={passage.id}
            passage={passage}
            sourceNotes={notesByPassage.get(passage.id) ?? []}
          />
        ))}
      </div>
    </div>
  );
}
