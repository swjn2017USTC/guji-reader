#!/usr/bin/env python3
"""Build public/data catalog from canonical corpus."""

import json
import shutil
import sys
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from python.src.models import Passage, Work
from python.src.paths import (
    CANONICAL_DIR,
    PUBLIC_DATA_DIR,
    WORK_ID,
)


def load_json(path: Path) -> object:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def run_build(
    canonical_root: Path = CANONICAL_DIR,
    public_root: Path = PUBLIC_DATA_DIR,
) -> Work:
    work_path = canonical_root / WORK_ID / "work.json"
    if not work_path.exists():
        raise FileNotFoundError(
            f"Missing {work_path}; run scripts/sync_wikisource.py first"
        )

    work_data = load_json(work_path)
    work = Work(**work_data)

    # Atomic publish: write to a temp directory, then swap it into place.
    temp_public_root = public_root.parent / f"{public_root.name}.tmp.{uuid4().hex}"
    try:
        public_work_dir = temp_public_root / "works" / WORK_ID
        public_work_dir.mkdir(parents=True, exist_ok=True)

        for volume in work.volumes:
            canonical_path = canonical_root / WORK_ID / f"{volume.id}.json"
            if not canonical_path.exists():
                raise FileNotFoundError(f"Missing canonical file: {canonical_path}")

            passages_raw = load_json(canonical_path)
            # Validate every passage against the schema.
            passages = [Passage(**p) for p in passages_raw]
            if not passages:
                raise ValueError(f"No passages in {canonical_path}")

            if volume.passageCount != len(passages):
                raise ValueError(
                    f"{volume.id} passageCount mismatch: "
                    f"VolumeRef says {volume.passageCount}, canonical has {len(passages)}"
                )

            target = public_work_dir / f"{volume.id}.json"
            save_json(target, [p.model_dump(mode="json") for p in passages])

        # Catalog only contains Work with VolumeRefs, not full passages.
        catalog_path = temp_public_root / "catalog.json"
        save_json(catalog_path, work.model_dump(mode="json"))

        # Swap temp tree into place.
        if public_root.exists():
            shutil.rmtree(public_root)
        temp_public_root.rename(public_root)
    except Exception:
        # Leave temp dir for debugging on failure; clean up only on success.
        raise

    print(f"Catalog: {public_root / 'catalog.json'}")
    print(f"Volumes: {len(work.volumes)}")
    return work


def main() -> int:
    try:
        run_build()
    except FileNotFoundError as exc:
        print(f"BUILD ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
