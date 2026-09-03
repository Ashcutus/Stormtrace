#!/usr/bin/env bash
set -euo pipefail

APP_ID="org.omarchy.Stormtrace"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}"

systemctl --user stop stormtrace-receiver.service >/dev/null 2>&1 || true
rm -f "$DATA_DIR/applications/$APP_ID.desktop"
rm -f "$DATA_DIR/applications/Stormtrace.desktop"
rm -f "$DATA_DIR/icons/hicolor/scalable/apps/$APP_ID.svg"
rm -f "$DATA_DIR/icons/hicolor/256x256/apps/stormtrace.svg"
update-desktop-database "$DATA_DIR/applications" >/dev/null 2>&1 || true
gtk-update-icon-cache "$DATA_DIR/icons/hicolor" >/dev/null 2>&1 || true

echo "Stormtrace has been removed from the Omarchy app launcher."
