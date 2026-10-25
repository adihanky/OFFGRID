# Agent working rules

These rules apply to the entire repository.

## Start with the handover

1. Read [onboarding.md](onboarding.md) before investigating or changing the project. It is the shared handover for the next agent or chat.
2. Follow its first-steps checklist, including reading [README.md](README.md) and [docs/HIGH_LEVEL_DESIGN.md](docs/HIGH_LEVEL_DESIGN.md), checking applicable agent instructions, and inspecting the current branch and working tree.
3. Verify live repository state. Handover snapshots, previous checks, running services, and branch information may be stale.
4. Preserve existing user changes and follow the current user request. Planned next steps in the handover are context, not automatic authorization to implement unrelated work.

## Single-agent workflow

Before implementing a feature, bug fix, or refactor, read and follow [orchestrator.md](orchestrator.md). The primary agent owns the task end to end. Do not coordinate a multi-agent team or run multiple subagents concurrently. If delegation is useful, use at most one subagent at a time and wait for it to finish before starting another. Prefer direct work for bounded tasks.

Plan requirements and test scenarios before coding, implement against the affected module's design, and run the required checks yourself. A single sequential subagent may be used for a clearly bounded independent review or work item, but it does not replace the primary agent's integration, verification, or handover responsibility. Report any checks that were blocked or not run; do not claim independent reviews or test results that did not occur.

## Required tests for every feature

Every feature must include TypeScript unit tests producing **JUnit XML reports** and functional scenario tests written as **Cucumber.js `.feature` files**. The user confirmed this interpretation of JUnit for this TypeScript project; a Java/JUnit test suite is not required. Testing is part of feature implementation and a prerequisite for declaring the feature complete.

- Cover **happy flows**, **negative flows**, and **edge cases** in both the unit tests and the Cucumber scenarios. Use meaningful assertions about expected behavior and observable outcomes.
- Write functional scenarios with Gherkin `Given` / `When` / `Then` steps and executable step definitions. A `.feature` file without working step definitions does not satisfy this rule.
- Add or update the relevant tests whenever feature behavior changes. Include regression coverage for bug fixes.
- Run both test suites before declaring a feature complete. Failing, skipped, pending, or undefined scenarios must be resolved or explicitly reported as unfinished work.
- Record the test commands, results, coverage gaps, and any prerequisites or blockers in `onboarding.md`.
- Keep test data isolated and repeatable. Never use production data, real credentials, or external account sign-in for automated tests; use controlled fixtures or provider mocks where appropriate.

## Live-service delivery evidence

When the request concerns a running UI/service, implementation is not complete until the requested behavior is verified on the exact URL the user uses. Design documents, source files, passing mocked tests, a successful build and health endpoints are separate evidence; none alone proves live feature delivery.

- Establish the URL, frontend/API processes, served version and configured data target before changing anything. Check the code actually served, not only the worktree. Preserve unrelated changes and existing data.
- Trace each requested capability through its visible screen, real network request, registered API route and persisted result. Report each as designed, implemented, tested and live-verified separately; use "unverified" when evidence is missing.
- Check existing-user migration and seed prerequisites explicitly. Never infer that registration changes backfilled existing users, that a successful deployment populated assets, or that fixture databases represent the running application's data.
- Use isolated synthetic fixtures for automated tests. Also verify the delivered browser-to-API-to-database flow on the intended local/demo service using designated synthetic identities and authorized data operations, without intercepting API responses. Record the URL, check time, exact actions, expected/actual results and screenshot/report paths. Do not use real funds, production credentials or private user data as test fixtures.
- After an authorized implementation, build/restart the affected service as needed and repeat the live check. A health check proves availability only. A mocked browser scenario proves only its stated fixture behavior. Missing access or a blocked migration means live delivery remains unfinished; describe the blocker instead of claiming success.
- Completion evidence must include the required unit JUnit XML and executable Cucumber results, plus live UI evidence for the delivered scope. Inspect actual nonempty reports for failures, errors, skips, pending and undefined cases. Never reuse earlier results as a current run or describe an unimplemented screen as available.

## Documentation and handover

Document changes in proportion to their impact; avoid documentation churn and duplication.

- Read relevant module documentation before changing behavior. Update an existing document when a change materially affects user-visible behavior, API/contracts, data or invariants, security, configuration, operations, or design decisions.
- Create a module architecture document for a new module or substantial architectural boundary, not for every bug fix, small feature, test-only change, or internal refactor. Keep it concise and link to source/tests instead of copying implementation detail.
- Do not create a separate QA/LLD document for routine work. Add design/scenario detail to existing docs when useful; create dedicated artifacts for substantial work with non-obvious contracts, risks, or rollout decisions.
- Update affected documentation after behavior stabilizes, in the same task. Skip unrelated docs and avoid repeating information maintained elsewhere.

## Update the handover before finishing

Update `onboarding.md` once at the end of a changed work session, or when handing off blocked/incomplete work. Keep it as a concise **current-state handover only**: current branch/worktree, active task, verified results, blockers, and exact next action. Replace stale status; do not append a journal, changelog, project index, or historical test log. Link to detailed design and test documentation from the handover rather than copying it. Never include credentials, secrets, session tokens, or private user data. Do not claim changes were committed, pushed, tested, or deployed unless those actions succeeded.

Use the existing lowercase filename `onboarding.md`; do not create a second handover file with different capitalization.
