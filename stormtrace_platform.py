"""Linux/Omarchy adapter functions. No provider or domain logic belongs here."""
import os
import subprocess


def local_setting(root, name):
    if os.environ.get(name):
        return os.environ[name]
    env_file = root / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip()
    return ""


def local_api_key(root):
    return local_setting(root, "LIGHTNING_API_KEY")


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


class RadarAdapter:
    """Local worker composition shared with Node; bounded memory-only cache."""
    def __init__(self, root):
        import threading
        self.root, self.lock, self.cached, self.images = root, threading.Lock(), None, {}
        self.health = {'lastAttemptedFetch': None, 'lastSuccessfulFetch': None, 'sourceDataTimestamp': None, 'expectedUpdateInterval': 900000, 'lastError': None, 'consecutiveFailures': 0, 'available': False, 'freshnessBasis': 'source'}

    def worker(self, operation, key=None):
        import json
        import sys
        from providers.metoffice_radar import RadarError
        python = local_setting(self.root, 'STORMTRACE_RADAR_PYTHON') or sys.executable
        try:
            run = subprocess.run([python, str(self.root / 'providers/metoffice_radar.py'), operation, *([key] if key else [])], capture_output=True, timeout=45, check=False)
            if run.returncode:
                try: code = json.loads(run.stderr)['code']
                except (ValueError, KeyError): code = 'configuration'
                raise RadarError(code)
            return run.stdout
        except subprocess.TimeoutExpired:
            raise RadarError('timeout') from None
        except OSError:
            raise RadarError('configuration') from None

    def frames(self):
        import time
        import json
        from providers.metoffice_radar import RadarError
        with self.lock:
            now = int(time.time() * 1000)
            if self.cached and now - self.health['lastSuccessfulFetch'] < 300000:
                return {**self.cached, 'health': {**self.health, 'freshness': self.freshness(now)}}
            self.health['lastAttemptedFetch'] = now
            try:
                result = json.loads(self.worker('frames'))
                self.health.update(lastSuccessfulFetch=int(time.time() * 1000), sourceDataTimestamp=result['sourceDataTimestamp'], lastError=None, consecutiveFailures=0, available=bool(result['records']))
                self.cached = result
                ids = {r['id'] for r in result['records']}
                self.images = {key: value for key, value in self.images.items() if key in ids}
                return {**result, 'health': {**self.health, 'freshness': self.freshness(now)}}
            except RadarError as e:
                self.health['lastError'] = {'code': e.code, 'provider': 'metoffice-radar', 'operation': 'frames', 'status': None, 'retryAfter': None}
                self.health['consecutiveFailures'] += 1
                raise

    def freshness(self, now):
        if self.health['lastError']: return 'provider_error'
        at = self.health['sourceDataTimestamp']
        if at is None: return 'unavailable'
        age = now - min(at, self.health['lastSuccessfulFetch'])
        return 'stale' if age > 2700000 else 'delayed' if age > 1350000 else 'fresh'

    def image(self, key):
        from providers.metoffice_radar import RadarError
        result = self.frames()
        if not any(r['id'] == key for r in result['records']): raise RadarError('unavailable')
        if result['missingDependencies']: raise RadarError('configuration')
        with self.lock:
            if key not in self.images: self.images[key] = self.worker('render', key)
            return self.images[key]
