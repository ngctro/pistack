#!/usr/bin/env bash
# Read-only audit. Never prune automatically: confirm holds with the user.
set -euo pipefail
exec python3 "$(cd "$(dirname "$0")" && pwd)/worktree-audit.py" "${1:-.}"
