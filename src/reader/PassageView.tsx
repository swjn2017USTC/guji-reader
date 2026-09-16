import { useMemo } from "react";
import type { Passage, SourceNote } from "../types/corpus";
import type { PublishedAnnotation, PublishedProperName } from "../types/annotations";
import { segmentByIntervals, type Interval } from "./anchors";
import styles from "./PassageView.module.css";

type PassageViewProps = {
  passage: Passage;
  properNames: PublishedProperName[];
  annotations: PublishedAnnotation[];
  sourceNotes: SourceNote[];
  showProperNames: boolean;
  onOpenAnnotation: (annotation: PublishedAnnotation, element: HTMLElement) => void;
};

type Layer =
  | { kind: "properName"; value: PublishedProperName }
  | { kind: "annotation"; value: PublishedAnnotation }
  | { kind: "sourceNote"; value: SourceNote };

function findLayer<K extends Layer["kind"]>(
  layers: Layer[],
  kind: K,
): Extract<Layer, { kind: K }> | undefined {
  return layers.find((layer): layer is Extract<Layer, { kind: K }> => layer.kind === kind);
}

export function PassageView({
  passage,
  properNames,
  annotations,
  sourceNotes,
  showProperNames,
  onOpenAnnotation,
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
    ];
    return segmentByIntervals(passage.text, intervals);
  }, [passage.text, properNames, annotations, sourceNotes, showProperNames]);

  return (
    <p className={styles.passage} data-passage-id={passage.id}>
      {segments.map((segment, index) => {
        const previous = index > 0 ? segments[index - 1].covering : [];
        const properName = findLayer(segment.covering, "properName")?.value;
        const annotation = findLayer(segment.covering, "annotation")?.value;
        const sourceNote = findLayer(segment.covering, "sourceNote")?.value;

        const continuesProperName =
          properName !== undefined &&
          findLayer(previous, "properName")?.value.id === properName.id;
        const continuesAnnotation =
          annotation !== undefined &&
          findLayer(previous, "annotation")?.value.id === annotation.id;

        let node: React.ReactNode = segment.text;

        if (sourceNote) {
          node = (
            <span
              className={styles.sourceNote}
              data-source-note-id={sourceNote.id}
              title={`${sourceNote.provenance}：${sourceNote.text}`}
            >
              {node}
            </span>
          );
        }

        if (properName) {
          node = (
            <span
              className={
                continuesProperName ? styles.properNameContinued : styles.properName
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
              {!continuesAnnotation && (
                <button
                  type="button"
                  className={styles.annotationMarker}
                  data-annotation-marker={annotation.id}
                  aria-label={`查看注釋：${annotation.anchor.exact}`}
                  onClick={(event) =>
                    onOpenAnnotation(annotation, event.currentTarget)
                  }
                >
                  注
                </button>
              )}
            </span>
          );
        }

        return <span key={`${segment.start}-${segment.end}`}>{node}</span>;
      })}
    </p>
  );
}
