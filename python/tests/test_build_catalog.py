import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from python.src.models import Work
from python.src.paths import WORK_ID
from scripts.build_catalog import run_build


def _write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def test_build_catalog_success(tmp_path: Path) -> None:
    canonical_root = tmp_path / "canonical"
    public_root = tmp_path / "public"

    work = {
        "id": WORK_ID,
        "title": "通鑑紀事本末",
        "editionId": "test-edition",
        "source": {
            "provider": "wikisource",
            "url": "https://zh.wikisource.org/wiki/通鑑紀事本末",
            "retrievedAt": "2024-01-01T00:00:00Z",
        },
        "volumes": [
            {
                "id": "vol01",
                "workId": WORK_ID,
                "title": "第一卷",
                "order": 0,
                "sourcePage": "https://zh.wikisource.org/wiki/通鑑紀事本末/第一卷",
                "passageCount": 2,
            }
        ],
    }
    _write_json(canonical_root / WORK_ID / "work.json", work)

    passages = [
        {
            "id": f"{WORK_ID}:vol01:p0",
            "workId": WORK_ID,
            "volumeId": "vol01",
            "order": 0,
            "text": "周威烈王二十三年，初命晉大夫魏斯、趙籍、韓虔爲諸侯。",
            "sourcePage": "https://zh.wikisource.org/wiki/通鑑紀事本末/第一卷",
            "revisionId": "12345",
        },
        {
            "id": f"{WORK_ID}:vol01:p1",
            "workId": WORK_ID,
            "volumeId": "vol01",
            "order": 1,
            "text": "初，智宣子將以瑤為後。",
            "sourcePage": "https://zh.wikisource.org/wiki/通鑑紀事本末/第一卷",
            "revisionId": "12345",
        },
    ]
    _write_json(canonical_root / WORK_ID / "vol01.json", passages)

    result = run_build(canonical_root=canonical_root, public_root=public_root)
    assert isinstance(result, Work)
    assert result.id == WORK_ID
    assert len(result.volumes) == 1
    assert result.volumes[0].passageCount == 2

    catalog_path = public_root / "catalog.json"
    assert catalog_path.exists()
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    assert catalog["id"] == WORK_ID
    assert len(catalog["volumes"]) == 1

    volume_path = public_root / "works" / WORK_ID / "vol01.json"
    assert volume_path.exists()
    published = json.loads(volume_path.read_text(encoding="utf-8"))
    assert len(published) == 2
    assert published[0]["text"] == passages[0]["text"]


def test_build_catalog_missing_canonical_file(tmp_path: Path) -> None:
    canonical_root = tmp_path / "canonical"
    public_root = tmp_path / "public"

    work = {
        "id": WORK_ID,
        "title": "通鑑紀事本末",
        "editionId": "test-edition",
        "source": {
            "provider": "wikisource",
            "url": "https://example.com",
            "retrievedAt": "2024-01-01T00:00:00Z",
        },
        "volumes": [
            {
                "id": "vol01",
                "workId": WORK_ID,
                "title": "第一卷",
                "order": 0,
                "sourcePage": "https://example.com/vol01",
                "passageCount": 1,
            }
        ],
    }
    _write_json(canonical_root / WORK_ID / "work.json", work)

    with pytest.raises(FileNotFoundError):
        run_build(canonical_root=canonical_root, public_root=public_root)


def test_build_catalog_invalid_passage_rejected(tmp_path: Path) -> None:
    canonical_root = tmp_path / "canonical"
    public_root = tmp_path / "public"

    work = {
        "id": WORK_ID,
        "title": "通鑑紀事本末",
        "editionId": "test-edition",
        "source": {
            "provider": "wikisource",
            "url": "https://example.com",
            "retrievedAt": "2024-01-01T00:00:00Z",
        },
        "volumes": [
            {
                "id": "vol01",
                "workId": WORK_ID,
                "title": "第一卷",
                "order": 0,
                "sourcePage": "https://example.com/vol01",
                "passageCount": 1,
            }
        ],
    }
    _write_json(canonical_root / WORK_ID / "work.json", work)

    invalid_passages = [
        {
            "id": f"{WORK_ID}:vol01:p0",
            "workId": WORK_ID,
            "volumeId": "vol01",
            "order": 0,
            "text": "",  # empty text violates Passage schema
            "sourcePage": "https://example.com/vol01",
        }
    ]
    _write_json(canonical_root / WORK_ID / "vol01.json", invalid_passages)

    with pytest.raises(ValidationError):
        run_build(canonical_root=canonical_root, public_root=public_root)


