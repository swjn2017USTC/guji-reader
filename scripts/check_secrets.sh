#!/usr/bin/env bash
set -euo pipefail

# Keep this scan dependency-free so it can run in a fresh CI runner. The
# .env.example contains empty placeholders and is intentionally allowed.
patterns='sk-[A-Za-z0-9_-]{32,}|gh[pousr]_[A-Za-z0-9]{30,}|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|Bearer[[:space:]]+[A-Za-z0-9._-]{20,}'

if git log -p --all -- . ':(exclude)package-lock.json' | grep -E -q "$patterns"; then
  echo "High-confidence secret pattern found in Git history." >&2
  exit 1
fi

echo "No high-confidence secret patterns found in Git history."
