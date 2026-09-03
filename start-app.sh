#!/usr/bin/env bash
set -euo pipefail

APP_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
APP_URL="http://127.0.0.1:4177"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp}/stormtrace"
mkdir -p "$RUNTIME_DIR"

if ! curl -fsS --max-time 1 "$APP_URL/api/health" >/dev/null 2>&1; then
  if command -v node >/dev/null 2>&1; then
    SERVER_COMMAND=(node "$APP_DIR/server.js")
  elif command -v python3 >/dev/null 2>&1; then
    SERVER_COMMAND=(python3 "$APP_DIR/server.py")
  else
    omarchy-notification-send "Stormtrace requires Node.js 20+ or Python 3."
    exit 1
  fi

  nohup "${SERVER_COMMAND[@]}" >"$RUNTIME_DIR/server.log" 2>&1 &
  printf '%s\n' "$!" >"$RUNTIME_DIR/server.pid"
  for _ in {1..30}; do
    curl -fsS --max-time 1 "$APP_URL/api/health" >/dev/null 2>&1 && break
    sleep 0.1
  done
fi

exec omarchy launch or focus webapp "^Stormtrace$" "$APP_URL"
