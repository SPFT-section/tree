#!/usr/bin/env bash
# No-build local server for the procedural tree demo.
set -e
PORT="${1:-8001}"
cd "$(dirname "$0")"
echo "== Procedural Tree =="
echo "Serving $(pwd) on http://127.0.0.1:${PORT}"
python3 -m http.server "${PORT}"
