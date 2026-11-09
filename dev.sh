#!/usr/bin/env bash
# Starts the API (port 8000) and the UI (port 5173) together; Ctrl-C stops both.
set -euo pipefail
cd "$(dirname "$0")"
(cd backend && uv run uvicorn app.main:app --port 8000) &
api=$!
trap 'kill $api 2>/dev/null' EXIT
cd frontend && pnpm dev --strictPort
