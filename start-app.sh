#!/usr/bin/env bash
set -euo pipefail

APP_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
APP_URL="http://127.0.0.1:4177"
APP_VERSION="1.4.1"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp}/stormtrace"
mkdir -p "$RUNTIME_DIR"

notify_error() {
  local message="$1"
  if command -v omarchy-notification-send >/dev/null 2>&1; then
    omarchy-notification-send "$message"
  else
    printf 'Stormtrace: %s\n' "$message" >&2
  fi
}

if ! command -v python3 >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  [[ ${1:-} == "--health" ]] && exit 1
  notify_error "Stormtrace requires Python 3 and curl."
  exit 1
fi

server_ready() {
  curl -fsS --max-time 1 "$APP_URL/api/health" 2>/dev/null |
    python3 -c 'import json, os, sys; data = json.load(sys.stdin); expected = os.path.realpath(sys.argv[1]); actual = os.path.realpath(data.get("root", "")); sys.exit(0 if data.get("ok") is True and data.get("app") == "stormtrace" and data.get("version") == sys.argv[2] and actual == expected else 1)' "$APP_DIR" "$APP_VERSION" >/dev/null 2>&1
}

server_responding() {
  curl -fsS --max-time 1 "$APP_URL/api/health" >/dev/null 2>&1
}

configure_webkit_rendering() {
  local device_dir device_class vendor_id
  local has_amd_gpu=0
  local has_nvidia_gpu=0

  # Avoid WebKitGTK driver teardown crashes while keeping this user-overridable.
  export WEBKIT_DISABLE_COMPOSITING_MODE="${WEBKIT_DISABLE_COMPOSITING_MODE:-1}"

  # An AMD-only host should not load an installed NVIDIA GLVND provider.
  [[ -n ${__EGL_VENDOR_LIBRARY_FILENAMES:-} ]] && return
  for device_dir in /sys/bus/pci/devices/*; do
    [[ -r $device_dir/class && -r $device_dir/vendor ]] || continue
    read -r device_class <"$device_dir/class"
    [[ ${device_class,,} == 0x03* ]] || continue
    read -r vendor_id <"$device_dir/vendor"
    case ${vendor_id,,} in
      0x1002) has_amd_gpu=1 ;;
      0x10de) has_nvidia_gpu=1 ;;
    esac
  done

  if ((has_amd_gpu && !has_nvidia_gpu)) &&
    [[ -r /usr/share/glvnd/egl_vendor.d/50_mesa.json ]]; then
    export __EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json
  fi
}

stop_managed_server() {
  local pid cmdline

  if systemctl --user is-active --quiet stormtrace-receiver.service 2>/dev/null; then
    systemctl --user stop stormtrace-receiver.service || return 1
    rm -f "$RUNTIME_DIR/server.pid"
    return 0
  fi

  if [[ ! -r $RUNTIME_DIR/server.pid ]]; then
    server_responding && return 1
    return 0
  fi
  read -r pid <"$RUNTIME_DIR/server.pid"
  if [[ ! $pid =~ ^[0-9]+$ || ! -r /proc/$pid/cmdline ]]; then
    rm -f "$RUNTIME_DIR/server.pid"
    server_responding && return 1
    return 0
  fi
  cmdline=$(tr '\0' ' ' <"/proc/$pid/cmdline")
  [[ $cmdline == *"/server.js"* || $cmdline == *"/server.py"* ]] || return 1
  kill "$pid" 2>/dev/null || return 1
  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$RUNTIME_DIR/server.pid"
      return 0
    fi
    sleep 0.1
  done
  return 1
}

if [[ ${1:-} == "--health" ]]; then
  server_ready
  exit $?
fi

if [[ ${1:-} == "--stop" ]]; then
  if stop_managed_server; then
    exit 0
  fi
  notify_error "Stormtrace could not stop its local service. Check: systemctl --user status stormtrace-receiver.service"
  exit 1
fi

if ! python3 -c 'import gi; gi.require_version("Gtk", "3.0"); gi.require_version("WebKit2", "4.1"); from gi.repository import Gtk, WebKit2' >/dev/null 2>&1; then
  notify_error "Stormtrace requires python-gobject, gtk3, and webkit2gtk-4.1. Install them with: omarchy pkg add python-gobject gtk3 webkit2gtk-4.1"
  exit 1
fi

if ! command -v uwsm-app >/dev/null 2>&1; then
  notify_error "Stormtrace could not find uwsm-app. Start it from an Omarchy session."
  exit 1
fi

if ! server_ready; then
  if systemctl --user is-active --quiet stormtrace-receiver.service 2>/dev/null || server_responding; then
    if ! stop_managed_server; then
      notify_error "Another process is using Stormtrace's port 4177. Stop it, then select the bar icon again."
      exit 1
    fi
  fi

  if command -v node >/dev/null 2>&1 &&
    node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' >/dev/null 2>&1; then
    SERVER_COMMAND=(node "$APP_DIR/server.js")
  else
    SERVER_COMMAND=(python3 "$APP_DIR/server.py")
  fi

  systemctl --user reset-failed stormtrace-receiver.service >/dev/null 2>&1 || true
  if ! uwsm-app -s b -t service -u stormtrace-receiver.service \
    -d "Stormtrace receiver" -- "${SERVER_COMMAND[@]}" >/dev/null; then
    notify_error "Stormtrace could not create its receiver service."
    exit 1
  fi
  for _ in {1..30}; do
    server_ready && break
    sleep 0.1
  done
fi

if ! server_ready; then
  notify_error "Stormtrace could not start its local server. Check: journalctl --user -u stormtrace-receiver.service"
  exit 1
fi

configure_webkit_rendering
exec setsid -f uwsm-app -- python3 "$APP_DIR/stormtrace_app.py" "$APP_URL"
