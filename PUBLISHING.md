# Marketplace publishing checklist

Stormtrace is structurally ready for the Omarchy plugin marketplace. This release is prepared for the public repository `https://github.com/Ashcutus/Stormtrace`.

1. Keep the repository public so the marketplace can inspect and install it.
2. Keep `manifest.json` at the repository root.
3. Replace `Stormtrace Contributors` in `manifest.json` and `LICENSE` with the maintainer's preferred display name if desired.
4. Set the release version in `manifest.json`; the servers, launcher, bar widget, and interface read it from there.
5. Run `omarchy plugin validate .` at the release commit.
6. Review the [rollout completion gates](docs/rollout.md#completion-gates) for the release commit. Confirm README feature claims match implemented behaviour, planned sources are labelled, and architecture/provider documentation and phase evidence are current. Verify the native runtime and project checks:

   ```bash
   omarchy pkg add python-gobject gtk3 webkit2gtk-4.1 geoclue
   npm ci
   npm run check
   npm test
   git diff --check
   bash -n start.sh start-app.sh install-omarchy.sh uninstall-omarchy.sh
   ```

7. Test the public installation path:

   ```bash
   omarchy plugin add https://github.com/Ashcutus/Stormtrace.git --enable
   ```

8. Select the bar icon twice and confirm there is one `org.omarchy.Stormtrace` window which is focused on the second selection. Confirm it opens floating and centred, `F11` restores correctly after fullscreen, pause/resume controls the feed, the About panel reports the published version correctly, and Exit stops `stormtrace-receiver.service`. Also run the installed plugin's `install-omarchy.sh` and launch Stormtrace from `SUPER + SPACE`.
9. Record native smoke-test results and any outstanding/deferred checks in [the rollout tracker](docs/rollout.md). Record review/merge and publication separately; automated checks alone do not establish native desktop validation.
10. Open the [Omarchy marketplace submission form](https://plugins.omarchy.org/publish.html) and provide the repository URL, category, and tags.

Suggested listing metadata:

- Category: **Info**
- Tags: `weather`, `lightning`, `map`, `alerts`, `realtime`
- Summary: “A theme-aware global lightning map with local 24-hour history, hot spots, and proximity alerts.”

The marketplace performs manifest and listing validation, not a security audit. Keep the live-feed limitations and private, non-commercial restriction visible in the README.
