import json
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

from python.src.models import Passage, Work
from python.src.paths import (
    CANONICAL_DIR,
    EXPECTED_VOLUME_COUNT,
    WORK_ID,
)
from python.src.wikisource import (
    WikisourceImportError,
    _clean_text,
    discover_volumes,
    fetch_or_load_raw,
    parse_volume_passages,
)

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


def test_discover_volumes_finds_42_from_fixture() -> None:
    html = (FIXTURES_DIR / "main_page.html").read_text(encoding="utf-8")
    volumes = discover_volumes(html)
    assert len(volumes) == EXPECTED_VOLUME_COUNT
    numbers = [v[0] for v in volumes]
    assert numbers == list(range(1, EXPECTED_VOLUME_COUNT + 1))


def test_discover_volumes_fails_when_count_mismatch() -> None:
    html = "<html><body><a href=\"/wiki/通鑑紀事本末/第一卷\">第一卷</a></body></html>"
    with pytest.raises(WikisourceImportError):
        discover_volumes(html)


def test_parse_volume_passages_from_fixture() -> None:
    sample = json.loads((FIXTURES_DIR / "vol01_sample.json").read_text(encoding="utf-8"))
    # Reconstruct a minimal parse payload matching the first passage's revision.
    parse_data = {
        "parse": {
            "revid": 2149327,
            "text": {"*": f'<div class="mw-parser-output"><p>{sample[0]["text"]}</p></div>'},
        }
    }
    passages = parse_volume_passages(
        parse_data,
        volume_id="vol01",
        volume_title="第一卷",
        source_page_url="https://zh.wikisource.org/wiki/通鑑紀事本末/第一卷",
    )
    assert len(passages) == 1
    assert passages[0].text == sample[0]["text"]
    assert passages[0].revisionId == "2149327"


def test_parse_volume_passages_rejects_empty_text() -> None:
    parse_data = {
        "parse": {
            "revid": 1,
            "text": {"*": "<div class=\"mw-parser-output\"></div>"},
        }
    }
    with pytest.raises(WikisourceImportError):
        parse_volume_passages(
            parse_data,
            volume_id="vol01",
            volume_title="第一卷",
            source_page_url="https://example.com",
        )


def test_importer_volume_count() -> None:
    work_path = CANONICAL_DIR / WORK_ID / "work.json"
    assert work_path.exists(), "Run scripts/sync_wikisource.py first"
    work = Work(**json.loads(work_path.read_text(encoding="utf-8")))
    assert len(work.volumes) == EXPECTED_VOLUME_COUNT


def test_no_empty_passage() -> None:
    work_path = CANONICAL_DIR / WORK_ID / "work.json"
    assert work_path.exists(), "Run scripts/sync_wikisource.py first"
    work = Work(**json.loads(work_path.read_text(encoding="utf-8")))

    for volume in work.volumes:
        canonical_path = CANONICAL_DIR / WORK_ID / f"{volume.id}.json"
        passages = [Passage(**p) for p in json.loads(canonical_path.read_text(encoding="utf-8"))]
        assert len(passages) >= 1, f"{volume.id} has no passages"
        for passage in passages:
            assert passage.text.strip(), f"Empty passage {passage.id}"


def test_metadata_saved() -> None:
    work_path = CANONICAL_DIR / WORK_ID / "work.json"
    assert work_path.exists(), "Run scripts/sync_wikisource.py first"
    work = Work(**json.loads(work_path.read_text(encoding="utf-8")))

    assert work.source.provider == "wikisource"
    assert work.source.url is not None
    assert work.source.retrievedAt is not None

    for volume in work.volumes:
        canonical_path = CANONICAL_DIR / WORK_ID / f"{volume.id}.json"
        passages = [Passage(**p) for p in json.loads(canonical_path.read_text(encoding="utf-8"))]
        for passage in passages:
            assert passage.sourcePage is not None
            assert passage.revisionId is not None


def test_deterministic_ids() -> None:
    work_path = CANONICAL_DIR / WORK_ID / "work.json"
    assert work_path.exists(), "Run scripts/sync_wikisource.py first"
    work = Work(**json.loads(work_path.read_text(encoding="utf-8")))

    for volume in work.volumes:
        canonical_path = CANONICAL_DIR / WORK_ID / f"{volume.id}.json"
        passages = [Passage(**p) for p in json.loads(canonical_path.read_text(encoding="utf-8"))]
        for i, passage in enumerate(passages):
            expected_id = f"{WORK_ID}:{volume.id}:p{i}"
            assert passage.id == expected_id
            assert passage.order == i


