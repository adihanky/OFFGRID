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

Unit tests require no running services and run one file at a time to bound memory use and avoid competing Nest/TypeScript startup work on local machines. Functional tests start a NestJS HTTP server on an operating-system-assigned loopback port for each scenario and close it afterward. Health scenarios use controlled MongoDB command responses. Auth scenarios require the local `rs0` replica set and use the full application with real validators/indexes and a generated `p2p_auth_test_<random-id>` database per scenario; only Google's network and verification keys are mocked. Databases are dropped after each auth scenario after validating the generated name. No external accounts or existing application servers are required. This does not replace the real MongoDB transaction check (`scripts/db.ps1 verify`) or the running application smoke check.

For focused runs after activating the local runtime (`. .\scripts\use-tools.ps1`), use `node scripts/test.mjs functional --tags @auth` or `--tags @health`; the health-only run does not need MongoDB.

The `@wallet_browser` scenarios additionally require installed Chrome. They use `playwright-core` with a temporary Vite server, real React/StrictMode and keyboard events, and intercepted synthetic API fixtures. No browser download, application database, real sign-in, or existing server is used. To use another installed Chromium browser, set `P2P_TEST_BROWSER_CHANNEL=msedge` or `P2P_TEST_BROWSER_EXECUTABLE` to its executable path. Missing browsers fail the suite rather than skipping scenarios. Run just these scenarios with `node scripts/test.mjs functional --tags '@wallet_browser'` after activating the project runtime.

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

## Wallet and Transfer coverage

`wallet-delivery.feature` covers explicit migration, preserved financial evidence, reconstructed provenance, rollback, setup/role/CSRF enforcement, asset revision/cap rules, deterministic seeding with spending preservation and restart after a lost acknowledgement, and scoped custody pagination. `wallet-live-browser.feature` runs Chrome against a temporary Vite proxy, the real Nest API and a disposable MongoDB database. It exercises actual signup/setup, draft/activation/issuance, a v2 payment to a logged-out recipient, activity, access/audit, seed forms, unknown recipients, insufficient funds and expired reviews. These scenarios do not intercept API requests. Screenshots are written under `.local/test-results/wallet-delivery/`. They complement the separately recorded check on the user's running `localhost:5173` service.

Overhaul coverage adds `wallet-overhaul-data.feature` (read-only legacy assessment, quantities and strict contracts), `wallet-ownership.feature` (atomic signup, exact registered recipients, schema ownership and live roles), `custody.feature` (roots, splits, merges, tamper and rollback) and `transfer-v2.feature` (reviewed sends, versioned idempotency, scoped outcomes and recovery). Matching TypeScript unit suites produce JUnit reports. Existing transfer scenarios now assert custody correspondence and rollback for newly created assets. These use synthetic disposable databases; existing-data migration, real chain settlement and admin UI operations remain unimplemented. See [wallet](../docs/WALLETS.md) and [custody](../docs/CUSTODY.md) architecture for the current boundary.

The unit suites and executable `wallet.feature`, `transfers.feature`, `transfer-recovery.feature` and `transfer-client.feature` cover exact quantities, authorization/CSRF, balanced issuance, idempotency, competing debits, recipient overflow, atomic rollback, chain/outbox correspondence and stale-worker recovery. Client regressions cover frozen request identity, session changes, lost responses and interrupted JSON bodies. See the [scenario map](../docs/WALLET_AND_TRANSFER_QA.md) for locations, evidence limits and current verification.

`tests/support/transfer-harness.mts` uses independent participant jars, real replica-set transactions, generated `p2p_transfer_test_<32 hex>` databases and guarded cleanup. Controlled identities still traverse the real session guard and CSRF checks. Failure injection stays in those disposable databases. The ambiguous-commit scenario wraps the real driver's commit method and loses one acknowledgement after a real commit; this is injected driver evidence, not actual network failover. The `transfer-client.feature` scenarios exercise helpers with controlled HTTP responses. `wallet-browser.feature` adds actual Chrome rendering and input/review/confirmation/refresh interactions, including missing, disabled, loading and failed wallet responses. These intercepted browser scenarios complement the real HTTP/database scenarios; they do not prove the complete browser-to-database path. Network failover, process termination and load tests require separate evidence.
