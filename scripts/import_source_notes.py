#!/usr/bin/env python3
"""Validate and import a page-level classical-note JSON export.

The importer accepts a list of records containing passageId, exact, text and
provenance. It resolves anchors against immutable canonical text and refuses
ambiguous, stale, duplicate, or cross-volume records before writing anything.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from python.src.annotation_pipeline import AnchorError, build_anchor  # noqa: E402
from python.src.annotation_store import load_json, load_volume_passages, save_json  # noqa: E402
from python.src.models import SourceNote  # noqa: E402
from python.src.paths import CANONICAL_DIR, PUBLIC_DATA_DIR, WORK_ID  # noqa: E402


def validate_notes(records: list[dict], volume_id: str, work_id: str = WORK_ID,
                   canonical_root: Path = CANONICAL_DIR) -> list[SourceNote]:
    passages = {p.id: p for p in load_volume_passages(volume_id, canonical_root, work_id)}
    output: list[SourceNote] = []
    seen: set[str] = set()
    for index, record in enumerate(records):
        passage_id = str(record.get("passageId", ""))
        passage = passages.get(passage_id)
        if passage is None:
            raise ValueError(f"record {index}: unknown passage {passage_id!r} in {volume_id}")
        anchor_input = record.get("anchor") if isinstance(record.get("anchor"), dict) else record
        exact = str(anchor_input.get("exact", ""))
        if not exact or not str(record.get("text", "")).strip():
            raise ValueError(f"record {index}: exact and text are required")
        note_id = str(record.get("id", f"source:{passage_id}:{index + 1}"))
        if note_id in seen:
            raise ValueError(f"duplicate source note id {note_id!r}")
        seen.add(note_id)
        try:
            anchor = build_anchor(
                passage,
                exact,
                str(anchor_input.get("prefix", "")),
                str(anchor_input.get("suffix", "")),
            )
        except AnchorError as exc:
            raise ValueError(f"record {index} ({note_id}): {exc}") from exc
        output.append(SourceNote(
            id=note_id,
            workId=work_id,
            volumeId=volume_id,
            passageId=passage_id,
            anchor=anchor,
            text=str(record["text"]),
            provenance=str(record.get("provenance", "unspecified source")),
        ))
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--volume", required=True)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        notes = validate_notes(load_json(args.input), args.volume)
    except (ValueError, FileNotFoundError, AnchorError) as exc:
        print(f"IMPORT ERROR: {exc}", file=sys.stderr)
        return 2
    output = args.output or PUBLIC_DATA_DIR / "source_notes" / WORK_ID / f"{args.volume}.json"
    if output.exists():
        print(f"IMPORT ERROR: refusing to overwrite {output}; choose --output", file=sys.stderr)
        return 2
    save_json(output, [note.model_dump(mode="json") for note in notes])
    print(f"Imported {len(notes)} source notes to {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
