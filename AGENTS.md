# Agent working rules

These rules apply to the entire repository.

## Start with the handover

1. Read [onboarding.md](onboarding.md) before investigating or changing the project. It is the shared handover for the next agent or chat.
2. Follow its first-steps checklist, including reading [README.md](README.md) and [docs/HIGH_LEVEL_DESIGN.md](docs/HIGH_LEVEL_DESIGN.md), checking applicable agent instructions, and inspecting the current branch and working tree.
3. Verify live repository state. Handover snapshots, previous checks, running services, and branch information may be stale.
4. Preserve existing user changes and follow the current user request. Planned next steps in the handover are context, not automatic authorization to implement unrelated work.

## Required tests for every feature

Every feature must include TypeScript unit tests producing **JUnit XML reports** and functional scenario tests written as **Cucumber.js `.feature` files**. The user confirmed this interpretation of JUnit for this TypeScript project; a Java/JUnit test suite is not required. Testing is part of feature implementation and a prerequisite for declaring the feature complete.

- Cover **happy flows**, **negative flows**, and **edge cases** in both the unit tests and the Cucumber scenarios. Use meaningful assertions about expected behavior and observable outcomes.
- Write functional scenarios with Gherkin `Given` / `When` / `Then` steps and executable step definitions. A `.feature` file without working step definitions does not satisfy this rule.
- Add or update the relevant tests whenever feature behavior changes. Include regression coverage for bug fixes.
- Run both test suites before declaring a feature complete. Failing, skipped, pending, or undefined scenarios must be resolved or explicitly reported as unfinished work.
- Record the test commands, results, coverage gaps, and any prerequisites or blockers in `onboarding.md`.
- Keep test data isolated and repeatable. Never use production data, real credentials, or external account sign-in for automated tests; use controlled fixtures or provider mocks where appropriate.

## Required architecture document for every module

As part of implementing or changing a module, maintain a dedicated Markdown architecture document for that module under `docs/`. Architecture documentation is part of completing the module's work.

- Reuse the existing module document when available; authentication uses [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md). Give each new module its own clearly named `.md` file.
- Describe the module's purpose, responsibilities, boundaries, key components and source paths, dependencies, and integration points with other modules.
- Record its APIs/events, data models and indexes, important invariants, main request/data flows, configuration, security and failure behavior, and architecture decisions or tradeoffs. Use diagrams when they clarify the design.
- Include test locations and commands, verification scope, known limitations, and planned work. Clearly distinguish implemented behavior from proposed design and historical checks from current results.
- Create or update the document in the same work session as the implementation change. Keep it consistent with the code and `docs/HIGH_LEVEL_DESIGN.md`; never include credentials or private data.
- Add or update the module's entry in the **Module architecture index** in `onboarding.md`, including a relative link to its document and its implementation/documentation status. Update affected handover sections and record the documentation change in the handoff log.
- Read the relevant module document before changing that module, and keep detailed architecture in its dedicated file so `onboarding.md` remains a useful project index and handover.

## Update the handover before finishing

After each work session that changes the project, update `onboarding.md` before the final response. Also update it when an investigation discovers material information needed by the next agent or chat.

- Keep the current snapshot, code map, feature tracker, configuration notes, and open work accurate where affected.
- Add a dated entry at the top of the handoff log with the branch and actual commit or PR when available, concrete changes, validation commands and results, unresolved issues or decisions, and the next action.
- Record unfinished work and blockers clearly if work is interrupted or cannot be completed. Distinguish implemented behavior from planned work and verified results from checks that were not run.
- Keep enough context for another agent to continue without the preceding conversation. Correct stale sections rather than only appending contradictory log entries.
- Never include credentials, secrets, session tokens, or private user data. Refer to configuration variable names and setup instructions instead.
- Do not claim changes were committed, pushed, tested, or deployed unless those actions actually succeeded.

Use the existing lowercase filename `onboarding.md`; do not create a second handover file with different capitalization.
