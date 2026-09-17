import { z } from "zod";
import { textAnchorSchema } from "./corpus";

export const properNameTypeSchema = z.enum([
  "PERSON",
  "PLACE",
  "STATE",
  "ETHNICITY",
  "DYNASTY",
  "REIGN",
  "RELIGION",
  "INSTITUTION",
]);

export const annotationCategorySchema = z.enum([
  "PERSON",
  "PLACE",
  "TERM",
  "OFFICE",
  "FIRST_APPEARANCE",
]);

export type AnnotationCategory = z.infer<typeof annotationCategorySchema>;

export const publishedAnnotationSchema = z.object({
  id: z.string(),
  workId: z.string(),
  volumeId: z.string(),
  passageId: z.string(),
  anchor: textAnchorSchema,
  layer: z.union([z.literal(1), z.literal(2)]),
  category: annotationCategorySchema,
  text: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  source: z.enum(["generator", "reviewer"]),
});

export type PublishedAnnotation = z.infer<typeof publishedAnnotationSchema>;

export const publishedProperNameSchema = z.object({
  id: z.string(),
  workId: z.string(),
  volumeId: z.string(),
  passageId: z.string(),
  anchor: textAnchorSchema,
  type: properNameTypeSchema,
});

export type PublishedProperName = z.infer<typeof publishedProperNameSchema>;

export const publishedVolumeAnnotationsSchema = z.object({
  workId: z.string(),
  volumeId: z.string(),
  annotations: z.array(publishedAnnotationSchema),
  properNames: z.array(publishedProperNameSchema),
});

export type PublishedVolumeAnnotations = z.infer<typeof publishedVolumeAnnotationsSchema>;

/** Short labels shown next to a "注" marker. */
export const CATEGORY_LABEL: Record<AnnotationCategory, string> = {
  PERSON: "人物",
  PLACE: "地名",
  TERM: "難詞",
  OFFICE: "官職",
  FIRST_APPEARANCE: "首見",
};

export const LAYER_LABEL: Record<1 | 2, string> = {
  1: "第一層",
  2: "第二層",
};
