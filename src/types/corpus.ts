import { z } from "zod";

export const workSourceSchema = z.object({
  provider: z.literal("wikisource"),
  url: z.string().url(),
  retrievedAt: z.string().datetime(),
});

export const volumeRefSchema = z.object({
  id: z.string(),
  workId: z.string(),
  title: z.string(),
  order: z.number().int().nonnegative(),
  sourcePage: z.string().url(),
  passageCount: z.number().int().nonnegative(),
});

export type VolumeRef = z.infer<typeof volumeRefSchema>;

export const workSchema = z.object({
  id: z.string(),
  title: z.string(),
  editionId: z.string(),
  source: workSourceSchema,
  volumes: z.array(volumeRefSchema),
});

export type Work = z.infer<typeof workSchema>;

export const passageSchema = z.object({
  id: z.string(),
  workId: z.string(),
  volumeId: z.string(),
  order: z.number().int().nonnegative(),
  text: z.string().min(1),
  sourcePage: z.string().url(),
  revisionId: z.string().optional(),
});

export type Passage = z.infer<typeof passageSchema>;

export const textAnchorSchema = z.object({
  passageId: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  exact: z.string().min(1),
  prefix: z.string(),
  suffix: z.string(),
});

export type TextAnchor = z.infer<typeof textAnchorSchema>;

export const sourceNoteSchema = z.object({
  id: z.string(),
  workId: z.string(),
  volumeId: z.string(),
  passageId: z.string(),
  anchor: textAnchorSchema,
  text: z.string().min(1),
  provenance: z.string(),
});

export type SourceNote = z.infer<typeof sourceNoteSchema>;

/*
 * Mirrors models.AIAnnotation. Nothing in src/ consumes it directly — the reader
 * validates the published shape via publishedAnnotationSchema in
 * types/annotations.ts — but it is kept because the checklist requires
 * src/types to correspond one-to-one with the Python models, and the Python side
 * genuinely uses it (PublishedAnnotation extends AIAnnotation). Removing it
 * would break that contract to satisfy a dead-code heuristic.
 */
export const aiAnnotationSchema = z.object({
  id: z.string(),
  workId: z.string(),
  volumeId: z.string(),
  passageId: z.string(),
  anchor: textAnchorSchema,
  layer: z.union([z.literal(1), z.literal(2)]),
  category: z.string(),
  text: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
});

export type AIAnnotation = z.infer<typeof aiAnnotationSchema>;

export const userAnnotationSchema = z.object({
  id: z.string(),
  workId: z.string(),
  editionId: z.string(),
  anchor: textAnchorSchema,
  style: z.union([z.literal("highlight"), z.literal("wavy")]),
  color: z.string(),
  opacity: z.number().min(0).max(1),
  note: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type UserAnnotation = z.infer<typeof userAnnotationSchema>;
