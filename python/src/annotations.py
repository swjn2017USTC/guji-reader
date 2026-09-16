"""Annotation schemas shared by the generator, the reviewer and the publish gate.

Three shapes, deliberately separated:

* ``RawAnnotationPayload`` — what a model is asked to return. Spans are copied
  substrings (``exact``/``prefix``/``suffix``); models never emit offsets,
  because they miscount characters. ``prefix``/``suffix`` are disambiguation
  hints only, and are re-derived from the passage before storage.
* ``AnnotationCandidate`` — generator output after materialization. Anchors carry
  verified code-point offsets. This is what is stored and what the reviewer sees.
* ``PublishedAnnotation`` / ``PublishedProperName`` — what the reader consumes.
  Adds deterministic ids and provenance; only exists past the publish gate.
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

from python.src.models import AIAnnotation, TextAnchor

ProperNameType = Literal[
    "PERSON",
    "PLACE",
    "STATE",
    "ETHNICITY",
    "DYNASTY",
    "REIGN",
    "RELIGION",
    "INSTITUTION",
]

AnnotationCategory = Literal[
    "PERSON", "PLACE", "TERM", "OFFICE", "FIRST_APPEARANCE"
]

LAYER1_CATEGORIES: frozenset[str] = frozenset({"PERSON", "PLACE", "TERM"})
LAYER2_CATEGORIES: frozenset[str] = frozenset({"OFFICE", "FIRST_APPEARANCE"})

ReviewVerdict = Literal["accept", "revise", "reject"]

SCORE_FIELDS = (
    "proper_name_precision",
    "proper_name_recall",
    "entity_resolution",
    "place_accuracy",
    "term_necessity",
    "office_accuracy",
    "first_appearance_accuracy",
    "verbosity_control",
    "unsupported_claim_risk",
)


class RawProperName(BaseModel):
    """Model-facing proper-name span. No offsets."""

    exact: str = Field(min_length=1)
    prefix: str = ""
    suffix: str = ""
    type: ProperNameType


class RawAnnotation(BaseModel):
    """Model-facing annotation. No offsets."""

    exact: str = Field(min_length=1)
    prefix: str = ""
    suffix: str = ""
    layer: Literal[1, 2]
    category: AnnotationCategory
    text: str = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)

    @model_validator(mode="after")
    def _layer_matches_category(self) -> "RawAnnotation":
        expected = LAYER1_CATEGORIES if self.layer == 1 else LAYER2_CATEGORIES
        if self.category not in expected:
            raise ValueError(
                f"category {self.category} is not valid for layer {self.layer}"
            )
        return self


class RawAnnotationPayload(BaseModel):
    """Shape of one model response, for both generator and reviewer revisions."""

    properNames: list[RawProperName] = Field(default_factory=list)
    annotations: list[RawAnnotation] = Field(default_factory=list)


class ProperNameSpan(BaseModel):
    anchor: TextAnchor
    type: ProperNameType


class CandidateAnnotation(BaseModel):
    anchor: TextAnchor
    layer: Literal[1, 2]
    category: AnnotationCategory
    text: str = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)


class AnnotationCandidate(BaseModel):
    """One passage's worth of materialized generator (or revised) output."""

    passageId: str
    properNames: list[ProperNameSpan] = Field(default_factory=list)
    annotations: list[CandidateAnnotation] = Field(default_factory=list)


class ReviewIssue(BaseModel):
    severity: Literal["blocker", "major", "minor"]
    message: str = Field(min_length=1)


class ReviewScores(BaseModel):
    proper_name_precision: int = Field(ge=1, le=5)
    proper_name_recall: int = Field(ge=1, le=5)
    entity_resolution: int = Field(ge=1, le=5)
    place_accuracy: int = Field(ge=1, le=5)
    term_necessity: int = Field(ge=1, le=5)
    office_accuracy: int = Field(ge=1, le=5)
    first_appearance_accuracy: int = Field(ge=1, le=5)
    verbosity_control: int = Field(ge=1, le=5)
    unsupported_claim_risk: int = Field(ge=1, le=5)

    def average(self) -> float:
        values = [getattr(self, name) for name in SCORE_FIELDS]
        return round(sum(values) / len(values), 3)


class AnnotationReview(BaseModel):
    """Independent reviewer verdict. Never carries generator reasoning."""

    passageId: str
    overall: ReviewVerdict
    scores: ReviewScores
    issues: list[ReviewIssue] = Field(default_factory=list)
    revisedAnnotations: Optional[RawAnnotationPayload] = None

    @model_validator(mode="after")
    def _revise_requires_payload(self) -> "AnnotationReview":
        if self.overall == "revise" and self.revisedAnnotations is None:
            raise ValueError("overall=revise requires revisedAnnotations")
        return self


class PublishedProperName(BaseModel):
    id: str
    workId: str
    volumeId: str
    passageId: str
    anchor: TextAnchor
    type: ProperNameType


class PublishedAnnotation(AIAnnotation):
    category: AnnotationCategory
    source: Literal["generator", "reviewer"]


class PublishedVolumeAnnotations(BaseModel):
    workId: str
    volumeId: str
    annotations: list[PublishedAnnotation] = Field(default_factory=list)
    properNames: list[PublishedProperName] = Field(default_factory=list)


PROPER_NAME_TYPES: tuple[str, ...] = (
    "PERSON",
    "PLACE",
    "STATE",
    "ETHNICITY",
    "DYNASTY",
    "REIGN",
    "RELIGION",
    "INSTITUTION",
)

ANNOTATION_CATEGORIES: tuple[str, ...] = (
    "PERSON",
    "PLACE",
    "TERM",
    "OFFICE",
    "FIRST_APPEARANCE",
)


def proper_name_id(passage_id: str, type_: str, start: int, end: int) -> str:
    return f"pn:{passage_id}:{type_}:{start}-{end}"


def annotation_id(passage_id: str, category: str, start: int, end: int) -> str:
    return f"ai:{passage_id}:{category}:{start}-{end}"
