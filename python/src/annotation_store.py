"""Passage selection and on-disk layout shared by the annotation scripts.

Layout::

    data/ai_annotations/candidates/<key>.json          generator raw output
    data/ai_annotations/reviews/<key>.json             reviewer raw output
    data/review_reports/v0.1_annotation_quality_summary.json
    public/data/annotations/<workId>/<volumeId>.json   published (gated)
"""

import json
from pathlib import Path
from typing import Optional

from python.src.annotations import (
    AnnotationCandidate,
    AnnotationReview,
    PublishedAnnotation,
    PublishedProperName,
    PublishedVolumeAnnotations,
)
from python.src.models import Passage, Work
from python.src.paths import (
    AI_ANNOTATIONS_DIR,
    CANONICAL_DIR,
    PUBLIC_DATA_DIR,
    WORK_ID,
)


class PassageSelectionError(ValueError):
    """Raised when a --passage/--volume selector matches nothing usable."""


def safe_key(passage_id: str) -> str:
    """Filesystem-safe deterministic key for a passage id."""
    return passage_id.replace(":", "__")


def load_json(path: Path) -> object:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)


def load_work(canonical_root: Path = CANONICAL_DIR, work_id: str = WORK_ID) -> Work:
    path = canonical_root / work_id / "work.json"
    if not path.exists():
        raise FileNotFoundError(f"Missing {path}; run scripts/sync_wikisource.py first")
    return Work(**load_json(path))


def load_volume_passages(
    volume_id: str,
    canonical_root: Path = CANONICAL_DIR,
    work_id: str = WORK_ID,
) -> list[Passage]:
    path = canonical_root / work_id / f"{volume_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"Missing {path}; run scripts/sync_wikisource.py first")
    return [Passage(**item) for item in load_json(path)]


def select_passages(
    *,
    passage_id: Optional[str] = None,
    volume_id: Optional[str] = None,
    limit: Optional[int] = None,
    canonical_root: Path = CANONICAL_DIR,
    work_id: str = WORK_ID,
) -> list[Passage]:
    """Resolve CLI selectors into an ordered, deterministic passage list."""
    work = load_work(canonical_root, work_id)
    volumes = work.volumes

    if volume_id is not None:
        matches = [volume for volume in volumes if volume.id == volume_id]
        if not matches:
            raise PassageSelectionError(
                f"unknown volume {volume_id!r}; available: "
                + ", ".join(volume.id for volume in volumes)
            )
        volumes = matches

    selected: list[Passage] = []
    if passage_id is not None:
        found: Optional[Passage] = None
        for volume in volumes:
            for passage in load_volume_passages(volume.id, canonical_root, work_id):
                if passage.id == passage_id:
                    found = passage
                    break
            if found is not None:
                break
        if found is None:
            scope = f"volume {volume_id}" if volume_id else "the whole work"
            raise PassageSelectionError(
                f"unknown passage {passage_id!r} in {scope}"
            )
        selected = [found]
    else:
        for volume in volumes:
            selected.extend(load_volume_passages(volume.id, canonical_root, work_id))

    if limit is not None:
        if limit < 0:
            raise PassageSelectionError("--limit must be >= 0")
        selected = selected[:limit]

    if not selected:
        raise PassageSelectionError("selection matched no passages")
    return selected


def candidate_path(passage_id: str, root: Path = AI_ANNOTATIONS_DIR) -> Path:
    return root / "candidates" / f"{safe_key(passage_id)}.json"


def review_path(passage_id: str, root: Path = AI_ANNOTATIONS_DIR) -> Path:
    return root / "reviews" / f"{safe_key(passage_id)}.json"


def published_volume_path(
    volume_id: str,
    public_root: Path = PUBLIC_DATA_DIR,
    work_id: str = WORK_ID,
) -> Path:
    return public_root / "annotations" / work_id / f"{volume_id}.json"


def load_candidate(passage_id: str, root: Path = AI_ANNOTATIONS_DIR) -> AnnotationCandidate:
    path = candidate_path(passage_id, root)
    if not path.exists():
        raise FileNotFoundError(
            f"Missing candidate {path}; run scripts/annotate.py first"
        )
    return AnnotationCandidate(**load_json(path))


def load_review(passage_id: str, root: Path = AI_ANNOTATIONS_DIR) -> AnnotationReview:
    path = review_path(passage_id, root)
    if not path.exists():
        raise FileNotFoundError(
            f"Missing review {path}; run scripts/review_annotations.py first"
        )
    return AnnotationReview(**load_json(path))


def load_published_volume(
    volume_id: str,
    public_root: Path = PUBLIC_DATA_DIR,
    work_id: str = WORK_ID,
) -> PublishedVolumeAnnotations:
    path = published_volume_path(volume_id, public_root, work_id)
    if not path.exists():
        return PublishedVolumeAnnotations(workId=work_id, volumeId=volume_id)
    return PublishedVolumeAnnotations(**load_json(path))


def merge_published_entries(
    existing: PublishedVolumeAnnotations,
    passage_id: str,
    records: Optional[
        tuple[str, list[PublishedAnnotation], list[PublishedProperName]]
    ],
) -> PublishedVolumeAnnotations:
    """Replace one passage's published records, leaving other passages intact.

    ``records=None`` removes the passage (used for rejected passages). Keeping
    untouched passages means a partial ``--limit`` run cannot silently drop
    annotations published by an earlier run.
    """
    kept_annotations = [
        annotation
        for annotation in existing.annotations
        if annotation.passageId != passage_id
    ]
    kept_proper_names = [
        span for span in existing.properNames if span.passageId != passage_id
    ]

    if records is not None:
        _, annotations, proper_names = records
        kept_annotations.extend(annotations)
        kept_proper_names.extend(proper_names)

    kept_annotations.sort(key=lambda item: (item.passageId, item.anchor.start))
    kept_proper_names.sort(key=lambda item: (item.passageId, item.anchor.start))
    return PublishedVolumeAnnotations(
        workId=existing.workId,
        volumeId=existing.volumeId,
        annotations=kept_annotations,
        properNames=kept_proper_names,
    )


__all__ = [
    "PassageSelectionError",
    "candidate_path",
    "load_candidate",
    "load_json",
    "load_published_volume",
    "load_review",
    "load_volume_passages",
    "load_work",
    "merge_published_entries",
    "published_volume_path",
    "review_path",
    "safe_key",
    "save_json",
    "select_passages",
]
