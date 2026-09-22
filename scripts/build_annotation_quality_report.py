#!/usr/bin/env python3
"""Build a non-destructive, per-volume annotation coverage report.

This report reads canonical passages, cached candidates/reviews, and published
annotations. It never edits corpus or published annotation files, and it keeps
"not reviewed" distinct from zero annotations.
"""

import argparse
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from python.src.annotation_store import (  # noqa: E402
    candidate_path,
    load_json,
    load_published_volume,
    load_volume_passages,
    load_work,
    review_path,
    save_json,
)
from python.src.annotations import AnnotationReview  # noqa: E402
from python.src.paths import REVIEW_REPORTS_DIR, WORK_ID  # noqa: E402


def build_report() -> dict:
    work = load_work()
    volumes = []
    total = Counter()
    for volume in sorted(work.volumes, key=lambda item: item.order):
        passages = load_volume_passages(volume.id)
        passage_ids = {passage.id for passage in passages}
        candidates = {p.id for p in passages if candidate_path(p.id).exists()}
        reviews: dict[str, AnnotationReview] = {}
        for passage in passages:
            path = review_path(passage.id)
            if path.exists():
                reviews[passage.id] = AnnotationReview(**load_json(path))

        published = load_published_volume(volume.id)
        anchor_failures: list[str] = []
        text_by_id = {passage.id: passage.text for passage in passages}
        for record in [*published.annotations, *published.properNames]:
            text = text_by_id.get(record.passageId)
            if text is None or text[record.anchor.start:record.anchor.end] != record.anchor.exact:
                anchor_failures.append(record.id)

        verdicts = Counter(review.overall for review in reviews.values())
        volume_row = {
            "volumeId": volume.id,
            "title": volume.title,
            "passageCount": len(passages),
            "candidatePassages": len(candidates),
            "reviewedPassages": len(reviews),
            "unreviewedCandidatePassages": len(candidates - set(reviews)),
            "verdicts": {key: verdicts.get(key, 0) for key in ("accept", "revise", "reject")},
            "published": {
                "annotations": len(published.annotations),
                "properNames": len(published.properNames),
                "passages": len({record.passageId for record in [*published.annotations, *published.properNames]}),
            },
            "anchorFailures": sorted(anchor_failures),
            "status": "ready" if not anchor_failures and reviews else "partial",
        }
        volumes.append(volume_row)
        total.update({
            "passages": len(passages),
            "candidatePassages": len(candidates),
            "reviewedPassages": len(reviews),
            "anchorFailures": len(anchor_failures),
            "annotations": len(published.annotations),
            "properNames": len(published.properNames),
        })

    gate_blockers = [
        "published_anchor_failure" for _ in range(total["anchorFailures"])
    ]
    return {
        "schemaVersion": "g4-1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "workId": work.id,
        "editionId": work.editionId,
        "volumes": volumes,
        "totals": dict(total),
        "releaseGate": {
            "passed": not gate_blockers,
            "blockers": gate_blockers,
            "note": "partial coverage is reported explicitly; it is not treated as zero quality",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=REVIEW_REPORTS_DIR / "v0.2_annotation_quality_report.json")
    args = parser.parse_args()
    report = build_report()
    save_json(args.output, report)
    print(f"Wrote {args.output}")
    print(f"Volumes: {len(report['volumes'])}; passages: {report['totals']['passages']}")
    print(f"Reviewed: {report['totals']['reviewedPassages']}; anchor failures: {report['totals']['anchorFailures']}")
    return 0 if report["releaseGate"]["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
