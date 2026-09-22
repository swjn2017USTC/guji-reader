import { z } from "zod";
import { userAnnotationSchema, type UserAnnotation } from "../types/corpus";

export const BACKUP_FORMAT = "guji-reader-user-annotations" as const;
export const BACKUP_VERSION = 1 as const;

const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.string().datetime(),
  workId: z.string().min(1),
  editionId: z.string().min(1),
  annotations: z.array(userAnnotationSchema),
});

export type AnnotationBackup = z.infer<typeof backupSchema>;

export type ImportResult = {
  annotations: UserAnnotation[];
  skippedDuplicates: number;
};

export function createAnnotationBackup(
  workId: string,
  editionId: string,
  annotations: UserAnnotation[],
  now = new Date(),
): AnnotationBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    workId,
    editionId,
    annotations,
  };
}

function annotationKey(annotation: Pick<UserAnnotation, "workId" | "editionId" | "anchor">): string {
  const { workId, editionId, anchor } = annotation;
  return `${workId}|${editionId}|${anchor.passageId}|${anchor.start}|${anchor.end}|${anchor.exact}`;
}

export function parseAnnotationBackup(
  raw: unknown,
  expectedWorkId: string,
  expectedEditionId: string,
  existing: UserAnnotation[],
): ImportResult {
  const backup = backupSchema.parse(raw);
  if (backup.workId !== expectedWorkId || backup.editionId !== expectedEditionId) {
    throw new Error("此備份不屬於目前的作品版本，為避免污染資料未匯入。");
  }

  const knownKeys = new Set(existing.map(annotationKey));
  const knownIds = new Set(existing.map((annotation) => annotation.id));
  const annotations: UserAnnotation[] = [];
  let skippedDuplicates = 0;
  for (const annotation of backup.annotations) {
    if (annotation.workId !== expectedWorkId || annotation.editionId !== expectedEditionId) {
      throw new Error("備份內含不同作品版本的標記，為避免污染資料未匯入。");
    }
    const key = annotationKey(annotation);
    if (knownKeys.has(key) || knownIds.has(annotation.id)) {
      skippedDuplicates += 1;
      continue;
    }
    knownKeys.add(key);
    knownIds.add(annotation.id);
    annotations.push(annotation);
  }
  return { annotations, skippedDuplicates };
}

export function parseAnnotationBackupText(
  text: string,
  expectedWorkId: string,
  expectedEditionId: string,
  existing: UserAnnotation[],
): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("備份不是有效的 JSON 檔案。");
  }
  return parseAnnotationBackup(raw, expectedWorkId, expectedEditionId, existing);
}
