# Staged rollout

This is the canonical tracker for implementation scope, readiness and release status. The [README](../README.md) describes the working product; the [architecture guide](architecture.md) describes the current design. An implementation phase, merged change and published application release are distinct milestones.

## Current status

| Work | Implementation | Validation / release status |
| --- | --- | --- |
| V1 lightning viewer | Existing working product: live feed, local archive, place search, saved location, map and proximity alerts | Existing baseline preserved by automated regressions |
| Phase 0: foundations | Merged to main; [audit and delivery record](phase-0.md) | [PR #21](https://github.com/Ashcutus/Stormtrace/pull/21) merged; user applied the update and reported no visible changes; automated checks pass; detailed native smoke gates remain unrecorded |
| Phase 1: UK warnings and public radar | Implemented on `feat/phase-1`; [warnings record](phase-1.md) and [radar setup/evidence](radar.md) | Automated checks and user preview reviews pass; [PR #22](https://github.com/Ashcutus/Stormtrace/pull/22) open for review; authenticated DataHub and native smoke gates outstanding; merge/publication pending |
| Paid UK radar | Public ASDI route approved and implemented first | Paid product/access remains deferred |

Phase 0 implementation has provider contracts/metadata, provenance, event revisions, freshness/errors, GeoJSON/CAP and platform adapters. Metadata placeholders for future sources do not make those sources operational. Use the root manifest for the application version; phase numbers do not define version numbers.

## Agreed scope and later candidates

Phase 1 delivers optional Met Office UK warnings first. After warnings, the user approved public ASDI radar first. Anonymous access and real-file rendering are verified; native/browser map alignment remains an open gate. Paid access is deferred; do not substitute precipitation forecasts for observations. USGS earthquakes remain a candidate for later implementation; no later phase number, grouping or ordering is agreed. Cyclones, volcanoes, tsunamis and space weather remain intended future domains, with source candidates listed in the [provider matrix](providers.md#source-matrix). No delivery dates are committed here.

Before selecting a slice, verify the actual endpoint, coverage, terms, authentication, upstream history, source timestamps and update cadence. Capture representative data fixtures and decide domain retention/storage budgets. For CAP warnings include updates/cancellations, references, native classifications and malformed areas; for radar include frame timestamps, bounds and resource lifetimes; for earthquakes include updates and source IDs.

## Completion gates

Use these gates for each agreed phase. Record evidence against the relevant commit; do not mark a check complete solely because another check passed.

| Gate | Required evidence |
| --- | --- |
| Scope | An agreed phase record states delivered capabilities and deliberate exclusions; deferred metadata is clearly labelled |
| Boundaries | UI consumes normalized models; platform APIs stay in adapters; native source classification and provenance survive normalization |
| Compatibility | Existing V1 settings/location/cache/launch/map behaviour is preserved; any migration is explicit, idempotent and tested |
| Automated validation | Full deterministic tests, `npm run check` and diff checks pass; tests use fixtures/stubbed transport rather than live feeds |
| Native desktop validation | Launch/focus/exit, automatic/coarse/manual location, notifications and map interaction are exercised in Omarchy; record outcome and environment without private coordinates |
| Documentation | README describes available behaviour; architecture/provider guides match the code; tracker and phase record distinguish completed work from open checks |
| Release | Review/merge and the [publishing checklist](../PUBLISHING.md) are complete; record publication separately from implementation |

## Outstanding Phase 0 checks

- [ ] Native launch and single-instance focus, fullscreen/restore, pause/resume and clean service shutdown.
- [ ] Automatic location through WebKit/GeoClue, approximate-location review and manual/map location persistence.
- [ ] Desktop notification permission/delivery, proximity behaviour and cooldown.
- [ ] Interactive map pan/zoom, strike selection and available basemap/fallback behaviour.
- [x] Phase 0 PR review/merge (PR #21); user applied the update.
- [ ] Detailed native validation and publication checklist evidence, if a release is chosen.

Automated Phase 0 evidence is recorded in the [delivery record](phase-0.md#validation-evidence). The native checks above have not been recorded as performed. Capture results here as they occur, including the tested commit and any follow-up issue; do not include secrets or private location data.

## Outstanding Phase 1 checks

The user reviewed both warning and radar previews successfully. Authenticated live warnings retrieval, detailed native inspection/coexistence and release review/publication remain outstanding. See the [Phase 1 evidence and open checks](phase-1.md#validation-evidence). Public radar requires its optional local decoder; paid access remains deferred. See [radar evidence and open checks](radar.md#implementation-and-validation).

## Status maintenance

Update this tracker in the same PR when agreed scope, capability readiness or validation status changes. After merge/publication, replace branch/review wording with the actual milestone and evidence. Add later phase rows and linked records only after their scope is agreed. Keep outstanding checks visible until verified or explicitly deferred with a reason; a planned feature is never an available feature merely because its contract exists.

## Soak diagnostics validation

An opt-in bounded recorder is implemented independently of hazard rollout scope; see [diagnostics](diagnostics.md). Deterministic tests cover its storage and disabled paths. The [7 October soak investigation](performance-2026-10-07.md) records a 5h 51m native run and isolated WebKit storage benchmarks. A repeat full viewer soak after the storage fix, an overnight run and a controlled enabled/disabled overhead comparison remain outstanding; implementation does not imply merge/publication.
