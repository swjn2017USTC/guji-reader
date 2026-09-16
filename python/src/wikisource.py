import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from bs4 import BeautifulSoup

from python.src.models import Passage, VolumeRef, Work, WorkSource
from python.src.paths import (
    EDITION_ID,
    EXPECTED_VOLUME_COUNT,
    MAIN_PAGE,
    WORK_ID,
    WORK_TITLE,
    WS_API_URL,
    WS_BASE_URL,
)

USER_AGENT = "GujiReaderBot/0.1 (local-dev; contact: none)"


class WikisourceImportError(Exception):
    """Raised when importer encounters structural or completeness problems."""


class WikisourceClient:
    def __init__(self, delay_seconds: float = 2.0, max_retries: int = 3) -> None:
        self.delay_seconds = delay_seconds
        self.max_retries = max_retries
        self._last_request_at: float | None = None
        self._client = httpx.Client(
            headers={"User-Agent": USER_AGENT},
            timeout=30.0,
            follow_redirects=True,
        )

    def _throttled_get(self, url: str, **kwargs: Any) -> httpx.Response:
        if self._last_request_at is not None:
            elapsed = time.monotonic() - self._last_request_at
            if elapsed < self.delay_seconds:
                time.sleep(self.delay_seconds - elapsed)
        response = self._client.get(url, **kwargs)
        self._last_request_at = time.monotonic()
        return response

    def _get_with_retry(self, url: str, **kwargs: Any) -> httpx.Response:
        for attempt in range(self.max_retries + 1):
            response = self._throttled_get(url, **kwargs)
            if response.status_code != 429:
                return response
            backoff = 5 * (2 ** attempt)
            print(f"  Rate limited (429), waiting {backoff}s before retry {attempt + 1}/{self.max_retries}")
            time.sleep(backoff)
        return response

    def fetch_main_page_html(self) -> str:
        url = f"{WS_BASE_URL}/wiki/{MAIN_PAGE}"
        response = self._get_with_retry(url)
        response.raise_for_status()
        return response.text

    def fetch_volume_parse(self, page_title: str) -> dict[str, Any]:
        params = {
            "action": "parse",
            "page": page_title,
            "prop": "text|revid|displaytitle",
            "format": "json",
            "redirects": 1,
        }
        response = self._get_with_retry(WS_API_URL, params=params)
        response.raise_for_status()
        data = response.json()
        if "error" in data:
            raise WikisourceImportError(
                f"MediaWiki API error for {page_title}: {data['error']}"
            )
        return data

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "WikisourceClient":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


def fetch_or_load_raw(
    raw_path: Path,
    page_title: str,
    client: WikisourceClient,
    save_json_fn: Any,
    load_json_fn: Any,
) -> dict[str, Any]:
    """Return cached raw parse data if present and valid; otherwise fetch and save.

    raw/ is immutable: an existing file is never overwritten.
    """
    if raw_path.exists():
        parse_data = load_json_fn(raw_path)
        _validate_parse_data(parse_data, page_title)
        return parse_data

    parse_data = client.fetch_volume_parse(page_title)
    _validate_parse_data(parse_data, page_title)
    save_json_fn(raw_path, parse_data)
    return parse_data


__all__ = [
    "WikisourceClient",
    "WikisourceImportError",
    "discover_volumes",
    "parse_volume_passages",
    "build_work",
    "make_volume_id",
    "now_utc",
    "fetch_or_load_raw",
    "_clean_text",
    "_validate_parse_data",
]


def discover_volumes(html: str) -> list[tuple[int, str, str]]:
    """Return ordered list of (volume_number, title_text, page_title)."""
    import urllib.parse

    soup = BeautifulSoup(html, "html.parser")
    pattern = re.compile(r"/wiki/通鑑紀事本末/(.+)$")
    volumes: list[tuple[int, str, str]] = []
    seen: set[str] = set()

    for a in soup.find_all("a", href=True):
        text = a.get_text(strip=True)
        href = urllib.parse.unquote(a["href"])
        match = pattern.match(href)
        if not match:
            continue
        page_title = match.group(1)
        number = _parse_volume_number(text)
        if number is None or page_title in seen:
            continue
        seen.add(page_title)
        volumes.append((number, text, page_title))

    volumes.sort(key=lambda x: x[0])
    if len(volumes) != EXPECTED_VOLUME_COUNT:
        raise WikisourceImportError(
            f"Expected {EXPECTED_VOLUME_COUNT} volumes, found {len(volumes)}"
        )
    expected_numbers = list(range(1, EXPECTED_VOLUME_COUNT + 1))
    actual_numbers = [v[0] for v in volumes]
    if actual_numbers != expected_numbers:
        raise WikisourceImportError(
            f"Volume numbers not contiguous 1..{EXPECTED_VOLUME_COUNT}: {actual_numbers}"
        )
    return volumes


