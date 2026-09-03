# Marketplace publishing checklist

Stormtrace is structurally ready for the Omarchy plugin marketplace. This release is prepared for the public repository `https://github.com/Ashcutus/Stormtrace`.

1. Keep the repository public so the marketplace can inspect and install it.
2. Keep `manifest.json` at the repository root.
3. Replace `Stormtrace Contributors` in `manifest.json` and `LICENSE` with the maintainer's preferred display name if desired.
4. Run `omarchy plugin validate .` at the release commit.
5. Test the public installation path:

   ```bash
   omarchy plugin add https://github.com/Ashcutus/Stormtrace.git --enable
   ```

6. Open the [Omarchy marketplace submission form](https://plugins.omarchy.org/publish.html) and provide the repository URL, category, and tags.

Suggested listing metadata:

- Category: **Info**
- Tags: `weather`, `lightning`, `map`, `alerts`, `realtime`
- Summary: “A theme-aware global lightning map with local 24-hour history, hot spots, and proximity alerts.”

The marketplace performs manifest and listing validation, not a security audit. Keep the live-feed limitations and private, non-commercial restriction visible in the README.
