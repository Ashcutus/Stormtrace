#!/usr/bin/env bash
set -euo pipefail

APP_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$APP_DIR"

if command -v node >/dev/null 2>&1 &&
  node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' >/dev/null 2>&1; then
  exec node server.js
elif command -v python3 >/dev/null 2>&1; then
  exec python3 server.py
else
  echo "Stormtrace requires Node.js 20+ or Python 3." >&2
  exit 1
fi
