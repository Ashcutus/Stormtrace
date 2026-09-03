#!/usr/bin/env python3
"""Native GTK shell for the local Stormtrace web interface."""

from __future__ import annotations

import sys
from pathlib import Path
from urllib.parse import urlparse

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")

from gi.repository import Gio, GLib, Gtk, WebKit2  # noqa: E402


APP_ID = "org.omarchy.Stormtrace"
APP_NAME = "Stormtrace"
DEFAULT_URL = "http://127.0.0.1:4177"
APP_DIR = Path(__file__).resolve().parent
ICON_PATH = APP_DIR / "icon.svg"

GLib.set_prgname(APP_ID)
GLib.set_application_name(APP_NAME)


class StormtraceApplication(Gtk.Application):
    def __init__(self, app_url: str) -> None:
        super().__init__(application_id=APP_ID, flags=Gio.ApplicationFlags.FLAGS_NONE)
        self.app_url = app_url
        self.window: Gtk.ApplicationWindow | None = None
        self.web_view: WebKit2.WebView | None = None

    def do_startup(self) -> None:
        Gtk.Application.do_startup(self)

        present_action = Gio.SimpleAction.new("present", None)
        present_action.connect("activate", lambda *_args: self.activate())
        self.add_action(present_action)

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
        self.web_view.connect("permission-request", self._on_permission_request)
        self.web_view.connect("show-notification", self._on_show_notification)
        self.web_view.connect("decide-policy", self._on_decide_policy)

        self.window = Gtk.ApplicationWindow(application=self)
        self.window.set_title(APP_NAME)
        self.window.set_default_size(1440, 900)
        self.window.set_size_request(900, 600)
        self.window.set_role("stormtrace")
        if ICON_PATH.is_file():
            self.window.set_icon_from_file(str(ICON_PATH))
        self.window.add(self.web_view)
        self.window.connect("destroy", self._on_window_destroyed)

        self.web_view.load_uri(self.app_url)
        self.window.show_all()
        self.window.present()

    def _on_window_destroyed(self, _window: Gtk.Window) -> None:
        self.window = None
        self.web_view = None

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
