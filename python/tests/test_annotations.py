"""Annotation pipeline tests: schemas, anchors, publish gate, reviewer isolation."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from python.src.annotation_pipeline import (
    AnchorError,
    PublishGateError,
    apply_publish_gate,
    build_anchor,
    build_generator_messages,
    build_quality_report,
    build_reviewer_messages,
    build_revised_candidate,
    candidate_to_raw,
    locate_span,
    materialize_candidate,
    parse_review,
    summarize_reviews,
    verify_anchor,
)
from python.src.annotation_store import merge_published_entries
from python.src.annotations import (
    AnnotationCandidate,
    AnnotationReview,
    PublishedVolumeAnnotations,
    RawAnnotationPayload,
)
from python.src.models import Passage

WORK_ID = "test-work"
VOLUME_ID = "vol01"
PASSAGE_ID = f"{WORK_ID}:{VOLUME_ID}:p1"

# Contains a non-BMP character (U+23C30) so UTF-16 vs code-point offset
# confusion cannot pass unnoticed.
PASSAGE_TEXT = "周威烈王二十三年，初命晉大夫魏斯、趙籍、韓虔爲諸侯。𣰰"


def make_passage(text: str = PASSAGE_TEXT) -> Passage:
    return Passage(
        id=PASSAGE_ID,
        workId=WORK_ID,
        volumeId=VOLUME_ID,
        order=1,
        text=text,
        sourcePage="https://example.com/vol01",
        revisionId="1",
    )


def make_raw(**overrides) -> dict:
    payload = {
        "properNames": [
            {"exact": "魏斯", "prefix": "初命晉大夫", "suffix": "、趙籍", "type": "PERSON"}
        ],
        "annotations": [
            {
                "exact": "魏斯",
                "prefix": "初命晉大夫",
                "suffix": "、趙籍",
                "layer": 1,
                "category": "PERSON",
                "text": "魏斯，即魏文侯。",
                "confidence": 0.9,
            }
        ],
    }
    payload.update(overrides)
    return payload


def make_review(overall: str = "accept", **overrides) -> AnnotationReview:
    payload = {
        "overall": overall,
        "scores": {
            "proper_name_precision": 4,
            "proper_name_recall": 4,
            "entity_resolution": 4,
            "place_accuracy": 4,
            "term_necessity": 4,
            "office_accuracy": 4,
            "first_appearance_accuracy": 4,
            "verbosity_control": 4,
            "unsupported_claim_risk": 4,
        },
        "issues": [],
    }
    payload.update(overrides)
    return parse_review(PASSAGE_ID, payload)


# --------------------------------------------------------------------------
# schema validation
# --------------------------------------------------------------------------


def test_schema_invalid_fails() -> None:
    """Generator output that violates the schema must be rejected outright."""
    with pytest.raises(ValidationError):
        RawAnnotationPayload(**make_raw(annotations=[{"exact": "魏斯"}]))

    with pytest.raises(ValidationError):
        # STATE is a proper-name type, never an annotation category.
        RawAnnotationPayload(
            **make_raw(
                annotations=[
                    {
                        "exact": "晉",
                        "layer": 1,
                        "category": "STATE",
                        "text": "晉國。",
                        "confidence": 0.9,
                    }
                ]
            )
        )

    with pytest.raises(ValidationError):
        # layer/category mismatch
        RawAnnotationPayload(
            **make_raw(
                annotations=[
                    {
                        "exact": "魏斯",
                        "layer": 2,
                        "category": "PERSON",
                        "text": "魏文侯。",
                        "confidence": 0.9,
                    }
                ]
            )
        )


def test_review_schema_invalid_fails() -> None:
    with pytest.raises(ValidationError):
        parse_review(PASSAGE_ID, {"overall": "maybe", "scores": {}, "issues": []})

    with pytest.raises(ValidationError):
        # scores out of the 1-5 range
        parse_review(
            PASSAGE_ID,
            {
                "overall": "accept",
                "scores": {
                    "proper_name_precision": 9,
                    "proper_name_recall": 4,
                    "entity_resolution": 4,
                    "place_accuracy": 4,
                    "term_necessity": 4,
                    "office_accuracy": 4,
                    "first_appearance_accuracy": 4,
                    "verbosity_control": 4,
                    "unsupported_claim_risk": 4,
                },
                "issues": [],
            },
        )


def test_revise_without_revision_fails() -> None:
    with pytest.raises((ValidationError, ValueError)):
        make_review("revise")


# --------------------------------------------------------------------------
# anchors
# --------------------------------------------------------------------------


def test_anchor_matches_text() -> None:
    """An anchor whose exact does not match the canonical slice must fail."""
    passage = make_passage()
    anchor = build_anchor(passage, "魏斯")
    verify_anchor(anchor, passage.text)

    broken = anchor.model_copy(update={"exact": "趙籍"})
    with pytest.raises(AnchorError):
        verify_anchor(broken, passage.text)

    out_of_range = anchor.model_copy(update={"end": len(passage.text) + 5})
    with pytest.raises(AnchorError):
        verify_anchor(out_of_range, passage.text)

    inverted = anchor.model_copy(update={"start": anchor.end, "end": anchor.start})
    with pytest.raises(AnchorError):
        verify_anchor(inverted, passage.text)


def test_anchor_exact_not_in_passage_fails() -> None:
    with pytest.raises(AnchorError):
        build_anchor(make_passage(), "不存在於原文")


def test_anchor_context_is_derived_not_trusted() -> None:
    """Model prefix/suffix are hints; stored context is re-derived from the text."""
    anchor = build_anchor(make_passage(), "魏斯", "初命晉大夫", "、趙籍")
    assert anchor.prefix.endswith("初命晉大夫")
    assert anchor.suffix.startswith("、趙籍")
    # Stored context is a fixed-width window, not whatever the model typed.
    assert anchor.prefix == "三年，初命晉大夫"

    # A model that drops intervening punctuation still resolves correctly.
    sloppy_prefix = build_anchor(make_passage(), "趙籍", "初命晉大夫魏斯", "韓虔")
    assert sloppy_prefix.exact == "趙籍"
    assert sloppy_prefix.prefix.endswith("、")


def test_locate_span_uses_code_point_offsets() -> None:
    """Offsets are code points (Python native), not UTF-16 units."""
    passage = make_passage()
    start, end = locate_span(passage.text, "爲諸侯")
    assert passage.text[start:end] == "爲諸侯"

    # The non-BMP char is one code point in Python.
    assert len(passage.text) == 27
    assert locate_span(passage.text, "𣰰") == (26, 27)


def test_locate_span_prefers_prefix_when_sides_disagree() -> None:
    """Model prefix may match one occurrence while suffix matches another."""
    text = "是故天子統三公，三公率諸侯。"
    # prefix identifies the first 三公, suffix identifies the second.
    start, end = locate_span(text, "三公", "是故天子統", "率諸侯")
    assert (start, end) == (5, 7)
    assert text[start:end] == "三公"


def test_materialize_tolerates_sloppy_context() -> None:
    passage = make_passage(
        "是故天子統三公，三公率諸侯。"
    )
    candidate = materialize_candidate(
        passage,
        {
            "properNames": [],
            "annotations": [
                {
                    "exact": "三公",
                    "prefix": "是故天子統",
                    "suffix": "率諸侯",
                    "layer": 1,
                    "category": "TERM",
                    "text": "三公，最高官職。",
                    "confidence": 0.8,
                }
            ],
        },
    )
    assert candidate.annotations[0].anchor.start == 5


def test_locate_span_ambiguous_fails_loudly() -> None:
    text = "晉侯晉侯"
    assert locate_span(text, "晉侯", "", "晉侯") == (0, 2)
    with pytest.raises(AnchorError):
        locate_span("晉侯晉侯", "晉侯")


def test_materialize_rejects_unresolvable_span() -> None:
    with pytest.raises(AnchorError):
        materialize_candidate(
            make_passage(),
            make_raw(properNames=[{"exact": "不存在", "type": "PERSON"}]),
        )


# --------------------------------------------------------------------------
# reviewer independence
# --------------------------------------------------------------------------


def test_generator_reviewer_independence() -> None:
    """The reviewer must not receive generator instructions or reasoning."""
    passage = make_passage()
    candidate = materialize_candidate(passage, make_raw())

    generator_messages = build_generator_messages(passage)
    reviewer_messages = build_reviewer_messages(passage.text, candidate)

    reviewer_blob = "\n".join(message["content"] for message in reviewer_messages)

    # No generator system prompt, and no reasoning channel at all.
    assert generator_messages[0]["content"] not in reviewer_blob
    assert "你是《資治通鑑》古文的專業註釋助手" not in reviewer_blob
    assert "reasoning" not in reviewer_blob
    assert "thinking" not in reviewer_blob
    assert "chain" not in reviewer_blob.lower()

    # The reviewer gets exactly the canonical text, the spans and the rubric.
    assert passage.text in reviewer_blob
    assert "評分標準" in reviewer_blob
    assert "魏斯" in reviewer_blob
    # Spans are presented without offsets, so the reviewer cannot echo them.
    assert '"start"' not in reviewer_blob
    assert '"end"' not in reviewer_blob


def test_candidate_to_raw_strips_offsets() -> None:
    candidate = materialize_candidate(make_passage(), make_raw())
    raw = candidate_to_raw(candidate)
    assert set(raw.keys()) == {"properNames", "annotations"}
    assert set(raw["properNames"][0].keys()) == {"exact", "prefix", "suffix", "type"}
    assert "start" not in json.dumps(raw)


# --------------------------------------------------------------------------
# publish gate
# --------------------------------------------------------------------------


def test_publish_gate_accept_uses_generator() -> None:
    passage = make_passage()
    candidate = materialize_candidate(passage, make_raw())
    result = apply_publish_gate(
        passage, candidate, make_review("accept"), work_id=WORK_ID, volume_id=VOLUME_ID
    )
    assert result is not None
    source, annotations, proper_names = result
    assert source == "generator"
    assert [item.text for item in annotations] == ["魏斯，即魏文侯。"]
    assert annotations[0].source == "generator"
    assert len(proper_names) == 1
    assert annotations[0].id.startswith("ai:")
    assert proper_names[0].id.startswith("pn:")


def test_publish_gate_revise_uses_reviewer_revision() -> None:
    passage = make_passage()
    candidate = materialize_candidate(passage, make_raw())
    review = make_review(
        "revise",
        revisedAnnotations=make_raw(
            annotations=[
                {
                    "exact": "魏斯",
                    "layer": 1,
                    "category": "PERSON",
                    "text": "修訂後的註文，即魏文侯。",
                    "confidence": 0.8,
                }
            ]
        ),
    )
    result = apply_publish_gate(
        passage, candidate, review, work_id=WORK_ID, volume_id=VOLUME_ID
    )
    assert result is not None
    source, annotations, _ = result
    assert source == "reviewer"
    assert [item.text for item in annotations] == ["修訂後的註文，即魏文侯。"]
    assert annotations[0].source == "reviewer"


def test_publish_gate_reject_publishes_nothing() -> None:
    passage = make_passage()
    candidate = materialize_candidate(passage, make_raw())
    result = apply_publish_gate(
        passage, candidate, make_review("reject"), work_id=WORK_ID, volume_id=VOLUME_ID
    )
    assert result is None


def test_rejected_annotation_not_published() -> None:
    """End to end: a rejected passage leaves nothing in the published volume."""
    passage = make_passage()
    candidate = materialize_candidate(passage, make_raw())
    published = PublishedVolumeAnnotations(workId=WORK_ID, volumeId=VOLUME_ID)

    records = apply_publish_gate(
        passage, candidate, make_review("reject"), work_id=WORK_ID, volume_id=VOLUME_ID
    )
    merged = merge_published_entries(published, passage.id, records)

    assert records is None
    assert merged.annotations == []
    assert merged.properNames == []


def test_gate_rejects_mismatched_passage_id() -> None:
    passage = make_passage()
    candidate = materialize_candidate(passage, make_raw())
    other_review = parse_review("other-work:vol01:p9", make_review("accept").model_dump())
    with pytest.raises(PublishGateError):
        apply_publish_gate(
            passage,
            candidate,
            other_review,
            work_id=WORK_ID,
            volume_id=VOLUME_ID,
        )


def test_revised_candidate_with_bad_anchor_fails() -> None:
    passage = make_passage()
    review = make_review(
        "revise",
        revisedAnnotations={
            "properNames": [],
            "annotations": [
                {
                    "exact": "這是原文沒有的字",
                    "layer": 1,
                    "category": "TERM",
                    "text": "不存在的詞。",
                    "confidence": 0.5,
                }
            ],
        },
    )
    with pytest.raises(AnchorError):
        build_revised_candidate(passage, review)


def test_published_ids_are_deterministic() -> None:
    passage = make_passage()
    candidate = materialize_candidate(passage, make_raw())
    first = apply_publish_gate(
        passage, candidate, make_review("accept"), work_id=WORK_ID, volume_id=VOLUME_ID
    )
    second = apply_publish_gate(
        passage, candidate, make_review("accept"), work_id=WORK_ID, volume_id=VOLUME_ID
    )
    assert first is not None and second is not None
    assert [item.id for item in first[1]] == [item.id for item in second[1]]
    assert [item.id for item in first[2]] == [item.id for item in second[2]]


# --------------------------------------------------------------------------
# merge + reporting
# --------------------------------------------------------------------------


def test_merge_keeps_other_passages() -> None:
    """A partial run must not drop annotations published earlier."""
    passage = make_passage()
    candidate = materialize_candidate(passage, make_raw())
    records = apply_publish_gate(
        passage, candidate, make_review("accept"), work_id=WORK_ID, volume_id=VOLUME_ID
    )

    existing = PublishedVolumeAnnotations(workId=WORK_ID, volumeId=VOLUME_ID)
    existing = merge_published_entries(existing, passage.id, records)
    assert len(existing.annotations) == 1

    other_id = f"{WORK_ID}:{VOLUME_ID}:p99"
    merged = merge_published_entries(existing, other_id, None)
    assert len(merged.annotations) == 1, "unrelated passage must survive a reject"


def test_quality_report_aggregates_scores() -> None:
    reviews = [make_review("accept"), make_review("reject")]
    summary = summarize_reviews(reviews)
    assert summary["reviewedPassages"] == 2
    assert summary["verdicts"] == {"accept": 1, "revise": 0, "reject": 1}
    assert summary["averageScores"]["proper_name_precision"] == 4
    assert summary["overallAverageScore"] == 4.0

    report = build_quality_report(
        reviews,
        model="deepseek-flash",
        generated_at="2026-01-01T00:00:00Z",
        work_id=WORK_ID,
        published_volumes=[VOLUME_ID],
        published_annotation_count=3,
        published_proper_name_count=2,
    )
    assert report["verdicts"]["reject"] == 1
    assert report["perCategoryScores"]["place_accuracy"]["average"] == 4
    assert report["published"]["annotations"] == 3
    assert report["rejectedPassages"] == [PASSAGE_ID]


def test_quality_report_is_json_serializable() -> None:
    report = build_quality_report(
        [make_review("accept")],
        model="deepseek-flash",
        generated_at="2026-01-01T00:00:00Z",
        work_id=WORK_ID,
    )
    assert isinstance(json.dumps(report, ensure_ascii=False), str)


# --------------------------------------------------------------------------
# fixture on disk
# --------------------------------------------------------------------------


def test_published_fixture_anchors_match_canonical() -> None:
    """Whatever is published must still line up with the canonical corpus."""
    from python.src.annotation_store import (
        load_published_volume,
        load_volume_passages,
    )

    published = load_published_volume(VOLUME_ID)
    if not published.annotations and not published.properNames:
        pytest.skip("no published annotations yet; run annotate.py + review_annotations.py")

    texts = {p.id: p.text for p in load_volume_passages(VOLUME_ID)}
    for record in [*published.annotations, *published.properNames]:
        text = texts.get(record.passageId)
        assert text is not None, f"unknown passage {record.passageId}"
        assert text[record.anchor.start : record.anchor.end] == record.anchor.exact


def test_published_fixture_has_no_generator_reasoning() -> None:
    from python.src.annotation_store import load_published_volume

    path = Path("public/data/annotations/tongjian-jishi-benmo/vol01.json")
    if not path.exists():
        pytest.skip("no published annotations yet")
    blob = path.read_text(encoding="utf-8")
    assert "reasoning" not in blob
    assert "thinking" not in blob
    published = load_published_volume(VOLUME_ID)
    for record in published.annotations:
        assert record.source in {"generator", "reviewer"}
