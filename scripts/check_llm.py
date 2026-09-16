#!/usr/bin/env python3
"""Canary for the classical-Chinese annotation model.

Checks that the required environment variables are present and that the model
returns schema-valid JSON. Never prints the API key.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydantic import BaseModel, Field, ValidationError

from python.src.llm import LLMClient, LLMConfig, LLMConfigError, LLMError


class CanaryPayload(BaseModel):
    ok: bool
    reading: str = Field(min_length=1)


CANARY_MESSAGES = [
    {
        "role": "system",
        "content": (
            "你是 JSON 輸出測試。只輸出 JSON，不要任何其他文字。"
        ),
    },
    {
        "role": "user",
        "content": (
            "請輸出這個 JSON："
            '{"ok": true, "reading": "三家分晉"}'
            " 其中 ok 必須是布林值 true，reading 必須是《通鑑紀事本末》第一卷的篇名。"
        ),
    },
]


def main() -> int:
    parser = argparse.ArgumentParser(description="Check USTC LLM connectivity")
    parser.add_argument(
        "--show-config",
        action="store_true",
        help="print the resolved base URL and model (never the key)",
    )
    args = parser.parse_args()

    try:
        config = LLMConfig.from_env()
    except LLMConfigError as exc:
        print(f"CONFIG ERROR: {exc}", file=sys.stderr)
        return 2

    print("Environment: OK")
    if args.show_config:
        print(f"  {config.describe()}")

    try:
        with LLMClient(config) as client:
            raw = client.complete_json(CANARY_MESSAGES, max_tokens=200, temperature=0.0)
            payload = CanaryPayload(**raw)
    except (LLMError, ValidationError) as exc:
        print(f"CANARY FAILED: {exc}", file=sys.stderr)
        return 1

    print("Canary: OK")
    print(f"  structured output parsed and schema-valid: {json.dumps(payload.model_dump(), ensure_ascii=False)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
