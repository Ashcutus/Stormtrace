"""Linux/Omarchy adapter functions. No provider or domain logic belongs here."""
import os
import subprocess


def local_api_key(root):
    if os.environ.get("LIGHTNING_API_KEY"):
        return os.environ["LIGHTNING_API_KEY"]
    env_file = root / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.startswith("LIGHTNING_API_KEY="):
                return line.split("=", 1)[1].strip()
    return ""


def read_omarchy_theme():
    try:
        name = subprocess.run(["omarchy", "theme", "current"], check=True, capture_output=True, text=True, timeout=2).stdout.strip()
        output = subprocess.run(["omarchy", "theme", "color", "--all"], check=True, capture_output=True, text=True, timeout=2).stdout
        colors = dict(line.split("\t", 1) for line in output.splitlines() if "\t" in line)
        return {"available": True, "name": name or "Omarchy", "mode": colors.get("mode", "dark"), "colors": colors}
    except (OSError, subprocess.SubprocessError):
        return {"available": False, "name": "Stormtrace default", "mode": "dark", "colors": {}}


def profile_paths(glib):
    from pathlib import Path
    data_dir = Path(glib.get_user_data_dir()) / "stormtrace"
    cache_dir = Path(glib.get_user_cache_dir()) / "stormtrace"
    data_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)
    return data_dir, cache_dir


def show_notification(application, gio, notification, icon_path, app_name):
    desktop = gio.Notification.new(notification.get_title() or app_name)
    if notification.get_body():
        desktop.set_body(notification.get_body())
    if icon_path.is_file():
        desktop.set_icon(gio.FileIcon.new(gio.File.new_for_path(str(icon_path))))
    desktop.set_default_action("app.present")
    application.send_notification(f"stormtrace-{notification.get_id()}", desktop)
    return True
