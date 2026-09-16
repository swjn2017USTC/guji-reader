"""Minimal client for the USTC OpenAI-compatible endpoint.

The classical-Chinese generator/reviewer model is pinned by environment
variables and is always a separate model from whatever coding agent drives the
repo. This module never logs the API key and never sends it anywhere except the
configured base URL.
"""

import json
import os
import re
import time
from typing import Any, Callable, Optional

import httpx

ENV_BASE_URL = "GUJI_LLM_BASE_URL"
ENV_API_KEY = "GUJI_LLM_API_KEY"
ENV_MODEL = "GUJI_LLM_MODEL"

RETRYABLE_STATUS = frozenset({408, 409, 425, 429, 500, 502, 503, 504})

_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.DOTALL)


class LLMError(RuntimeError):
    """Raised when the LLM endpoint cannot be used or returns unusable output."""


class LLMConfigError(LLMError):
    """Raised when required environment variables are missing."""


def redact(text: str, secret: Optional[str] = None) -> str:
    """Remove the API key from any string that may be surfaced to a human."""
    key = secret if secret is not None else os.environ.get(ENV_API_KEY, "")
    if key and len(key) >= 6:
        return text.replace(key, "<redacted>")
    return text


class LLMConfig:
    def __init__(self, base_url: str, api_key: str, model: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model

    @classmethod
    def from_env(cls) -> "LLMConfig":
        missing = [name for name in (ENV_BASE_URL, ENV_API_KEY, ENV_MODEL) if not os.environ.get(name)]
        if missing:
            raise LLMConfigError(
                "Missing required environment variables: "
                + ", ".join(missing)
                + ". See .env.example."
            )
        return cls(
            base_url=os.environ[ENV_BASE_URL],
            api_key=os.environ[ENV_API_KEY],
            model=os.environ[ENV_MODEL],
        )

    def describe(self) -> str:
        """Human-readable config summary. Never includes the key."""
        return f"model={self.model} base_url={self.base_url} api_key=<redacted>"


def extract_json_object(raw: str) -> dict[str, Any]:
    """Parse a JSON object from model output, tolerating markdown fences."""
    if not isinstance(raw, str) or not raw.strip():
        raise LLMError("Model returned empty content")

    text = raw.strip()
    fenced = _FENCE_RE.match(text)
    if fenced:
        text = fenced.group(1).strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise LLMError(f"Model output is not JSON: {redact(text[:200])}") from None
        try:
            parsed = json.loads(text[start : end + 1])
        except json.JSONDecodeError as exc:
            raise LLMError(
                f"Model output is not valid JSON ({exc.msg}): {redact(text[:200])}"
            ) from None

    if not isinstance(parsed, dict):
        raise LLMError(f"Model output JSON is {type(parsed).__name__}, expected object")
    return parsed


REPAIR_INSTRUCTION = (
    "你上一次的輸出不符合要求的 JSON schema，驗證錯誤如下：\n\n{error}\n\n"
    "請只輸出修正後的完整 JSON 物件，不要任何解釋文字、不要 markdown code fence。"
)


class LLMClient:
    def __init__(
        self,
        config: LLMConfig,
        timeout_seconds: float = 180.0,
        max_retries: int = 4,
        backoff_seconds: float = 2.0,
    ) -> None:
        self.config = config
        self.max_retries = max_retries
        self.backoff_seconds = backoff_seconds
        self.last_usage: dict[str, Any] = {}
        self._client = httpx.Client(
            headers={
                "Authorization": f"Bearer {config.api_key}",
                "Content-Type": "application/json",
            },
            timeout=timeout_seconds,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "LLMClient":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    def complete_json(
        self,
        messages: list[dict[str, str]],
        *,
        max_tokens: int = 4096,
        temperature: float = 0.2,
    ) -> dict[str, Any]:
        """Single JSON-object completion with retry on transient failures."""
        payload = {
            "model": self.config.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "response_format": {"type": "json_object"},
        }

        last_error: Optional[str] = None
        for attempt in range(self.max_retries + 1):
            try:
                response = self._client.post(
                    f"{self.config.base_url}/chat/completions", json=payload
                )
            except httpx.HTTPError as exc:
                last_error = f"transport error: {type(exc).__name__}"
            else:
                if response.status_code == 200:
                    body = response.json()
                    self.last_usage = body.get("usage", {}) or {}
                    choices = body.get("choices") or []
                    if not choices:
                        raise LLMError("Model returned no choices")
                    content = choices[0].get("message", {}).get("content", "")
                    return extract_json_object(content)
                last_error = f"HTTP {response.status_code}: {redact(response.text[:300])}"
                if response.status_code not in RETRYABLE_STATUS:
                    raise LLMError(last_error)

            if attempt < self.max_retries:
                delay = self.backoff_seconds * (2**attempt)
                time.sleep(delay)

        raise LLMError(f"LLM request failed after {self.max_retries + 1} attempts: {last_error}")

    def complete_validated_json(
        self,
        messages: list[dict[str, str]],
        validate: "Callable[[dict[str, Any]], Any]",
        *,
        max_tokens: int = 4096,
        temperature: float = 0.2,
        max_repairs: int = 1,
        schema_hint: str = "",
    ) -> Any:
        """Completion that must satisfy ``validate``, with bounded self-repair.

        On a validation failure the model is shown its own previous output and
        the error, and asked for a corrected object. The final result still has
        to validate; nothing invalid is ever returned.
        """
        conversation = list(messages)
        last_error: Optional[Exception] = None

        for attempt in range(max_repairs + 1):
            raw = self.complete_json(
                conversation, max_tokens=max_tokens, temperature=temperature
            )
            try:
                return validate(raw)
            except Exception as exc:  # validation errors are model errors here
                last_error = exc
                if attempt >= max_repairs:
                    break
                repair_text = REPAIR_INSTRUCTION.format(error=str(exc))
                if schema_hint:
                    repair_text = f"{repair_text}\n\n必須遵守的結構：\n{schema_hint}"
                conversation = conversation + [
                    {
                        "role": "assistant",
                        "content": json.dumps(raw, ensure_ascii=False),
                    },
                    {"role": "user", "content": repair_text},
                ]

        raise LLMError(
            f"model output failed validation after {max_repairs + 1} attempts: {last_error}"
        )
