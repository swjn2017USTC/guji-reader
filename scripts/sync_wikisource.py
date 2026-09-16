#!/usr/bin/env python3
"""Sync 《通鑑紀事本末》 from Chinese Wikisource into raw/canonical data."""

import argparse
import json
import sys
from pathlib import Path

# Allow imports from project root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from python.src.models import VolumeRef
from python.src.paths import (
    CANONICAL_DIR,
    RAW_DIR,
    WORK_ID,
    WS_BASE_URL,
    canonical_volume_path,
    raw_volume_path,
)
from python.src.wikisource import (
    WikisourceClient,
    WikisourceImportError,
    build_work,
    discover_volumes,
    fetch_or_load_raw,
    make_volume_id,
    now_utc,
    parse_volume_passages,
)


def save_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_json(path: Path) -> object:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def run_sync() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    CANONICAL_DIR.mkdir(parents=True, exist_ok=True)

    retrieved_at = now_utc()

    with WikisourceClient(delay_seconds=0.5) as client:
        main_html = client.fetch_main_page_html()
        volumes = discover_volumes(main_html)
        print(f"Discovered {len(volumes)} volumes")

        volume_refs = []
        for number, title, page_title in volumes:
            volume_id = make_volume_id(number)
            raw_path = raw_volume_path(volume_id)
            canonical_path = canonical_volume_path(volume_id)
            source_page_url = f"{WS_BASE_URL}/wiki/通鑑紀事本末/{page_title}"

            parse_data = fetch_or_load_raw(
                raw_path=raw_path,
                page_title=f"通鑑紀事本末/{page_title}",
                client=client,
                save_json_fn=save_json,
                load_json_fn=load_json,
            )

            passages = parse_volume_passages(
                parse_data,
                volume_id=volume_id,
                volume_title=title,
                source_page_url=source_page_url,
            )

            if not passages:
                raise WikisourceImportError(f"No passages for {volume_id}")

            save_json(
                canonical_path,
                [p.model_dump(mode="json") for p in passages],
            )

            volume_refs.append(
                {
                    "id": volume_id,
                    "workId": WORK_ID,
                    "title": title,
                    "order": number - 1,
                    "sourcePage": source_page_url,
                    "passageCount": len(passages),
                }
            )
            print(f"  {volume_id}: {len(passages)} passages")

    work = build_work(
        volumes=[VolumeRef(**v) for v in volume_refs],
        retrieved_at=retrieved_at,
    )
    work_path = CANONICAL_DIR / WORK_ID / "work.json"
    save_json(work_path, work.model_dump(mode="json"))
    print(f"Saved work metadata to {work_path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync Wikisource corpus")
    args = parser.parse_args()

    try:
        run_sync()
    except WikisourceImportError as exc:
        print(f"IMPORT ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
