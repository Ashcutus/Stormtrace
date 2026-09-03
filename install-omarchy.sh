#!/usr/bin/env bash
set -euo pipefail

APP_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
omarchy webapp install "Stormtrace" "http://127.0.0.1:4177" "$APP_DIR/icon.svg" "$APP_DIR/start-app.sh"
echo "Stormtrace is installed. Open the Omarchy app launcher with SUPER + SPACE and search for Stormtrace."
