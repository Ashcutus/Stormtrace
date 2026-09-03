#!/usr/bin/env bash
set -euo pipefail

APP_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
APP_ID="org.omarchy.Stormtrace"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}"
DESKTOP_DIR="$DATA_DIR/applications"
ICON_DIR="$DATA_DIR/icons/hicolor/scalable/apps"
DESKTOP_FILE="$DESKTOP_DIR/$APP_ID.desktop"
LEGACY_DESKTOP_FILE="$DESKTOP_DIR/Stormtrace.desktop"

desktop_exec_arg() {
  local escaped
  escaped=$(printf '%s' "$1" \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/`/\\`/g' -e 's/\$/\\$/g' -e 's/%/%%/g')
  printf '"%s"' "$escaped"
}

if ! command -v python3 >/dev/null 2>&1 ||
  ! python3 -c 'import gi; gi.require_version("Gtk", "3.0"); gi.require_version("WebKit2", "4.1"); from gi.repository import Gtk, WebKit2' >/dev/null 2>&1; then
  echo "Stormtrace requires python-gobject, gtk3, and webkit2gtk-4.1." >&2
  echo "Install them with: omarchy pkg add python-gobject gtk3 webkit2gtk-4.1" >&2
  exit 1
fi

if ! command -v uwsm-app >/dev/null 2>&1; then
  echo "Stormtrace requires uwsm-app and must be installed from an Omarchy session." >&2
  exit 1
fi

mkdir -p "$DESKTOP_DIR" "$ICON_DIR"
install -m 0644 "$APP_DIR/icon.svg" "$ICON_DIR/$APP_ID.svg"

if [[ -f $LEGACY_DESKTOP_FILE ]]; then
  mv "$LEGACY_DESKTOP_FILE" "$LEGACY_DESKTOP_FILE.webapp-backup.$(date +%s)"
fi

{
  printf '%s\n' '[Desktop Entry]'
  printf '%s\n' 'Version=1.0'
  printf '%s\n' 'Type=Application'
  printf '%s\n' 'Name=Stormtrace'
  printf '%s\n' 'Comment=Real-time global lightning monitor'
  printf 'Exec=%s\n' "$(desktop_exec_arg "$APP_DIR/start-app.sh")"
  printf '%s\n' "Icon=$APP_ID"
  printf '%s\n' 'Terminal=false'
  printf '%s\n' 'Categories=Utility;'
  printf '%s\n' 'StartupNotify=true'
  printf '%s\n' "StartupWMClass=$APP_ID"
  printf '%s\n' 'X-GNOME-UsesNotifications=true'
} >"$DESKTOP_FILE"

update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
gtk-update-icon-cache "$DATA_DIR/icons/hicolor" >/dev/null 2>&1 || true

echo "Stormtrace is installed as a native Omarchy desktop app. Press SUPER + SPACE and search for Stormtrace."
