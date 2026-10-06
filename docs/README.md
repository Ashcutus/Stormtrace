# Stormtrace documentation

The [main README](../README.md) describes the currently usable lightning viewer, installation, controls, data limitations and troubleshooting. Use the following guides for development and rollout work.

| Document | Purpose | Update when |
| --- | --- | --- |
| [Rollout tracker](rollout.md) | Canonical phase status, agreed/proposed scope, completion gates and outstanding evidence | Scope, validation, merge or release status changes |
| [Architecture](architecture.md) | Current UI/core/provider/platform boundaries, event/provenance models, storage compatibility and technical debt | A boundary, model, persistence policy or compatibility assumption changes |
| [Providers](providers.md) | Provider implementation workflow, source matrix and registry/licence interpretation | A provider is introduced or its capabilities/metadata change |
| [Phase 0 record](phase-0.md) | Historical audit, decisions, delivery scope and initial validation evidence | Correcting the record or recording a material Phase 0 scope change |
| [Location review](location-review.md) | Detailed V1 automatic/manual/coarse-location behaviour and rationale | Location behaviour changes |
| [Publishing checklist](../PUBLISHING.md) | Release and marketplace validation | Release procedures or requirements change |
| [Repository instructions](../AGENTS.md) | Lasting contributor rules | A reusable architecture, compatibility or documentation rule is established |

## Documentation maintenance plan

Keep user-facing instructions in the main README and implementation details in the relevant guide. Maintain phase status in the rollout tracker; the README may provide a short matching summary and link. Source metadata remains canonical in `providers/registry.js`; documentation explains its meaning and implementation state rather than creating a second licence registry. The application version remains canonical in `manifest.json`.

For each agreed phase, add a record such as `phase-0.md` with the starting audit, scope/exclusions, decisions, compatibility/migrations, validation evidence and deliberate deferrals. Link it from this index and the rollout tracker. Do not assign later phase numbers, delivery dates or approved scope until agreed. Keep historical evidence distinct from current status: a passing test count at one handoff is not a permanent project requirement.

At each phase handoff, update the current architecture/provider guides, the rollout status and actual validation evidence. When an implemented capability becomes available to users, update README features, setup, limitations and troubleshooting; add screenshots only when they show that capability. At release time, verify those claims against the release commit and complete the publishing checks. A source registration or contract alone does not warrant listing a feature as available.
