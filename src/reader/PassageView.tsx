import { memo, useMemo } from "react";
import type { Passage, SourceNote, UserAnnotation } from "../types/corpus";
import type { PublishedAnnotation, PublishedProperName } from "../types/annotations";
import { segmentByIntervals, type Interval } from "./anchors";
import { withOpacity } from "./userAnnotationStyle";
import styles from "./PassageView.module.css";

type PassageViewProps = {
  passage: Passage;
  properNames: PublishedProperName[];
  annotations: PublishedAnnotation[];
  sourceNotes: SourceNote[];
  userAnnotations: UserAnnotation[];
  showProperNames: boolean;
  onOpenAnnotation: (annotation: PublishedAnnotation, element: HTMLElement) => void;
  onOpenSourceNote: (note: SourceNote, element: HTMLElement) => void;
  onOpenMark: (annotation: UserAnnotation, element: HTMLElement) => void;
};

type Layer =
  | { kind: "properName"; value: PublishedProperName }
  | { kind: "annotation"; value: PublishedAnnotation }
  | { kind: "sourceNote"; value: SourceNote }
  | { kind: "userAnnotation"; value: UserAnnotation };

function findLayer<K extends Layer["kind"]>(
  layers: Layer[],
  kind: K,
): Extract<Layer, { kind: K }> | undefined {
  return layers.find((layer): layer is Extract<Layer, { kind: K }> => layer.kind === kind);
}

/**
 * Render one passage.
 *
 * All four annotation layers are merged through a single segmentation pass, so
 * a user highlight can overlap an AI 專名線 or 古注 without any layer clobbering
 * another's DOM (rule 4 / plan §8).
 *
 * Each atomic segment renders as::
 *
 *     <span>                       segment boundary
 *       <userDecoration>           background and/or wavy underline
 *         <annotation data-hook>   no visual decoration, data only
 *           <properNameLine>       solid line
 *             <sourceNote>text     dashed line + tint
 *       {注 badge}{批 badge}        outside all decoration, always clickable
 *     </span>
 *
 * Badges sit outside the decoration span so a wavy underline cannot run under
 * them, and they are marked as UI so Selection → anchor skips their text.
 */
function PassageViewComponent({
  passage,
  properNames,
  annotations,
  sourceNotes,
  userAnnotations,
  showProperNames,
  onOpenAnnotation,
  onOpenSourceNote,
  onOpenMark,
}: PassageViewProps) {
  const segments = useMemo(() => {
    const intervals: Interval<Layer>[] = [
      ...(showProperNames
        ? properNames.map((value) => ({
            start: value.anchor.start,
            end: value.anchor.end,
            data: { kind: "properName" as const, value },
          }))
        : []),
      ...annotations.map((value) => ({
        start: value.anchor.start,
        end: value.anchor.end,
        data: { kind: "annotation" as const, value },
      })),
      ...sourceNotes.map((value) => ({
        start: value.anchor.start,
        end: value.anchor.end,
        data: { kind: "sourceNote" as const, value },
      })),
      ...userAnnotations.map((value) => ({
        start: value.anchor.start,
        end: value.anchor.end,
        data: { kind: "userAnnotation" as const, value },
      })),
    ];
    return segmentByIntervals(passage.text, intervals);
  }, [passage.text, properNames, annotations, sourceNotes, userAnnotations, showProperNames]);

  return (
    <p className={styles.passage} data-passage-id={passage.id}>
      {segments.map((segment, index) => {
        const previous = index > 0 ? segments[index - 1].covering : [];
        const properName = findLayer(segment.covering, "properName")?.value;
        const annotation = findLayer(segment.covering, "annotation")?.value;
        const sourceNote = findLayer(segment.covering, "sourceNote")?.value;
        const userAnnotation = findLayer(segment.covering, "userAnnotation")?.value;

        const continues = <K extends Layer["kind"]>(kind: K, id: string) =>
          findLayer(previous, kind)?.value.id === id;

        let node: React.ReactNode = segment.text;

        if (sourceNote) {
          node = (
            <span
              className={styles.sourceNote}
              data-source-note-id={sourceNote.id}
              role="button"
              tabIndex={0}
              aria-label={`查看古注：${sourceNote.anchor.exact}`}
              onClick={(event) => {
                // A note is also selectable text: if the user just drag-selected
                // across it, the selection is the intent, not inspection.
                const selection = window.getSelection();
                if (selection && !selection.isCollapsed && selection.toString().trim()) {
                  return;
                }
                onOpenSourceNote(sourceNote, event.currentTarget);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenSourceNote(sourceNote, event.currentTarget);
                }
              }}
            >
              {node}
            </span>
          );
        }

        if (properName) {
          node = (
            <span
              className={
                continues("properName", properName.id)
                  ? styles.properNameContinued
                  : styles.properName
              }
              data-proper-name-type={properName.type}
              title={properName.type}
            >
              {node}
            </span>
          );
        }

        if (annotation) {
          node = (
            <span className={styles.annotated} data-annotation-id={annotation.id}>
              {node}
            </span>
          );
        }

        if (userAnnotation) {
          const decoration =
            userAnnotation.style === "highlight"
              ? { backgroundColor: withOpacity(userAnnotation.color, userAnnotation.opacity) }
              : {
                  textDecorationLine: "underline",
                  textDecorationStyle: "wavy" as const,
                  textDecorationColor: withOpacity(userAnnotation.color, userAnnotation.opacity),
                  textDecorationThickness: "2px",
                };
          node = (
            <span
              className={
                continues("userAnnotation", userAnnotation.id)
                  ? styles.userContinued
                  : styles.userMarked
              }
              style={decoration}
              data-user-annotation-id={userAnnotation.id}
              data-user-style={userAnnotation.style}
              title="點擊可查看或刪除標記"
              onClick={(event) => {
                // A mark is also selectable text: if the user just drag-selected
                // across it, the selection is the intent, not inspection.
                const selection = window.getSelection();
                if (selection && !selection.isCollapsed && selection.toString().trim()) {
                  return;
                }
                onOpenMark(userAnnotation, event.currentTarget);
              }}
            >
              {node}
            </span>
          );
        }

        return (
          <span key={`${segment.start}-${segment.end}`}>
            {node}
            {annotation && !continues("annotation", annotation.id) && (
              <button
                type="button"
                className={styles.annotationMarker}
                data-annotation-marker={annotation.id}
                data-ui-marker
                aria-label={`查看注釋：${annotation.anchor.exact}`}
                onClick={(event) => onOpenAnnotation(annotation, event.currentTarget)}
              >
                注
              </button>
            )}
            {userAnnotation &&
              userAnnotation.note.length > 0 &&
              !continues("userAnnotation", userAnnotation.id) && (
                <button
                  type="button"
                  className={styles.batchMarker}
                  data-batch-marker={userAnnotation.id}
                  data-ui-marker
                  aria-label={`查看批註：${userAnnotation.anchor.exact}`}
                  onClick={(event) => onOpenMark(userAnnotation, event.currentTarget)}
                >
                  批
                </button>
              )}
          </span>
        );
      })}
    </p>
  );
}

/*
 * A volume holds hundreds of passages, and every state change (creating a mark,
 * toggling a theme, opening a popover) re-renders the whole list. Memoising the
 * per-passage renderer keeps that cost proportional to what actually changed.
 * Callers must pass stable arrays for this to be effective — see EMPTY_LAYER in
 * Reader.tsx.
 */
export const PassageView = memo(PassageViewComponent);
