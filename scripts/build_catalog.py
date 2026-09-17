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

    # Atomic publish of the *generated* subtrees only.
    #
    # public/data/ also holds hand-curated, committed siblings —
    # annotations/ (gate-passed AI annotations) and source_notes/ (the verified
    # 胡三省注 fixture). Replacing the whole directory would silently destroy
    # them, and a full rebuild is a required step in the release flow, so this
    # swaps only what it generates: works/ and catalog.json.
    staging = public_root.parent / f"{public_root.name}.tmp.{uuid4().hex}"
    try:
        staged_work_dir = staging / "works" / WORK_ID
        staged_work_dir.mkdir(parents=True, exist_ok=True)

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

            target = staged_work_dir / f"{volume.id}.json"
            save_json(target, [p.model_dump(mode="json") for p in passages])

        # Catalog only contains Work with VolumeRefs, not full passages.
        save_json(staging / "catalog.json", work.model_dump(mode="json"))

        public_root.mkdir(parents=True, exist_ok=True)

        # Publish volumes: replace works/ wholesale so removed volumes disappear.
        works_target = public_root / "works"
        if works_target.exists():
            shutil.rmtree(works_target)
        (staging / "works").rename(works_target)

        # Publish the catalog with an atomic file replace, so a reader loading
        # concurrently never sees a half-written catalog.
        (staging / "catalog.json").replace(public_root / "catalog.json")
    finally:
        shutil.rmtree(staging, ignore_errors=True)

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
