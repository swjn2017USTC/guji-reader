#!/usr/bin/env python3
"""Independently review annotation candidates and publish only what passes.

The reviewer is a second, separate model request. It receives the canonical
passage, the candidate JSON and the rubric — never the generator's reasoning,
which the pipeline does not record in the first place.

Publish gate:
    accept -> generator output
    revise -> reviewer's revised output
    reject -> nothing published, report retained
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from python.src.annotation_pipeline import (
    REVIEWER_SCHEMA_HINT,
    AnchorError,
    PublishGateError,
    apply_publish_gate,
    build_quality_report,
    build_reviewer_messages,
    parse_review,
    summarize_reviews,
)
from python.src.annotation_store import (
    PassageSelectionError,
    load_candidate,
    load_published_volume,
    load_json,
    merge_published_entries,
    published_volume_path,
    review_path,
    save_json,
    select_passages,
)
from python.src.annotations import (
    AnnotationReview,
    PublishedAnnotation,
    PublishedProperName,
)
from python.src.llm import LLMClient, LLMConfig, LLMConfigError, LLMError
from python.src.models import Passage
from python.src.paths import REVIEW_REPORTS_DIR, WORK_ID

MAX_TOKENS = 6000
TEMPERATURE = 0.0
REPORT_NAME = "v0.1_annotation_quality_summary.json"

PassagePublication = Optional[tuple[str, list[PublishedAnnotation], list[PublishedProperName]]]


def _publish_volumes(
    publications: dict[str, PassagePublication],
    volume_of: dict[str, str],
) -> tuple[int, int]:
    """Merge this run's results into public/data/annotations/<workId>/<volumeId>.json.

    Only volumes present in ``publications`` are rewritten; other volumes keep
    whatever an earlier run published.
    """
    touched = sorted({volume_of[pid] for pid in publications if pid in volume_of})
    annotations_total = 0
    proper_names_total = 0

    for volume_id in touched:
        merged = load_published_volume(volume_id)
        for passage_id, records in sorted(publications.items()):
            if volume_of.get(passage_id) != volume_id:
                continue
            merged = merge_published_entries(merged, passage_id, records)
        save_json(published_volume_path(volume_id), merged.model_dump(mode="json"))
        annotations_total += len(merged.annotations)
        proper_names_total += len(merged.properNames)
        print(
            f"  published {volume_id}: {len(merged.annotations)} notes, "
            f"{len(merged.properNames)} proper-name spans"
        )

    return annotations_total, proper_names_total


def main() -> int:
    parser = argparse.ArgumentParser(description="Review and publish AI annotations")
    parser.add_argument("--passage", help="single passage id")
    parser.add_argument("--volume", help="volume id, e.g. vol01")
    parser.add_argument("--limit", type=int, help="max number of passages to review")
    parser.add_argument(
        "--force", action="store_true", help="re-review passages that already have a review"
    )
    args = parser.parse_args()

    try:
        passages: list[Passage] = select_passages(
            passage_id=args.passage, volume_id=args.volume, limit=args.limit
        )
    except (PassageSelectionError, FileNotFoundError) as exc:
        print(f"SELECTION ERROR: {exc}", file=sys.stderr)
        return 2

    try:
        config = LLMConfig.from_env()
    except LLMConfigError as exc:
        print(f"CONFIG ERROR: {exc}", file=sys.stderr)
        return 2

    print(f"Passages selected: {len(passages)}")
    print(f"Reviewer model: {config.model}")

    reviews: list[AnnotationReview] = []
    publications: dict[str, PassagePublication] = {}
    failures: list[tuple[str, str]] = []
    cached = 0

    with LLMClient(config) as client:
        for index, passage in enumerate(passages, start=1):
            try:
                candidate = load_candidate(passage.id)
            except FileNotFoundError:
                failures.append((passage.id, "no candidate; run scripts/annotate.py first"))
                print(f"  [{index}/{len(passages)}] SKIP {passage.id}: no candidate")
                continue

            path = review_path(passage.id)
            if path.exists() and not args.force:
                review = AnnotationReview(**load_json(path))
                cached += 1
            else:
                try:
                    review = client.complete_validated_json(
                        build_reviewer_messages(passage.text, candidate),
                        lambda raw, pid=passage.id: parse_review(pid, raw),
                        max_tokens=MAX_TOKENS,
                        temperature=TEMPERATURE,
                        schema_hint=REVIEWER_SCHEMA_HINT,
                    )
                except (LLMError, ValueError) as exc:
                    failures.append((passage.id, f"{type(exc).__name__}: {exc}"))
                    print(f"  [{index}/{len(passages)}] FAIL {passage.id}: {exc}")
                    continue
                save_json(path, review.model_dump(mode="json"))

            try:
                records = apply_publish_gate(
                    passage,
                    candidate,
                    review,
                    work_id=WORK_ID,
                    volume_id=passage.volumeId,
                )
            except (AnchorError, PublishGateError) as exc:
                failures.append((passage.id, f"{type(exc).__name__}: {exc}"))
                print(f"  [{index}/{len(passages)}] GATE FAIL {passage.id}: {exc}")
                continue

            reviews.append(review)
            publications[passage.id] = records
            published_notes = len(records[1]) if records else 0
            print(
                f"  [{index}/{len(passages)}] {passage.id}: {review.overall} "
                f"(published {published_notes} notes)"
            )

    volume_of = {passage.id: passage.volumeId for passage in passages}
    annotation_count, proper_name_count = _publish_volumes(publications, volume_of)

    report = build_quality_report(
        reviews,
        model=config.model,
        generated_at=datetime.now(timezone.utc).isoformat(),
        work_id=WORK_ID,
        published_volumes=sorted({volume_of[pid] for pid in publications}),
        published_annotation_count=annotation_count,
        published_proper_name_count=proper_name_count,
    )
    report["cachedReviews"] = cached
    save_json(REVIEW_REPORTS_DIR / REPORT_NAME, report)

    summary = summarize_reviews(reviews)
    print(f"\nReviewed: {summary['reviewedPassages']}  (cached: {cached})")
    print(f"Verdicts: {summary['verdicts']}")
    print(f"Overall average score: {summary['overallAverageScore']}")
    print(f"Report: {REVIEW_REPORTS_DIR / REPORT_NAME}")

    if failures:
        print(f"Failures: {len(failures)}", file=sys.stderr)
        for passage_id, message in failures:
            print(f"  {passage_id}: {message}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
