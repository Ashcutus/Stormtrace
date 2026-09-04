#!/usr/bin/env python3
"""Native GTK shell for the local Stormtrace web interface."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

import gi

gi.require_version("Gdk", "3.0")
gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")

from gi.repository import Gdk, Gio, GLib, Gtk, WebKit2  # noqa: E402


APP_ID = "org.omarchy.Stormtrace"
APP_NAME = "Stormtrace"
DEFAULT_URL = "http://127.0.0.1:4177"
APP_DIR = Path(__file__).resolve().parent
ICON_PATH = APP_DIR / "icon.svg"
START_SCRIPT = APP_DIR / "start-app.sh"
DEFAULT_WIDTH = 1200
DEFAULT_HEIGHT = 780
MIN_WIDTH = 900
MIN_HEIGHT = 600

GLib.set_prgname(APP_ID)
GLib.set_application_name(APP_NAME)


class StormtraceApplication(Gtk.Application):
    def __init__(self, app_url: str) -> None:
        super().__init__(application_id=APP_ID, flags=Gio.ApplicationFlags.FLAGS_NONE)
        self.app_url = app_url
        self.window: Gtk.ApplicationWindow | None = None
        self.web_view: WebKit2.WebView | None = None
        self.is_fullscreen = False
        self.is_exiting = False
        self.exit_finished = False
        self.exit_timeout_id = 0
        self.stop_process: Gio.Subprocess | None = None
        self.layout_attempts = 0

    def do_startup(self) -> None:
        Gtk.Application.do_startup(self)

        present_action = Gio.SimpleAction.new("present", None)
        present_action.connect("activate", lambda *_args: self.activate())
        self.add_action(present_action)

        fullscreen_action = Gio.SimpleAction.new("toggle-fullscreen", None)
        fullscreen_action.connect("activate", lambda *_args: self._toggle_fullscreen())
        self.add_action(fullscreen_action)
        self.set_accels_for_action("app.toggle-fullscreen", ["F11"])

        quit_action = Gio.SimpleAction.new("quit", None)
        quit_action.connect("activate", lambda *_args: self._begin_exit())
        self.add_action(quit_action)
        self.set_accels_for_action("app.quit", ["<Primary>q"])

    def do_activate(self) -> None:
        if self.window is not None:
            self.window.present()
            return

        data_dir = Path(GLib.get_user_data_dir()) / "stormtrace"
        cache_dir = Path(GLib.get_user_cache_dir()) / "stormtrace"
        data_dir.mkdir(parents=True, exist_ok=True)
        cache_dir.mkdir(parents=True, exist_ok=True)

        data_manager = WebKit2.WebsiteDataManager(
            base_data_directory=str(data_dir),
            base_cache_directory=str(cache_dir),
        )
        web_context = WebKit2.WebContext.new_with_website_data_manager(data_manager)
        web_context.set_cache_model(WebKit2.CacheModel.WEB_BROWSER)

        self.web_view = WebKit2.WebView.new_with_context(web_context)
        self.web_view.get_settings().set_enable_developer_extras(False)
        content_manager = self.web_view.get_user_content_manager()
        content_manager.register_script_message_handler("stormtrace")
        content_manager.connect(
            "script-message-received::stormtrace", self._on_script_message
        )
        self.web_view.connect("permission-request", self._on_permission_request)
        self.web_view.connect("show-notification", self._on_show_notification)
        self.web_view.connect("decide-policy", self._on_decide_policy)
        self.web_view.connect("load-changed", self._on_load_changed)

        self.window = Gtk.ApplicationWindow(application=self)
        self.window.set_title(APP_NAME)
        self.window.set_default_size(DEFAULT_WIDTH, DEFAULT_HEIGHT)
        self.window.set_size_request(MIN_WIDTH, MIN_HEIGHT)
        self.window.set_position(Gtk.WindowPosition.CENTER)
        self.window.set_role("stormtrace")
        if ICON_PATH.is_file():
            self.window.set_icon_from_file(str(ICON_PATH))
        self.window.add(self.web_view)
        self.window.connect("delete-event", self._on_delete_event)
        self.window.connect("destroy", self._on_window_destroyed)
        self.window.connect("window-state-event", self._on_window_state_event)

        self.web_view.load_uri(self.app_url)
        self.window.show_all()
        self.window.present()
        GLib.timeout_add(120, self._apply_omarchy_window_layout)

    def _on_window_destroyed(self, _window: Gtk.Window) -> None:
        self.window = None
        self.web_view = None

    def _on_delete_event(self, _window: Gtk.Window, _event: Gdk.Event) -> bool:
        self._begin_exit()
        return True

    def _on_script_message(
        self,
        _manager: WebKit2.UserContentManager,
        result: WebKit2.JavascriptResult,
    ) -> None:
        try:
            action = result.get_js_value().to_string()
        except (AttributeError, GLib.Error):
            return

        if action == "toggle-fullscreen":
            self._toggle_fullscreen()
        elif action == "quit":
            self._begin_exit()

    def _on_load_changed(
        self, _web_view: WebKit2.WebView, load_event: WebKit2.LoadEvent
    ) -> None:
        if load_event == WebKit2.LoadEvent.FINISHED:
            self._notify_fullscreen_state()

    def _on_window_state_event(
        self, _window: Gtk.Window, event: Gdk.EventWindowState
    ) -> bool:
        self.is_fullscreen = bool(event.new_window_state & Gdk.WindowState.FULLSCREEN)
        self._notify_fullscreen_state()
        return False

    def _toggle_fullscreen(self) -> None:
        if self.window is None:
            return
        if self.is_fullscreen:
            self.window.unfullscreen()
        else:
            self.window.fullscreen()

    def _notify_fullscreen_state(self) -> None:
        if self.web_view is None:
            return
        fullscreen = "true" if self.is_fullscreen else "false"
        script = (
            "window.dispatchEvent(new CustomEvent('stormtrace:fullscreen-change', "
            f"{{ detail: {{ fullscreen: {fullscreen} }} }}));"
        )
        self.web_view.evaluate_javascript(script, -1, None, None, None, None, None)

    def _begin_exit(self) -> None:
        if self.is_exiting:
            return
        self.is_exiting = True

        if not self._manages_default_service():
            self._finish_exit()
            return

        try:
            self.stop_process = Gio.Subprocess.new(
                [str(START_SCRIPT), "--stop"],
                Gio.SubprocessFlags.STDOUT_SILENCE
                | Gio.SubprocessFlags.STDERR_SILENCE,
            )
            self.stop_process.wait_async(None, self._on_service_stopped)
            self.exit_timeout_id = GLib.timeout_add_seconds(4, self._finish_exit)
        except GLib.Error:
            self._finish_exit()

    def _on_service_stopped(
        self, process: Gio.Subprocess, result: Gio.AsyncResult
    ) -> None:
        try:
            process.wait_finish(result)
        except GLib.Error:
            pass
        self._finish_exit()

    def _finish_exit(self) -> bool:
        if self.exit_finished:
            return False
        self.exit_finished = True
        if self.exit_timeout_id:
            GLib.source_remove(self.exit_timeout_id)
            self.exit_timeout_id = 0
        window = self.window
        if window is not None:
            window.destroy()
        self.quit()
        return False

    def _manages_default_service(self) -> bool:
        parsed = urlparse(self.app_url)
        return parsed.hostname in {"127.0.0.1", "localhost", "::1"} and (
            parsed.port or 80
        ) == 4177

    def _apply_omarchy_window_layout(self) -> bool:
        """Float, size, and centre only this window without changing user config."""
        self.layout_attempts += 1
        if (
            self.window is None
            or self.window.get_window() is None
            or not os.environ.get("HYPRLAND_INSTANCE_SIGNATURE")
            or shutil.which("hyprctl") is None
        ):
            return self.layout_attempts < 20 and self.window is not None

        try:
            completed = subprocess.run(
                ["hyprctl", "clients", "-j"],
                check=True,
                capture_output=True,
                text=True,
                timeout=1,
            )
            clients = json.loads(completed.stdout)
            client = next(
                item
                for item in clients
                if item.get("pid") == os.getpid()
                and item.get("class") == APP_ID
            )
            monitor_result = subprocess.run(
                ["hyprctl", "monitors", "-j"],
                check=True,
                capture_output=True,
                text=True,
                timeout=1,
            )
            monitors = json.loads(monitor_result.stdout)
            monitor = next(
                item for item in monitors if item.get("id") == client.get("monitor")
            )
        except (json.JSONDecodeError, OSError, StopIteration, subprocess.SubprocessError):
            return self.layout_attempts < 20

        scale = max(1.0, float(monitor.get("scale") or 1))
        reserved = monitor.get("reserved") or [0, 0, 0, 0]
        available_width = float(monitor.get("width") or DEFAULT_WIDTH) / scale
        available_height = float(monitor.get("height") or DEFAULT_HEIGHT) / scale
        available_width -= float(reserved[0] + reserved[2])
        available_height -= float(reserved[1] + reserved[3])
        width = min(DEFAULT_WIDTH, max(MIN_WIDTH, int(available_width * 0.84)))
        height = min(DEFAULT_HEIGHT, max(MIN_HEIGHT, int(available_height * 0.84)))
        selector = f"address:{client['address']}"

        commands = (
            f'hl.dsp.window.float({{ action = "set", window = "{selector}" }})',
            f'hl.dsp.window.resize({{ x = {width}, y = {height}, window = "{selector}" }})',
            f'hl.dsp.window.center({{ window = "{selector}" }})',
        )
        for command in commands:
            try:
                subprocess.run(
                    ["hyprctl", "dispatch", command],
                    check=False,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=1,
                )
            except (OSError, subprocess.SubprocessError):
                break
        return False

    @staticmethod
    def _on_permission_request(
        _web_view: WebKit2.WebView, request: WebKit2.PermissionRequest
    ) -> bool:
        allowed_types = (
            WebKit2.GeolocationPermissionRequest,
            WebKit2.NotificationPermissionRequest,
        )
        if isinstance(request, allowed_types):
            request.allow()
            return True
        return False

    def _on_show_notification(
        self, _web_view: WebKit2.WebView, notification: WebKit2.Notification
    ) -> bool:
        desktop_notification = Gio.Notification.new(notification.get_title() or APP_NAME)
        if notification.get_body():
            desktop_notification.set_body(notification.get_body())
        if ICON_PATH.is_file():
            desktop_notification.set_icon(
                Gio.FileIcon.new(Gio.File.new_for_path(str(ICON_PATH)))
            )
        desktop_notification.set_default_action("app.present")
        self.send_notification(f"stormtrace-{notification.get_id()}", desktop_notification)
        return True

    def _on_decide_policy(
        self,
        _web_view: WebKit2.WebView,
        decision: WebKit2.PolicyDecision,
        decision_type: WebKit2.PolicyDecisionType,
    ) -> bool:
        if decision_type not in (
            WebKit2.PolicyDecisionType.NAVIGATION_ACTION,
            WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION,
        ):
            return False

        navigation = decision.get_navigation_action()
        request_uri = navigation.get_request().get_uri()
        if self._same_origin(request_uri):
            return False

        if navigation.get_navigation_type() == WebKit2.NavigationType.LINK_CLICKED:
            decision.ignore()
            Gio.AppInfo.launch_default_for_uri(request_uri, None)
            return True
        return False

    def _same_origin(self, candidate: str) -> bool:
        expected = urlparse(self.app_url)
        actual = urlparse(candidate)
        return (actual.scheme, actual.hostname, actual.port) == (
            expected.scheme,
            expected.hostname,
            expected.port,
        )


def parse_app_url(arguments: list[str]) -> str:
    app_url = arguments[1] if len(arguments) > 1 else DEFAULT_URL
    parsed = urlparse(app_url)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in {
        "127.0.0.1",
        "localhost",
        "::1",
    }:
        raise ValueError("Stormtrace only loads its local HTTP server")
    return app_url


def main() -> int:
    try:
        app_url = parse_app_url(sys.argv)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 2

    application = StormtraceApplication(app_url)
    return application.run([sys.argv[0]])


if __name__ == "__main__":
    raise SystemExit(main())
