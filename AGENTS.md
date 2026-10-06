# Repository instructions

## Versioning

- Always bump the application version when making changes that require a pull request, and include the version bump in that same PR.
- Update `version` in the root `manifest.json`, the single source of truth. Do not hard-code the version elsewhere.
- Use a patch bump for fixes, documentation, maintenance, and other small changes; a minor bump for new backward-compatible features; and a major bump for breaking changes.
- Bump once per PR relative to its base branch. Further edits within the same PR do not require additional bumps unless the release scope changes.
- Before handing off or opening the PR, verify that its diff includes the appropriate version bump and run `npm run check`.

## Architecture and compatibility

- Omarchy first; the Stormtrace core must remain platform agnostic. No platform API above the platform-adapter boundary. Composition roots may select adapters; Linux launch/GTK/bar integration belongs to the platform layer.
- No UI component should understand an upstream provider API format. Normalize data in `providers/` before presentation and reuse the existing core/provider/platform modules.
- Preserve provider-native severity/classification separately from Stormtrace display priority. Retain upstream IDs, source timestamps, authority and transformations in provenance; do not invent missing source metadata.
- Keep source/authority/attribution/licence metadata canonical in `providers/registry.js`. Deferred registrations do not imply live integration, permission or an available feature.
- Preserve V1 settings, configured locations, profile paths, launch behaviour and the existing map stack. Prefer incremental extraction over rewriting working functionality. Any data/schema migration must be explicit, idempotent and tested.
- Scope retention to the provider/domain. Do not apply lightning's archive policy to warnings or other hazards. A repeated fetch alone must not create a historical revision.
- Keep Node and Python fallback endpoint contracts compatible; test affected normalization parity. Keep authenticated credentials server-side.
- Use deterministic fixtures/stubbed transports for provider tests and add regressions for affected V1 behaviour. Distinguish automated coverage from an actual native GTK/GeoClue/notification smoke test.

## Multi-phase documentation

- Read `docs/README.md` and `docs/rollout.md` before changing rollout scope. Phase 0 is foundations; implement later hazard APIs/UI only within the user's agreed scope.
- Keep the main README focused on available product behaviour, setup and limitations. Label planned/deferred capabilities clearly; contracts and metadata alone are not delivered features.
- Maintain phase/readiness status and open validation gates in `docs/rollout.md`; keep any README status summary consistent. Distinguish implementation, merge and publication, and do not invent phase numbers, deadlines or agreed future scope.
- Update `docs/architecture.md` for current boundaries/models/compatibility and `docs/providers.md` for provider development/source state. Record phase-specific audits, decisions, migrations, actual checks and deferrals in a linked phase record; maintain `docs/README.md` as the navigation index.
- Record lasting findings here, not temporary PR status, fixed test counts or duplicate application versions. At handoff, report actual validation and leave unperformed native checks visibly outstanding. Follow `PUBLISHING.md` for release checks.
