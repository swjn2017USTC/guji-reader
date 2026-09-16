from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]

RAW_DIR = PROJECT_ROOT / "data" / "raw"
CANONICAL_DIR = PROJECT_ROOT / "data" / "canonical"
AI_ANNOTATIONS_DIR = PROJECT_ROOT / "data" / "ai_annotations"
REVIEW_REPORTS_DIR = PROJECT_ROOT / "data" / "review_reports"
PUBLIC_DATA_DIR = PROJECT_ROOT / "public" / "data"
FIXTURES_DIR = PROJECT_ROOT / "python" / "tests" / "fixtures"

WORK_ID = "tongjian-jishi-benmo"
EDITION_ID = "zh.wikisource.org"
WORK_TITLE = "通鑑紀事本末"
MAIN_PAGE = "通鑑紀事本末"
EXPECTED_VOLUME_COUNT = 42
WS_BASE_URL = "https://zh.wikisource.org"
WS_API_URL = "https://zh.wikisource.org/w/api.php"


def raw_volume_path(volume_id: str) -> Path:
    return RAW_DIR / WORK_ID / f"{volume_id}.json"


def canonical_volume_path(volume_id: str) -> Path:
    return CANONICAL_DIR / WORK_ID / f"{volume_id}.json"


def public_work_dir() -> Path:
    return PUBLIC_DATA_DIR / "works" / WORK_ID


def public_volume_path(volume_id: str) -> Path:
    return public_work_dir() / f"{volume_id}.json"


def catalog_path() -> Path:
    return PUBLIC_DATA_DIR / "catalog.json"
