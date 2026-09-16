#!/usr/bin/env python3
"""Generate AI annotation candidates for canonical passages.

Model output is never trusted directly: every span is re-located in the
canonical passage text and re-verified before anything is written to disk.
Canonical text is only ever read, never modified.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from python.src.annotation_pipeline import (
    GENERATOR_SCHEMA_HINT,
    AnchorError,
    build_generator_messages,
    materialize_candidate,
)
from python.src.annotation_store import (
    PassageSelectionError,
    candidate_path,
    save_json,
    select_passages,
)
from python.src.llm import LLMClient, LLMConfig, LLMConfigError, LLMError

MAX_TOKENS = 4000
TEMPERATURE = 0.2


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate AI annotation candidates")
    parser.add_argument("--passage", help="single passage id, e.g. tongjian-jishi-benmo:vol01:p1")
    parser.add_argument("--volume", help="volume id, e.g. vol01")
    parser.add_argument("--limit", type=int, help="max number of passages to process")
    parser.add_argument(
        "--force", action="store_true", help="regenerate candidates that already exist"
    )
    args = parser.parse_args()

    try:
        passages = select_passages(
            passage_id=args.passage, volume_id=args.volume, limit=args.limit
        )
    except (PassageSelectionError, FileNotFoundError) as exc:
        print(f"SELECTION ERROR: {exc}", file=sys.stderr)
        return 2

    try:
        config = LLMConfig.from_env()
    except LLMConfigError as exc:
        print(f"CONFIG ERROR: {exc}", file=sys.stderr)
        return 2

    print(f"Passages selected: {len(passages)}")
    print(f"Model: {config.model}")

    generated = 0
    skipped = 0
    failures: list[tuple[str, str]] = []

    with LLMClient(config) as client:
        for index, passage in enumerate(passages, start=1):
            path = candidate_path(passage.id)
            if path.exists() and not args.force:
                skipped += 1
                continue

            try:
                candidate = client.complete_validated_json(
                    build_generator_messages(passage),
                    lambda raw, p=passage: materialize_candidate(p, raw),
                    max_tokens=MAX_TOKENS,
                    temperature=TEMPERATURE,
                    schema_hint=GENERATOR_SCHEMA_HINT,
                )
            except (LLMError, AnchorError, ValueError) as exc:
                failures.append((passage.id, f"{type(exc).__name__}: {exc}"))
                print(f"  [{index}/{len(passages)}] FAIL {passage.id}: {exc}")
                continue

            save_json(path, candidate.model_dump(mode="json"))
            generated += 1
            print(
                f"  [{index}/{len(passages)}] {passage.id}: "
                f"{len(candidate.properNames)} spans, {len(candidate.annotations)} notes"
            )

    print(f"\nGenerated: {generated}  Skipped (cached): {skipped}  Failed: {len(failures)}")
    if failures:
        print("Failures:", file=sys.stderr)
        for passage_id, message in failures:
            print(f"  {passage_id}: {message}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
