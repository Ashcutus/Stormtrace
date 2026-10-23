"""Linux/Omarchy adapter functions. No provider or domain logic belongs here."""
import os
import subprocess


def default_radar_env(env=None):
    """Optional radar decoder environment, outside the plugin folder (no symlinks there)."""
    env = os.environ if env is None else env
    data = env.get("XDG_DATA_HOME") or os.path.join(env.get("HOME") or os.path.expanduser("~"), ".local", "share")
    return os.path.join(data, "stormtrace", "radar-venv")


def radar_python(root, fallback, env=None):
    """An explicit .env choice wins; otherwise the default environment once it exists."""
    explicit = local_setting(root, "STORMTRACE_RADAR_PYTHON")
    if explicit:
        return explicit
    candidate = os.path.join(default_radar_env(env), "bin", "python")
    return candidate if os.path.exists(candidate) else fallback


class RadarSetup:
    """One-click decoder setup, mirroring platform/node.js: fixed commands, one job, bounded time."""
    def __init__(self, root, run=None, on_done=None, now=None, env=None):
        import threading
        import time
        self.root, self.on_done, self.env = root, on_done or (lambda: None), env
        self.run = run or (lambda command, timeout: subprocess.run(command, cwd=root, capture_output=True, text=True, timeout=timeout, check=True))
        self.now = now or (lambda: int(time.time() * 1000))
        self.lock = threading.Lock()
        self.status = {"state": "idle", "step": None, "message": "", "startedAt": None, "finishedAt": None}

    def snapshot(self):
        return {**self.status, "explicitPython": bool(local_setting(self.root, "STORMTRACE_RADAR_PYTHON")), "environment": default_radar_env(self.env)}

    def start(self, background=True):
        import threading
        with self.lock:
            if self.status["state"] == "running":
                return self.snapshot()
            self.status = {"state": "running", "step": "environment", "message": "Creating the radar environment…", "startedAt": self.now(), "finishedAt": None}
        thread = threading.Thread(target=self._work, daemon=True)
        thread.start()
        if not background:
            thread.join()
        return self.snapshot()

    def _work(self):
        import sys
        venv = default_radar_env(self.env)
        try:
            self.run([sys.executable, "-m", "venv", venv], 120)
            self.status = {**self.status, "step": "packages", "message": "Installing radar packages (about 40 MB)…"}
            self.run([os.path.join(venv, "bin", "python"), "-m", "pip", "install", "--disable-pip-version-check", "--no-input", "-r", str(self.root / "requirements-radar.txt")], 900)
            self.status = {**self.status, "state": "done", "step": None, "message": "Radar is set up.", "finishedAt": self.now()}
            self.on_done()
        except Exception as error:  # surfaced to the user; the app keeps working without radar
            lines = [line.strip() for line in str(getattr(error, "stderr", "") or error).splitlines() if line.strip()]
            detail = "".join(" " if ord(ch) < 32 or ord(ch) == 127 else ch for ch in (lines[-1] if lines else ""))[:200]
            self.status = {**self.status, "state": "failed", "message": f"Radar setup failed{': ' + detail if detail else ''}. See the radar setup guide.", "finishedAt": self.now()}


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


def hyprland_window_commands(client, monitor, default_size, min_size):
    """Dispatches that float, size and centre one window on its Hyprland monitor.

    Centre with an absolute move: Hyprland restores a floating window to the
    position recorded by move, not by window.center, when fullscreen ends.
    """
    scale = max(1.0, float(monitor.get("scale") or 1))
    reserved = monitor.get("reserved") or [0, 0, 0, 0]
    available_width = float(monitor.get("width") or default_size[0]) / scale
    available_height = float(monitor.get("height") or default_size[1]) / scale
    available_width -= float(reserved[0] + reserved[2])
    available_height -= float(reserved[1] + reserved[3])
    width = min(default_size[0], max(min_size[0], int(available_width * 0.84)))
    height = min(default_size[1], max(min_size[1], int(available_height * 0.84)))
    x = int(monitor.get("x") or 0) + int(reserved[0]) + max(0, int((available_width - width) / 2))
    y = int(monitor.get("y") or 0) + int(reserved[1]) + max(0, int((available_height - height) / 2))
    selector = f"address:{client['address']}"
    return [
        f'hl.dsp.window.float({{ action = "set", window = "{selector}" }})',
        f'hl.dsp.window.resize({{ x = {width}, y = {height}, window = "{selector}" }})',
        f'hl.dsp.window.move({{ x = {x}, y = {y}, window = "{selector}" }})',
    ]


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
    def __init__(self, root, source="metoffice-radar"):
        import threading
        self.root, self.lock, self.cached, self.images = root, threading.Lock(), None, {}
        self.source = source
        self.id = "noaa-radar" if source.startswith("noaa-") else source
        self.health = {'lastAttemptedFetch': None, 'lastSuccessfulFetch': None, 'sourceDataTimestamp': None, 'expectedUpdateInterval': 120000 if source.startswith('noaa-') else 900000, 'lastError': None, 'consecutiveFailures': 0, 'available': False, 'freshnessBasis': 'source'}

    def invalidate(self):
        """Forget cached frames so a newly set-up decoder is used on the next check."""
        with self.lock:
            self.cached, self.images = None, {}

    def worker(self, operation, key=None):
        import json
        import sys
        from providers.metoffice_radar import RadarError
        python = radar_python(self.root, sys.executable)
        try:
            args = [str(self.root / 'providers/metoffice_radar.py'), operation] if self.source == 'metoffice-radar' else ['-m', 'providers.public_radar', self.source, operation]
            run = subprocess.run([python, *args, *([key] if key else [])], cwd=self.root, capture_output=True, timeout=45, check=False)
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
            if self.cached and now - self.health['lastSuccessfulFetch'] < (60000 if self.id == 'noaa-radar' else 300000):
                return {**self.cached, 'health': {**self.health, 'freshness': self.freshness(now)}}
            self.health['lastAttemptedFetch'] = now
            try:
                result = json.loads(self.worker('frames'))
                self.health.update(lastSuccessfulFetch=int(time.time() * 1000), sourceDataTimestamp=result['sourceDataTimestamp'], lastError=None, consecutiveFailures=0, available=bool(result['records']))
                self.cached = result
                ids = {r['id'] for r in result['records']}
                if self.id == 'noaa-radar': ids.add('legend')
                self.images = {key: value for key, value in self.images.items() if key in ids}
                return {**result, 'health': {**self.health, 'freshness': self.freshness(now)}}
            except RadarError as e:
                self.health['lastError'] = {'code': e.code, 'provider': self.id, 'operation': 'frames', 'status': None, 'retryAfter': None}
                self.health['consecutiveFailures'] += 1
                raise

    def freshness(self, now):
        if self.health['lastError']: return 'provider_error'
        at = self.health['sourceDataTimestamp']
        if at is None: return 'unavailable'
        age = now - min(at, self.health['lastSuccessfulFetch'])
        interval = self.health['expectedUpdateInterval']
        return 'stale' if age > interval * 3 else 'delayed' if age > interval * 1.5 else 'fresh'

    def image(self, key):
        from providers.metoffice_radar import RadarError
        result = self.frames()
        if not (key == 'legend' and self.id == 'noaa-radar') and not any(r['id'] == key for r in result['records']): raise RadarError('unavailable')
        if result['missingDependencies']: raise RadarError('configuration')
        with self.lock:
            if key not in self.images:
                while len(self.images) >= (12 if self.source == 'metoffice-radar' else 3): self.images.pop(next(iter(self.images)))
                self.images[key] = self.worker('render', key)
            return self.images[key]