def test_canonical_not_modified() -> None:
    """Importer must extract canonical text from raw HTML verbatim except for declared cleaning."""
    raw = json.loads((FIXTURES_DIR / "vol01_raw_sample.json").read_text(encoding="utf-8"))
    expected = json.loads((FIXTURES_DIR / "vol01_canonical_sample.json").read_text(encoding="utf-8"))

    passages = parse_volume_passages(
        raw,
        volume_id="vol01",
        volume_title="第一卷",
        source_page_url="https://zh.wikisource.org/wiki/通鑑紀事本末/第一卷",
    )

    assert len(passages) == len(expected)
    for parsed, expect in zip(passages, expected):
        assert parsed.text == expect["text"]
        assert "[编辑]" not in parsed.text
        assert parsed.revisionId == str(raw["parse"]["revid"])
        assert str(parsed.sourcePage) == expect["sourcePage"]
        assert parsed.id == expect["id"]
        assert parsed.order == expect["order"]

    # The only transformation allowed on the raw text is _clean_text:
    # removal of wiki edit markers and zero-width characters / whitespace normalization.
    raw_soup_text = "\n".join(
        tag.get_text(separator="", strip=True)
        for tag in (
            BeautifulSoup(raw["parse"]["text"]["*"], "html.parser")
            .find("div", class_="mw-parser-output")
            .find_all(["div", "p", "dl"])
        )
    )
    assert "[编辑]" in raw_soup_text  # present in raw extracted text, removed from canonical
    assert "[编辑]" not in "\n".join(p.text for p in passages)
    assert all(p.text.strip() for p in passages)



def test_fetch_or_load_raw_uses_cache_when_present(tmp_path: Path) -> None:
    raw_path = tmp_path / "vol01.json"
    expected = {"parse": {"revid": 123, "text": {"*": "<div class=\"mw-parser-output\"><p>正文</p></div>"}}}
    with raw_path.open("w", encoding="utf-8") as f:
        json.dump(expected, f)

    calls = {"fetched": False}

    class FakeClient:
        def fetch_volume_parse(self, page_title: str):
            calls["fetched"] = True
            return expected

    result = fetch_or_load_raw(
        raw_path=raw_path,
        page_title="通鑑紀事本末/第一卷",
        client=FakeClient(),
        save_json_fn=lambda _path, _data: None,
        load_json_fn=lambda path: json.loads(path.read_text(encoding="utf-8")),
    )
    assert result == expected
    assert calls["fetched"] is False


def test_fetch_or_load_raw_fetches_and_saves_when_missing(tmp_path: Path) -> None:
    raw_path = tmp_path / "vol01.json"
    expected = {"parse": {"revid": 456, "text": {"*": "<div class=\"mw-parser-output\"><p>正文</p></div>"}}}

    class FakeClient:
        def fetch_volume_parse(self, page_title: str):
            return expected

    saved: list[tuple[Path, object]] = []

    def fake_save(path: Path, data: object) -> None:
        saved.append((path, data))

    result = fetch_or_load_raw(
        raw_path=raw_path,
        page_title="通鑑紀事本末/第一卷",
        client=FakeClient(),
        save_json_fn=fake_save,
        load_json_fn=lambda path: json.loads(path.read_text(encoding="utf-8")),
    )
    assert result == expected
    assert len(saved) == 1
    assert saved[0][0] == raw_path


def test_fetch_or_load_raw_rejects_corrupt_cached_raw(tmp_path: Path) -> None:
    raw_path = tmp_path / "vol01.json"
    with raw_path.open("w", encoding="utf-8") as f:
        json.dump({"parse": {"text": {"*": ""}}}, f)

    class FakeClient:
        def fetch_volume_parse(self, page_title: str):
            raise RuntimeError("should not be called")

    with pytest.raises(WikisourceImportError):
        fetch_or_load_raw(
            raw_path=raw_path,
            page_title="通鑑紀事本末/第一卷",
            client=FakeClient(),
            save_json_fn=lambda _path, _data: None,
            load_json_fn=lambda path: json.loads(path.read_text(encoding="utf-8")),
        )



def test_clean_text_removes_edit_markers_and_zero_width_chars() -> None:
    assert _clean_text("正文[编辑]正文") == "正文正文"
    assert _clean_text("正文\u200b正文") == "正文正文"
    assert _clean_text("正文\u200e正文") == "正文正文"
    assert _clean_text("正文\ufeff正文") == "正文正文"


def test_clean_text_normalizes_whitespace_keeps_chinese_punctuation() -> None:
    assert _clean_text("  正文   正文  ") == "正文 正文"
    assert _clean_text("正文\n\n\n正文") == "正文\n正文"
    assert _clean_text("子曰：「學而時習之，不亦說乎？」") == "子曰：「學而時習之，不亦說乎？」"


def test_clean_text_returns_empty_for_garbage() -> None:
    assert _clean_text("  \u200b  [编辑]  ") == ""
