import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Passage, SourceNote, UserAnnotation } from "../types/corpus";
import type { PublishedAnnotation, PublishedProperName } from "../types/annotations";
import type { WritingMode } from "../types/reader";
import { AnnotationPopover } from "./AnnotationPopover";
import { PassageView } from "./PassageView";
import { UserAnnotationToolbar } from "./UserAnnotationToolbar";
import { UserNotePopover } from "./UserNotePopover";
import {
  rangesOverlap,
  selectionToAnchor,
  type SelectionFailure,
} from "./selection";
import {
  defaultOpacity,
  USER_COLORS,
  type UserColor,
} from "./userAnnotationStyle";
import styles from "./Reader.module.css";

type ReaderProps = {
  passages: Passage[];
  sourceNotes: SourceNote[];
  properNames: PublishedProperName[];
  annotations: PublishedAnnotation[];
  userAnnotations: UserAnnotation[];
  writingMode: WritingMode;
  showProperNames: boolean;
  scrollKey: string;
  onCreateUserAnnotation: (draft: {
    anchor: UserAnnotation["anchor"];
    style: UserAnnotation["style"];
    color: string;
    opacity: number;
    note: string;
  }) => Promise<UserAnnotation>;
  onUpdateUserAnnotation: (
    id: string,
    changes: Partial<Pick<UserAnnotation, "style" | "color" | "opacity" | "note">>,
  ) => Promise<void>;
  onDeleteUserAnnotation: (id: string) => Promise<void>;
};

const FAILURE_MESSAGE: Record<SelectionFailure, string> = {
  empty: "請先選取文字。",
  "outside-passage": "請在正文中選取文字。",
  "cross-passage": "一次只能標記同一段內的文字。",
  stale: "選取範圍與原文不一致，請重新選取。",
};

type PendingSelection = {
  anchor: UserAnnotation["anchor"] | null;
  rect: DOMRect;
};

/**
 * Shared empty array so memoised PassageViews keep a stable reference when a
 * passage has no annotations of a given layer.
 */
const EMPTY_LAYER: never[] = [];

