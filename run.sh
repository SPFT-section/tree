#!/usr/bin/env bash
# No-build local server for the procedural tree demo.
set -e
PORT="${1:-8001}"
cd "$(dirname "$0")"
echo "== Procedural Tree =="
echo "Serving $(pwd) on http://127.0.0.1:${PORT}"
# serve.py forces text/javascript for .js (plain `http.server` breaks ES
# modules on machines whose registry maps .js to text/plain -> black scene).
if command -v python3 >/dev/null 2>&1; then
  python3 "$(dirname "$0")/serve.py" "${PORT}"
elif command -v python >/dev/null 2>&1; then
  python "$(dirname "$0")/serve.py" "${PORT}"
elif command -v py >/dev/null 2>&1; then
  py "$(dirname "$0")/serve.py" "${PORT}"
else
  echo "ERROR: no Python found (need python3, python or py)" >&2
  exit 1
fi