def _parse_volume_number(text: str) -> int | None:
    mapping = {
        "一": 1,
        "二": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "七": 7,
        "八": 8,
        "九": 9,
        "十": 10,
        "十一": 11,
        "十二": 12,
        "十三": 13,
        "十四": 14,
        "十五": 15,
        "十六": 16,
        "十七": 17,
        "十八": 18,
        "十九": 19,
        "二十": 20,
        "二十一": 21,
        "二十二": 22,
        "二十三": 23,
        "二十四": 24,
        "二十五": 25,
        "二十六": 26,
        "二十七": 27,
        "二十八": 28,
        "二十九": 29,
        "三十": 30,
        "三十一": 31,
        "三十二": 32,
        "三十三": 33,
        "三十四": 34,
        "三十五": 35,
        "三十六": 36,
        "三十七": 37,
        "三十八": 38,
        "三十九": 39,
        "四十": 40,
        "四十一": 41,
        "四十二": 42,
    }
    if not text.startswith("第") or not text.endswith("卷"):
        return None
    inner = text[1:-1]
    return mapping.get(inner)


def _validate_parse_data(parse_data: dict[str, Any], volume_id: str) -> None:
    if not isinstance(parse_data, dict) or "parse" not in parse_data:
        raise WikisourceImportError(f"Invalid parse data for {volume_id}: missing 'parse' key")
    parse_block = parse_data["parse"]
    if "revid" not in parse_block or not parse_block["revid"]:
        raise WikisourceImportError(f"Missing revision id for {volume_id}")
    text_block = parse_block.get("text", {})
    if "*" not in text_block or not isinstance(text_block["*"], str):
        raise WikisourceImportError(f"Missing parse text for {volume_id}")


def parse_volume_passages(
    parse_data: dict[str, Any],
    volume_id: str,
    volume_title: str,
    source_page_url: str,
) -> list[Passage]:
    """Extract canonical passages from MediaWiki parse output."""
    _validate_parse_data(parse_data, volume_id)
    parse_block = parse_data["parse"]
    rev_id = str(parse_block["revid"])
    html = parse_block["text"]["*"]
    if not html.strip():
        raise WikisourceImportError(f"Empty parse HTML for {volume_id}")

    soup = BeautifulSoup(html, "html.parser")
    body = soup.find("div", class_="mw-parser-output")
    if not body:
        raise WikisourceImportError(f"No mw-parser-output for {volume_id}")

    raw_texts: list[str] = []
    for child in body.children:
        if child.name == "p":
            text = child.get_text(separator="", strip=True)
            text = _clean_text(text)
            if text:
                raw_texts.append(text)
        elif child.name == "dl":
            text = child.get_text(separator="", strip=True)
            text = _clean_text(text)
            if text:
                raw_texts.append(text)
        elif child.name == "div" and "mw-heading" in (child.get("class") or []):
            text = child.get_text(separator="", strip=True)
            text = _clean_text(text)
            text = re.sub(r"\[编辑\]", "", text).strip()
            if text:
                raw_texts.append(text)

    if not raw_texts:
        raise WikisourceImportError(f"No canonical text found for {volume_id}")

    passages: list[Passage] = []
    for order, text in enumerate(raw_texts):
        passage_id = _make_passage_id(WORK_ID, volume_id, order)
        passages.append(
            Passage(
                id=passage_id,
                workId=WORK_ID,
                volumeId=volume_id,
                order=order,
                text=text,
                sourcePage=source_page_url,
                revisionId=rev_id,
            )
        )
    return passages


def _clean_text(text: str) -> str:
    # Remove wiki edit markers and zero-width characters.
    text = text.replace("[编辑]", "")
    text = text.replace("\u200b", "")
    text = text.replace("\u200e", "")
    text = text.replace("\ufeff", "")
    # Normalize whitespace but keep Chinese punctuation.
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    text = text.strip()
    return text


def _make_passage_id(work_id: str, volume_id: str, order: int) -> str:
    return f"{work_id}:{volume_id}:p{order}"


def build_work(volumes: list[VolumeRef], retrieved_at: datetime) -> Work:
    return Work(
        id=WORK_ID,
        title=WORK_TITLE,
        editionId=EDITION_ID,
        source=WorkSource(
            provider="wikisource",
            url=f"{WS_BASE_URL}/wiki/{MAIN_PAGE}",
            retrievedAt=retrieved_at,
        ),
        volumes=volumes,
    )


def make_volume_id(volume_number: int) -> str:
    return f"vol{volume_number:02d}"


def now_utc() -> datetime:
    return datetime.now(timezone.utc)