function groupByPassage<T>(
  items: T[],
  keyOf: (item: T) => string = (item) =>
    (item as unknown as { passageId: string }).passageId,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = map.get(key);
    if (list) {
      list.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}

export function Reader({
  passages,
  sourceNotes,
  properNames,
  annotations,
  userAnnotations,
  writingMode,
  showProperNames,
  scrollKey,
  onCreateUserAnnotation,
  onUpdateUserAnnotation,
  onDeleteUserAnnotation,
}: ReaderProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorPassageRef = useRef<string | null>(null);
  const [openAnnotation, setOpenAnnotation] = useState<PublishedAnnotation | null>(null);
  const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null);

  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [pendingStyle, setPendingStyle] = useState<UserAnnotation["style"]>("highlight");
  const [pendingColor, setPendingColor] = useState<UserColor>(USER_COLORS[0]);
  const [pendingOpacity, setPendingOpacity] = useState(defaultOpacity("highlight"));
  const [pendingNotice, setPendingNotice] = useState<string | null>(null);
  const [openNote, setOpenNote] = useState<{
    annotation: UserAnnotation;
    element: HTMLElement;
    startEditing?: boolean;
  } | null>(null);
  const [pendingNoteId, setPendingNoteId] = useState<string | null>(null);

  const notesByPassage = useMemo(() => groupByPassage(sourceNotes), [sourceNotes]);
  const properNamesByPassage = useMemo(() => groupByPassage(properNames), [properNames]);
  const annotationsByPassage = useMemo(() => groupByPassage(annotations), [annotations]);
  const userAnnotationsByPassage = useMemo(
    () => groupByPassage(userAnnotations, (annotation) => annotation.anchor.passageId),
    [userAnnotations],
  );

  const passagesById = useMemo(
    () => new Map(passages.map((passage) => [passage.id, passage])),
    [passages],
  );

  const findPassageByElement = useCallback(
    (element: HTMLElement) => passagesById.get(element.getAttribute("data-passage-id") ?? ""),
    [passagesById],
  );

  const dismissPending = useCallback(() => {
    setPending(null);
    setPendingNotice(null);
    window.getSelection()?.removeAllRanges();
  }, []);

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

  // Selection → pending anchor. mouseup (not selectionchange) so the user has
  // finished dragging; pointerdown outside clears, matching how a native
  // selection popover behaves.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }

    const handleMouseUp = (event: Event) => {
      const target = event.target as Node | null;
      if (target && (target as Element).closest?.("[data-ui-marker]")) {
        return; // clicking a 注 / 批 badge must not open the toolbar
      }

      const result = selectionToAnchor(window.getSelection(), findPassageByElement);
      if (!result.ok) {
        // Only the cross-passage rule deserves a visible notice; the others
        // just mean "nothing usable is selected", which would be noise.
        if (result.reason === "cross-passage") {
          const selection = window.getSelection();
          const rect = selection?.rangeCount
            ? selection.getRangeAt(0).getBoundingClientRect()
            : null;
          setPending(rect ? { anchor: null, rect } : null);
          setPendingNotice(FAILURE_MESSAGE[result.reason]);
        } else {
          setPending(null);
          setPendingNotice(null);
        }
        return;
      }

      const overlapping = (userAnnotationsByPassage.get(result.anchor.passageId) ?? []).some(
        (existing) => rangesOverlap(existing.anchor, result.anchor),
      );
      if (overlapping) {
        setPendingNotice("此範圍與既有標記重疊，請先取消或刪除該標記。");
        setPending({ anchor: result.anchor, rect: result.rect });
        return;
      }

      setPendingNotice(null);
      setPending({ anchor: result.anchor, rect: result.rect });
    };

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.("[role='toolbar'], [data-note-popover]")) {
        return;
      }
      if (target?.closest?.("[data-batch-marker]")) {
        return;
      }
      setPending(null);
      setPendingNotice(null);
    };

    container.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      container.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [findPassageByElement, userAnnotationsByPassage]);

  const handleStyleChange = useCallback((next: UserAnnotation["style"]) => {
    setPendingStyle(next);
    // Opacity defaults differ per style; adopting the default on switch keeps
    // the two styles visually distinct without extra clicks.
    setPendingOpacity(defaultOpacity(next));
  }, []);

  const handleApply = useCallback(async () => {
    if (!pending?.anchor) {
      return;
    }
    await onCreateUserAnnotation({
      anchor: pending.anchor,
      style: pendingStyle,
      color: pendingColor,
      opacity: pendingOpacity,
      note: "",
    });
    dismissPending();
  }, [dismissPending, onCreateUserAnnotation, pending, pendingColor, pendingOpacity, pendingStyle]);

  const handleWriteNote = useCallback(async () => {
    if (!pending?.anchor) {
      return;
    }
    const created = await onCreateUserAnnotation({
      anchor: pending.anchor,
      style: pendingStyle,
      color: pendingColor,
      opacity: pendingOpacity,
      note: "",
    });
    // The record only exists in the DOM after the next render, so defer
    // resolving its 批 badge by id.
    setPendingNoteId(created.id);
    dismissPending();
  }, [dismissPending, onCreateUserAnnotation, pending, pendingColor, pendingOpacity, pendingStyle]);

  // Once the newly created mark has rendered, open its editor directly so
  // 「寫批註」 lands the user in the textarea. Anchored to the marked span, not
  // the 批 badge: a brand-new mark has no note yet, and the badge only exists
  // once a note is written.
  useEffect(() => {
    if (!pendingNoteId) {
      return;
    }
    const element = scrollRef.current?.querySelector<HTMLElement>(
      `[data-user-annotation-id="${CSS.escape(pendingNoteId)}"]`,
    );
    const annotation = userAnnotations.find((item) => item.id === pendingNoteId);
    if (element && annotation) {
      setOpenNote({ annotation, element, startEditing: true });
      setPendingNoteId(null);
    }
  }, [pendingNoteId, userAnnotations]);

  const handleOpenNote = useCallback(
    (annotation: UserAnnotation, element: HTMLElement) => {
      setOpenAnnotation(null);
      setOpenNote((current) =>
        current?.annotation.id === annotation.id ? null : { annotation, element },
      );
    },
    [],
  );

  const handleSaveNote = useCallback(
    async (note: string) => {
      if (!openNote) {
        return;
      }
      await onUpdateUserAnnotation(openNote.annotation.id, { note });
      setOpenNote(null);
    },
    [onUpdateUserAnnotation, openNote],
  );

  const handleDeleteNote = useCallback(async () => {
    if (!openNote) {
      return;
    }
    await onDeleteUserAnnotation(openNote.annotation.id);
    setOpenNote(null);
  }, [onDeleteUserAnnotation, openNote]);

  useEffect(() => {
    setOpenNote(null);
  }, [scrollKey, writingMode]);

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
            properNames={properNamesByPassage.get(passage.id) ?? EMPTY_LAYER}
            annotations={annotationsByPassage.get(passage.id) ?? EMPTY_LAYER}
            sourceNotes={notesByPassage.get(passage.id) ?? EMPTY_LAYER}
            userAnnotations={userAnnotationsByPassage.get(passage.id) ?? EMPTY_LAYER}
            showProperNames={showProperNames}
            onOpenAnnotation={handleOpenAnnotation}
            onOpenNote={handleOpenNote}
          />
        ))}
      </div>
      <AnnotationPopover
        annotation={openAnnotation}
        referenceElement={anchorElement}
        onClose={closeAnnotation}
      />
      {pending && (
        <UserAnnotationToolbar
          rect={pending.rect}
          style={pendingStyle}
          color={pendingColor}
          opacity={pendingOpacity}
          notice={pendingNotice}
          onStyleChange={handleStyleChange}
          onColorChange={setPendingColor}
          onOpacityChange={setPendingOpacity}
          onApply={() => void handleApply()}
          onWriteNote={() => void handleWriteNote()}
          onCancel={dismissPending}
        />
      )}
      {openNote && (
        <UserNotePopover
          annotation={openNote.annotation}
          referenceElement={openNote.element}
          startEditing={openNote.startEditing}
          onSave={(note) => void handleSaveNote(note)}
          onDelete={() => void handleDeleteNote()}
          onClose={() => setOpenNote(null)}
        />
      )}
    </div>
  );
}
