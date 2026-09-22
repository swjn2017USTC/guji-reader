import pytest

from scripts.import_source_notes import validate_notes


def test_source_note_import_resolves_canonical_anchor() -> None:
    notes = validate_notes([{
        "passageId": "tongjian-jishi-benmo:vol01:p1",
        "exact": "周威烈王",
        "text": "威烈王，名午。",
        "provenance": "胡三省注试点",
    }], "vol01")
    assert notes[0].anchor.start == 0
    assert notes[0].anchor.exact == "周威烈王"


def test_source_note_import_fails_on_unknown_passage() -> None:
    with pytest.raises(ValueError, match="unknown passage"):
        validate_notes([{
            "passageId": "tongjian-jishi-benmo:vol01:missing",
            "exact": "周威烈王",
            "text": "x",
        }], "vol01")