def test_build_catalog_passage_count_mismatch(tmp_path: Path) -> None:
    canonical_root = tmp_path / "canonical"
    public_root = tmp_path / "public"

    work = {
        "id": WORK_ID,
        "title": "通鑑紀事本末",
        "editionId": "test-edition",
        "source": {
            "provider": "wikisource",
            "url": "https://example.com",
            "retrievedAt": "2024-01-01T00:00:00Z",
        },
        "volumes": [
            {
                "id": "vol01",
                "workId": WORK_ID,
                "title": "第一卷",
                "order": 0,
                "sourcePage": "https://example.com/vol01",
                "passageCount": 99,  # mismatched
            }
        ],
    }
    _write_json(canonical_root / WORK_ID / "work.json", work)

    passages = [
        {
            "id": f"{WORK_ID}:vol01:p0",
            "workId": WORK_ID,
            "volumeId": "vol01",
            "order": 0,
            "text": "正文。",
            "sourcePage": "https://example.com/vol01",
        }
    ]
    _write_json(canonical_root / WORK_ID / "vol01.json", passages)

    with pytest.raises(ValueError, match="passageCount mismatch"):
        run_build(canonical_root=canonical_root, public_root=public_root)



def test_build_catalog_missing_work_json(tmp_path: Path) -> None:
    canonical_root = tmp_path / "canonical"
    public_root = tmp_path / "public"
    with pytest.raises(FileNotFoundError):
        run_build(canonical_root=canonical_root, public_root=public_root)


def test_build_catalog_empty_passages_list(tmp_path: Path) -> None:
    canonical_root = tmp_path / "canonical"
    public_root = tmp_path / "public"

    work = {
        "id": WORK_ID,
        "title": "通鑑紀事本末",
        "editionId": "test-edition",
        "source": {
            "provider": "wikisource",
            "url": "https://example.com",
            "retrievedAt": "2024-01-01T00:00:00Z",
        },
        "volumes": [
            {
                "id": "vol01",
                "workId": WORK_ID,
                "title": "第一卷",
                "order": 0,
                "sourcePage": "https://example.com/vol01",
                "passageCount": 0,
            }
        ],
    }
    _write_json(canonical_root / WORK_ID / "work.json", work)
    _write_json(canonical_root / WORK_ID / "vol01.json", [])

    with pytest.raises(ValueError, match="No passages"):
        run_build(canonical_root=canonical_root, public_root=public_root)


def test_build_preserves_sibling_directories(tmp_path: Path) -> None:
    """Rebuilding must not destroy hand-curated siblings under public/data.

    public/data also holds committed, non-generated content — annotations/ (the
    gate-passed AI annotations) and source_notes/ (the verified 胡三省注 fixture).
    A rebuild is a required release step, so wiping the parent directory would
    silently delete them.
    """
    canonical_root = tmp_path / "canonical"
    public_root = tmp_path / "public"

    work = {
        "id": WORK_ID,
        "title": "通鑑紀事本末",
        "editionId": "test-edition",
        "source": {
            "provider": "wikisource",
            "url": "https://example.com",
            "retrievedAt": "2024-01-01T00:00:00Z",
        },
        "volumes": [
            {
                "id": "vol01",
                "workId": WORK_ID,
                "title": "第一卷",
                "order": 0,
                "sourcePage": "https://example.com/vol01",
                "passageCount": 1,
            }
        ],
    }
    _write_json(canonical_root / WORK_ID / "work.json", work)
    _write_json(
        canonical_root / WORK_ID / "vol01.json",
        [
            {
                "id": f"{WORK_ID}:vol01:p0",
                "workId": WORK_ID,
                "volumeId": "vol01",
                "order": 0,
                "text": "正文。",
                "sourcePage": "https://example.com/vol01",
            }
        ],
    )

    curated = public_root / "annotations" / WORK_ID
    curated.mkdir(parents=True)
    _write_json(curated / "vol01.json", {"workId": WORK_ID, "volumeId": "vol01"})
    fixture = public_root / "source_notes" / WORK_ID
    fixture.mkdir(parents=True)
    _write_json(fixture / "vol01.json", [{"id": "hu:1"}])
    # A stale generated file that must NOT survive the rebuild.
    _write_json(public_root / "works" / WORK_ID / "vol99.json", [{"id": "stale"}])

    run_build(canonical_root=canonical_root, public_root=public_root)

    assert (curated / "vol01.json").exists(), "annotations/ was destroyed by the build"
    assert (fixture / "vol01.json").exists(), "source_notes/ was destroyed by the build"
    assert not (public_root / "works" / WORK_ID / "vol99.json").exists(), (
        "works/ must still be replaced wholesale"
    )
    assert (public_root / "works" / WORK_ID / "vol01.json").exists()
    assert (public_root / "catalog.json").exists()
