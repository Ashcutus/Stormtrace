# Repository instructions

## Versioning

- Always bump the application version when making changes that require a pull request, and include the version bump in that same PR.
- Update `version` in the root `manifest.json`, the single source of truth. Do not hard-code the version elsewhere.
- Use a patch bump for fixes, documentation, maintenance, and other small changes; a minor bump for new backward-compatible features; and a major bump for breaking changes.
- Bump once per PR relative to its base branch. Further edits within the same PR do not require additional bumps unless the release scope changes.
- Before handing off or opening the PR, verify that its diff includes the appropriate version bump and run `npm run check`.
