# Development workflow

This workflow is referenced by [AGENTS.md](AGENTS.md). Read [onboarding.md](onboarding.md) first, verify the live repository state, and preserve existing user changes. The primary agent owns planning, implementation, integration, verification and handover.

## Agent limit

Do not orchestrate a multi-agent team or run multiple subagents concurrently. Work directly by default. When a task benefits from delegation, use no more than one subagent at a time; wait for its completion before starting another. Keep delegated work bounded, and do not delegate work merely to create parallel activity. Codex enforces the concurrent spawned-agent limit through `agents.max_concurrent_threads_per_session = 1` in the user config at `~/.codex/config.toml`.

## Before implementation

1. Read the handover, applicable instructions, parent design and affected module architecture documents. Inspect branch/status and understand the requested scope, acceptance criteria, exclusions and dependencies.
2. Identify happy, negative, edge and regression cases before coding. Include relevant security, concurrency, recovery and failure boundaries; record cases in tests or existing feature/design docs where useful.
3. Resolve interfaces and invariants in existing module documentation when needed. Create a new design/QA artifact only for substantial work that needs a durable contract or scenario map.
4. Implement the authorized scope. Preserve established file ownership, avoid overwriting unrelated changes, and update affected tests and documentation.

For design-only requests, produce the requested design without starting application coding. Routine documentation changes can be completed directly with document validation. If one subagent is used for a bounded task or review, record its actual scope and result; do not describe primary-agent work as independent review.

## Documentation cost control

Documentation is required when it preserves information future work needs, not as a ceremony after every edit. After implementation stabilizes, update only affected docs whose stated behavior or contracts changed. Add architecture/LLD/QA documents for new modules or substantial cross-cutting work; skip them for isolated fixes, small UI changes, test-only changes and internal refactors unless an existing contract needs correction. Prefer one authoritative document over duplicating information across the README, module docs and handover.

Update `onboarding.md` once at the end of a changed work session, or when pausing/blocked and handing off. Keep only current state and next action; replace stale status instead of appending history. Do not add intermediate progress notes or a changelog there.

## Verification and handover

Every feature requires TypeScript unit tests producing JUnit XML and executable Cucumber.js `.feature` scenarios covering happy, negative and edge behavior, as required by [AGENTS.md](AGENTS.md). Run the required checks after integration and inspect their actual reports; resolve failures, skipped, pending or undefined scenarios, or record them as unfinished.

Use the project runtime and local replica set where required:

```powershell
.\scripts\db.ps1 start
.\scripts\npm.ps1 run check
```

`check` includes lint, application/test type checks, both test suites, builds and formatting. Separate suite commands are `.\scripts\npm.ps1 run test:unit` and `.\scripts\npm.ps1 run test:functional`. See [tests/README.md](tests/README.md) for prerequisites. Run additional module checks, such as transaction verification or browser scenarios, when required and record their scope.

Inspect `.local/test-results/unit.xml`, `functional.xml` and `functional.html`. Report actual counts, failures/errors/skips, blocked or unexecuted cases, prerequisites and coverage gaps. The primary agent reviews the final diff and test evidence, updates module documents and [onboarding.md](onboarding.md), and reports the next action. Publish or commit only within the user's authorization.

This is documented guidance, not an automated agent launcher. The Codex concurrency limit is configured separately in `~/.codex/config.toml`.
