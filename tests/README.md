# Feature testing

Every feature requires TypeScript unit tests with JUnit XML reports and executable Cucumber.js scenarios. Cover happy flows, negative flows, and edge cases in both suites, as required by [AGENTS.md](../AGENTS.md). The user confirmed that JUnit means the XML report format for this TypeScript project.

## Running tests

From the repository root on Windows:

```powershell
.\scripts\db.ps1 start
.\scripts\npm.ps1 test
.\scripts\npm.ps1 run test:unit
.\scripts\npm.ps1 run test:functional
.\scripts\npm.ps1 run test:typecheck
.\scripts\npm.ps1 run check
```

`test` runs both suites, even if the first suite fails. `check` runs lint, application type checks, test type checks, both test suites, builds, and formatting validation. Use the project-local Node.js 24 runtime through the wrapper; no Java runtime is required.

Unit tests require no running services. Functional tests start a NestJS HTTP server on an operating-system-assigned loopback port for each scenario and close it afterward. Health scenarios use controlled MongoDB command responses. Auth scenarios require the local `rs0` replica set and use the full application with real validators/indexes and a generated `p2p_auth_test_<random-id>` database per scenario; only Google's network and verification keys are mocked. Databases are dropped after each auth scenario after validating the generated name. No external accounts or existing application servers are required. This does not replace the real MongoDB transaction check (`scripts/db.ps1 verify`) or the running application smoke check.

For focused runs after activating the local runtime (`. .\scripts\use-tools.ps1`), use `node scripts/test.mjs functional --tags @auth` or `--tags @health`; the health-only run does not need MongoDB.

## Files and reports

| Path                                  | Purpose                                             |
| ------------------------------------- | --------------------------------------------------- |
| `tests/unit/**/*.test.mts`            | TypeScript unit tests using the Node.js test runner |
| `tests/features/**/*.feature`         | Gherkin functional scenarios                        |
| `tests/steps/**/*.mts`                | Executable Cucumber steps and scenario hooks        |
| `tests/support/`                      | Controlled fixtures shared by the test suites       |
| `tests/tsconfig.json`                 | Test type checking and tsx decorator configuration  |
| `cucumber.mjs`                        | Cucumber discovery, strict mode, and reporting      |
| `scripts/test.mjs`                    | Cross-platform suite runner and report validation   |
| `.local/test-results/unit.xml`        | Unit JUnit XML report                               |
| `.local/test-results/functional.xml`  | Functional JUnit XML report                         |
| `.local/test-results/functional.html` | Readable Cucumber HTML report                       |

Reports are generated locally and ignored by Git. Each suite overwrites its previous reports. The runner rejects empty JUnit reports, skipped tests, and reported failures or errors. Undefined or pending Cucumber steps also fail the suite. Retries are disabled.

## Adding a feature

1. Add focused unit tests under `tests/unit/`, naming the happy, negative, and edge cases clearly.
2. Add a `.feature` file under `tests/features/` with meaningful `Given` / `When` / `Then` scenarios. Tag scenarios or outlines `@happy`, `@negative`, or `@edge`.
3. Implement the step definitions and setup/cleanup needed to execute the scenarios. Assert observable behavior rather than returning fabricated success responses. Keep fixtures isolated and repeatable.
4. Run the tests and relevant project checks. Resolve failing, skipped, pending, and undefined cases before declaring completion.
5. Update `onboarding.md` with commands, results, scope, gaps, and the next action.

Current coverage includes health behavior, TypeScript client API sequencing/error handling, email authentication, password/identity validation, session creation/rotation/revocation/expiry, inactive users, cookie/CSRF rules, rate limits, Google ID-token verification, browser-bound single-use OAuth flows, returning Google identities, and prevention of automatic email-based account linking. See [authentication details](../docs/AUTHENTICATION.md). Automated scenarios exercise HTTP behavior; interactive browser rendering and real Google consent are not covered.

Runner references: [Node.js test reporters](https://nodejs.org/docs/latest-v24.x/api/test.html#test-reporters) and [Cucumber.js configuration](https://github.com/cucumber/cucumber-js/blob/v13.3.0/docs/configuration.md).
