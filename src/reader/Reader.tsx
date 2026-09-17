import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Passage, SourceNote } from "../types/corpus";
import type { PublishedAnnotation, PublishedProperName } from "../types/annotations";
import type { WritingMode } from "../types/reader";
import { AnnotationPopover } from "./AnnotationPopover";
import { PassageView } from "./PassageView";
import styles from "./Reader.module.css";

type ReaderProps = {
  passages: Passage[];
  sourceNotes: SourceNote[];
  properNames: PublishedProperName[];
  annotations: PublishedAnnotation[];
  writingMode: WritingMode;
  showProperNames: boolean;
  scrollKey: string;
};

function groupByPassage<T extends { passageId: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const list = map.get(item.passageId);
    if (list) {
      list.push(item);
    } else {
      map.set(item.passageId, [item]);
    }
  }
  return map;
}

export function Reader({
  passages,
  sourceNotes,
  properNames,
  annotations,
  writingMode,
  showProperNames,
  scrollKey,
}: ReaderProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorPassageRef = useRef<string | null>(null);
  const [openAnnotation, setOpenAnnotation] = useState<PublishedAnnotation | null>(null);
  const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null);

  const notesByPassage = useMemo(() => groupByPassage(sourceNotes), [sourceNotes]);
  const properNamesByPassage = useMemo(() => groupByPassage(properNames), [properNames]);
  const annotationsByPassage = useMemo(() => groupByPassage(annotations), [annotations]);

  const handleOpenAnnotation = useCallback(
    (annotation: PublishedAnnotation, element: HTMLElement) => {
      setOpenAnnotation((current) => (current?.id === annotation.id ? null : annotation));
      setAnchorElement(element);
    },
    [],
  );

  const closeAnnotation = useCallback(() => setOpenAnnotation(null), []);

  useEffect(() => {
    // A popover anchored to old DOM must not survive a volume or mode change.
    setOpenAnnotation(null);
  }, [scrollKey, writingMode]);

  // Track which passage sits at the reading origin so a writing-mode switch can
  // return the reader to roughly the same place. elementFromPoint was unreliable
  // here (scroller padding and text-indent both leave probe points over no
  // glyphs), so this measures passage boxes instead — debounced to once per
  // scroll gesture rather than once per frame.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) {
      return;
    }
    let timer = 0;
    const capture = () => {
      const content = scroller.firstElementChild as HTMLElement | null;
      if (!content) {
        return;
      }
      // The origin is the viewport's reading edge, not the content's: the
      // content box extends far off-screen in vertical mode.
      const viewport = scroller.getBoundingClientRect();
      const origin =
        writingMode === "vertical" ? viewport.right : viewport.top;
      let best: string | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const node of content.querySelectorAll<HTMLElement>("[data-passage-id]")) {
        const rect = node.getBoundingClientRect();
        const start = writingMode === "vertical" ? rect.right : rect.top;
        const distance = Math.abs(start - origin);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = node.getAttribute("data-passage-id");
        }
      }
      if (best) {
        anchorPassageRef.current = best;
      }
    };
    const handleScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(capture, 150);
    };
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", handleScroll);
      window.clearTimeout(timer);
    };
  }, [writingMode]);

  // Vertical CJK text overflows horizontally, so the scroller has nothing to
  // scroll vertically. A plain mouse wheel only reports deltaY, which the
  // browser tries to apply vertically and therefore does nothing — the reader
  // was forced to drag the scrollbar. Map deltaY onto the inline axis instead.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || writingMode !== "vertical") {
      return;
    }
    const handleWheel = (event: WheelEvent) => {
      // Horizontal trackpad gestures and pinch-zoom already behave correctly.
      if (event.deltaY === 0 || event.ctrlKey) {
        return;
      }
      event.preventDefault();
      // vertical-rl reads right-to-left: wheel-down advances the text, which
      // means scrolling toward the left edge.
      scroller.scrollLeft -= event.deltaY;
    };
    scroller.addEventListener("wheel", handleWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", handleWheel);
  }, [writingMode]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const anchorId = anchorPassageRef.current;
      const target = anchorId
        ? scroller.querySelector<HTMLElement>(`[data-passage-id="${anchorId}"]`)
        : null;
      if (target) {
        target.scrollIntoView({ block: "start", inline: "start" });
        return;
      }
      // Vertical CJK flows right-to-left, so the start of the text is the right
      // edge; scrollLeft = 0 would drop the reader at the end of the volume.
      if (writingMode === "vertical") {
        scroller.scrollLeft = scroller.scrollWidth;
      } else {
        scroller.scrollTop = 0;
        scroller.scrollLeft = 0;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [writingMode, scrollKey]);

  useEffect(() => {
    // A new volume always starts at its beginning.
    anchorPassageRef.current = null;
  }, [scrollKey]);

  return (
    <div ref={scrollRef} className={styles.scroll} data-reader-scroll>
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
            properNames={properNamesByPassage.get(passage.id) ?? []}
            annotations={annotationsByPassage.get(passage.id) ?? []}
            sourceNotes={notesByPassage.get(passage.id) ?? []}
            showProperNames={showProperNames}
            onOpenAnnotation={handleOpenAnnotation}
          />
        ))}
      </div>
      <AnnotationPopover
        annotation={openAnnotation}
        referenceElement={anchorElement}
        onClose={closeAnnotation}
      />
    </div>
  );
}
