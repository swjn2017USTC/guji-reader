"""Source-note fixture must stay anchored to canonical text.

The fixture is a hand-curated sample used to validate the source-note renderer
interface. Its anchors are the only contract the renderer relies on, so any
offset drift against the canonical corpus must fail loudly here rather than
silently mis-highlighting text in the UI.
"""

import json
from pathlib import Path

import pytest

from python.src.models import Passage, SourceNote
from python.src.paths import CANONICAL_DIR, EXPECTED_VOLUME_COUNT, WORK_ID

SOURCE_NOTES_DIR = Path(__file__).resolve().parents[2] / "public" / "data" / "source_notes"
VOLUME_ID = "vol01"


@pytest.fixture(scope="module")
def canonical_texts() -> dict[str, str]:
    path = CANONICAL_DIR / WORK_ID / f"{VOLUME_ID}.json"
    assert path.exists(), "Run scripts/sync_wikisource.py first"
    passages = [Passage(**p) for p in json.loads(path.read_text(encoding="utf-8"))]
    return {p.id: p.text for p in passages}


@pytest.fixture(scope="module")
def source_notes() -> list[SourceNote]:
    path = SOURCE_NOTES_DIR / WORK_ID / f"{VOLUME_ID}.json"
    assert path.exists(), f"Missing curated fixture {path}"
    return [SourceNote(**n) for n in json.loads(path.read_text(encoding="utf-8"))]


def test_source_note_fixture_is_non_empty(source_notes: list[SourceNote]) -> None:
    assert len(source_notes) >= 1


def test_source_note_anchors_match_canonical_text(
    source_notes: list[SourceNote], canonical_texts: dict[str, str]
) -> None:
    for note in source_notes:
        text = canonical_texts.get(note.anchor.passageId)
        assert text is not None, f"Unknown passage {note.anchor.passageId}"

        sliced = text[note.anchor.start : note.anchor.end]
        assert sliced == note.anchor.exact, (
            f"{note.id}: anchor.exact={note.anchor.exact!r} "
            f"but canonical[{note.anchor.start}:{note.anchor.end}]={sliced!r}"
        )
        assert text[: note.anchor.start].endswith(note.anchor.prefix), (
            f"{note.id}: prefix does not match text before anchor"
        )
        assert text[note.anchor.end :].startswith(note.anchor.suffix), (
            f"{note.id}: suffix does not match text after anchor"
        )


def test_source_note_belongs_to_its_volume(
    source_notes: list[SourceNote], canonical_texts: dict[str, str]
) -> None:
    for note in source_notes:
        assert note.workId == WORK_ID
        assert note.volumeId == VOLUME_ID
        assert note.passageId in canonical_texts
        assert note.anchor.passageId == note.passageId
        assert note.provenance.strip(), f"{note.id}: missing provenance"


def test_source_notes_are_not_ai_annotations(source_notes: list[SourceNote]) -> None:
    """Curated古注 must carry provenance and never masquerade as AI output."""
    for note in source_notes:
        assert not note.id.startswith("ai:"), "source note id looks like an AI annotation"
        assert note.anchor.exact.strip()
        assert note.text.strip()


def test_expected_volume_count_matches_corpus() -> None:
    work_path = CANONICAL_DIR / WORK_ID / "work.json"
    assert work_path.exists(), "Run scripts/sync_wikisource.py first"
    work = json.loads(work_path.read_text(encoding="utf-8"))
    assert len(work["volumes"]) == EXPECTED_VOLUME_COUNT
