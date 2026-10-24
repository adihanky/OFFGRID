# Project onboarding and chat handoff

Last updated: 24 October 2026 (Asia/Calcutta).

This is the shared handoff document for work across agents and chats. Read it first, then check the actual repository state. Update it before finishing each work session that changes the project, including documentation work, so the next agent or chat can continue without reconstructing earlier conversations. [AGENTS.md](AGENTS.md) defines the repository-wide rules for this workflow.

## Current snapshot

| Item                          | State                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| Project                       | Secure P2P Asset Transfer System                                                                    |
| Repository                    | <https://github.com/adihanky/OFFGRID>                                                               |
| Local workspace               | `D:\P2P-OFFGRID`                                                                                    |
| Main branch                   | `main`                                                                                              |
| Active feature branch         | `feature/Auth` (case-sensitive spelling)                                                            |
| Published baseline            | `24b3a90` - `chore: scaffold secure P2P asset transfer workspace`                                   |
| Published authentication      | `b2bf0f8` - `feat(auth): add Google and email authentication with scenario tests` on `feature/Auth` |
| Remote tracking               | `main` tracks `origin/main`; `feature/Auth` tracks `origin/feature/Auth`                            |
| Completed work                | Foundation, agent/test rules, email/Google authentication, sessions, client screens and tests       |
| Next module                   | Accounts, balances, peer lookup and controlled demo fixtures                                        |
| Authentication implementation | Implemented; Google settings loaded and local redirect verified; real consent remains unverified    |

The foundation baseline was pushed to both branches. Authentication, tests, agent rules, module architecture documentation, and this handover were committed and pushed to `feature/Auth` as `b2bf0f8`. The `main` branch retains the foundation baseline. Branch tips, working-tree changes, running services, and account sign-in are live state: check them rather than assuming this snapshot is still current.

## First steps in a new chat

1. Read this file, the [README](README.md), and the [approved high-level design](docs/HIGH_LEVEL_DESIGN.md).
2. Check for applicable `AGENTS.md` instructions and inspect the working tree before editing:

   ```powershell
   git status --short --branch
   git branch -vv
   git remote -v
   git log -5 --oneline
   ```

3. Preserve any existing user changes. Continue authentication work on `feature/Auth`; avoid switching branches over uncommitted work without first reviewing it.
4. Check local prerequisite availability and start services only when needed. Previous development processes may have stopped.
5. Follow the current user request. The next-module plan below is context, not a request to implement it automatically.
6. At the end of the work, update the snapshot, feature tracker, checks, open issues, and handoff log in this file.

Suggested prompt for a future chat: `Read onboarding.md and the approved design, inspect the current branch, then continue the authentication module on feature/Auth.`

## Approved architecture and scope

- React and TypeScript client; NestJS and TypeScript backend using native ES modules.
- MongoDB with the official driver and a replica set for multi-document transactions.
- Start as a modular monolith. Background outbox delivery, recovery, and reconciliation will share the backend codebase.
- Assets are simulated fungible units. P2P means user-to-user transfers coordinated by a trusted server.
- Transfers settle immediately after validation. Balances use exact integer base units, not floating-point arithmetic.
- A committed transfer must atomically update sender and recipient balances, balanced ledger entries, the hash-linked chain, its final status, and an outbox event.
- Request idempotency and conditional balance updates must prevent duplicate execution and overspending.
- The chain is a hash-linked audit history, not decentralized blockchain consensus. Stronger protection against a privileged database rewrite needs externally retained checkpoints.
- Planned chat is server-mediated with Socket.IO, persistence, participant authorization, and reconnect recovery. Socket.IO integration is not implemented yet.
- Server connectivity is required. Offline settlement, real payments, cryptocurrency settlement, unique assets, escrow, and end-to-end encrypted chat are outside the approved MVP.

See the design for the complete schemas, indexes, APIs, consistency rules, and implementation phases. Do not treat those planned components as already implemented.

## Module architecture index

Each module implemented or changed must have its own architecture Markdown file under `docs/`, maintained alongside the code as required by [AGENTS.md](AGENTS.md). Read the relevant document before changing a module and update its entry here after the work. Add entries as modules are implemented or changed; planned modules remain in the feature tracker until then.

| Module         | Architecture document                            | Implementation / documentation status                                                                                                       |
| -------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication | [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) | Implemented; component map, dependencies, flows, data model, APIs, configuration, protections, decisions, tests, and limitations documented |

## Code map

| Path                              | Purpose and current state                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `AGENTS.md`                       | Repository-wide handover, feature testing, and per-module architecture documentation rules                         |
| `onboarding.md`                   | Shared project state, decisions, validation, and handoff for the next agent or chat                                |
| `apps/api/src/main.ts`            | API bootstrap and shutdown; shared HTTP setup in `configure-http.ts` also used by auth scenarios                   |
| `apps/api/src/config/`            | Validated environment loading from the root `.env`                                                                 |
| `apps/api/src/database/`          | MongoDB client lifecycle and replica set readiness                                                                 |
| `apps/api/src/health/`            | Working liveness and readiness routes                                                                              |
| `apps/api/src/modules/auth/`      | Email/Google auth, MongoDB store/validators/indexes, revocable sessions, exported guard, CSRF and throttling       |
| `apps/api/src/modules/accounts/`  | Account/balance module placeholder                                                                                 |
| `apps/api/src/modules/transfers/` | Transfer execution module placeholder                                                                              |
| `apps/api/src/modules/ledger/`    | Ledger module placeholder                                                                                          |
| `apps/api/src/modules/chain/`     | Transfer-chain module placeholder                                                                                  |
| `apps/api/src/modules/chat/`      | Chat module placeholder                                                                                            |
| `apps/api/src/workers/`           | README describing future workers; no executing jobs                                                                |
| `apps/web/`                       | React/Vite health display plus email/Google sign-in, registration, session restoration and sign-out                |
| `packages/contracts/`             | Shared liveness/readiness response types                                                                           |
| `scripts/`                        | Windows bootstrap, local runtime selection, database lifecycle, and verification                                   |
| `scripts/test.mjs`                | Unit/Cucumber suite runner; rejects empty, failed, or skipped JUnit reports                                        |
| `tests/`                          | TypeScript unit tests, Cucumber features/steps, shared fixtures, and testing guide                                 |
| `cucumber.mjs`                    | Cucumber.js discovery, strict mode, and JUnit XML/HTML reporting                                                   |
| `compose.yaml`                    | Optional local MongoDB container configuration                                                                     |
| `docs/HIGH_LEVEL_DESIGN.md`       | User-approved architecture                                                                                         |
| `docs/SETUP_VERIFICATION.md`      | Historical foundation verification record                                                                          |
| `docs/AUTHENTICATION.md`          | Dedicated auth architecture, component/data-flow map, setup, API, protections, decisions, tests and remaining work |

Authentication endpoints, user/session schemas, validators, and indexes are implemented. Balance, transfer, ledger, chain, and chat feature endpoints and demo account fixtures remain planned. The auth store creates or updates validators and indexes before accepting traffic.

## Local prerequisites and commands

The Windows bootstrap installed Node.js **24.22.1**, npm **11.19.1**, and MongoDB Community **8.0.34** under `.tools/`. The system Node.js **16** was left unchanged. Prefer the project wrapper so a new terminal does not accidentally use the older runtime.

Pinned application/tooling versions at foundation: NestJS **12.2.0**, React **19.3.1**, Vite **8.3.5**, TypeScript **6.0.3**. Check package manifests and `package-lock.json` for subsequent changes.

From the workspace root, use this for a fresh installation or missing prerequisites:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup.ps1
```

For an existing setup:

```powershell
.\scripts\db.ps1 start
.\scripts\npm.ps1 run dev
```

In another terminal, run the checks relevant to the work:

```powershell
.\scripts\npm.ps1 run check
.\scripts\db.ps1 verify
.\scripts\npm.ps1 run smoke
```

- `check`: lint, application/test TypeScript checks, unit tests, Cucumber functional scenarios, builds, and formatting validation.
- `test`: both test suites; `test:unit` and `test:functional` run them individually. Use the project npm wrapper as above. Start the local MongoDB replica set before `test`, `test:functional`, or `check`; auth scenarios use real temporary databases. Unit tests and health-only scenarios require no running services.
- `test:typecheck`: checks TypeScript test sources. Test execution uses tsx with `tests/tsconfig.json`, which includes API source files so NestJS parameter decorators compile correctly.
- Reports: `.local/test-results/unit.xml`, `functional.xml`, and `functional.html`. Generated output is ignored by Git. See [tests/README.md](tests/README.md).
- `db.ps1 verify`: real transaction commit and rollback in a temporary collection, removed afterward.
- `smoke`: API health, a security header, frontend HTML, and the Vite-to-API proxy. Requires both servers and the database to be running.
- Stop development servers with Ctrl+C. Stop portable MongoDB with `.\scripts\db.ps1 stop`; data is retained.
- If execution policy blocks a script, use `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/<name>.ps1 ...`.
- To use plain `npm` with the project runtime in the current terminal: `. .\scripts\use-tools.ps1`.

| Endpoint                                 | Purpose                                                              |
| ---------------------------------------- | -------------------------------------------------------------------- |
| <http://localhost:5173>                  | Web client                                                           |
| <http://localhost:3000/api/health/live>  | API liveness                                                         |
| <http://localhost:3000/api/health/ready> | Writable MongoDB replica set readiness                               |
| `127.0.0.1:27017`                        | Local MongoDB, replica set `rs0`, application database `p2p_offgrid` |

Readiness returns HTTP 503 for unavailable MongoDB, a replica set mismatch, or no writable primary. API startup requires an initial database connection.

## Configuration and operational notes

- `.env.example` is tracked; `.env` is local and ignored. Never copy credentials, session tokens, or private message contents into documentation or logs.
- `.tools/`, `.cache/`, `.local/`, `node_modules/`, and build output are ignored. MongoDB data/logs are under `.local/mongodb/`.
- Bootstrap verifies the pinned official archive checksums and preserves an existing `.env`. Existing lockfiles are installed with `npm ci`; stop development processes before reinstalling dependencies on Windows.
- The development MongoDB server is unauthenticated and loopback-only. It is not a production deployment.
- Docker is not installed on the original machine. The optional Compose route is documented but has not been exercised. Choose portable MongoDB or Docker for port 27017, not both.
- The Vite proxy targets API port 3000. Update the proxy if changing `API_PORT`.
- Shared contracts must be built before consumers. Rebuild contracts and restart development watchers after changing them.
- The root `multer: 2.5.0` override addresses the foundation dependency audit finding. Keep it until a verified upstream dependency update makes it unnecessary. esbuild's install script is approved for its pinned version.
- GitHub pushes succeeded after browser sign-in through Git Credential Manager. If credentials expire, authenticate through the supported sign-in flow; never request tokens in chat or embed them in the remote URL.
- In the original Codex environment, Git operations and loopback checks needed escalated execution after sandbox failures. This was an execution-environment issue, not an application prerequisite.
- No hosting deployment or production environment is configured.
- Auth configuration: `SESSION_TTL_SECONDS` defaults to seven days. Google is optional; configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` together. The development callback should be `http://localhost:5173/api/auth/google/callback` through Vite's proxy. See `docs/AUTHENTICATION.md`; do not copy actual credentials here.
- Auth scenarios generate a separate `p2p_auth_test_<random-id>` database for each scenario and remove it after checking the generated name. The application's database is not used for fixtures. Only Google's HTTP endpoint and signing keys are substituted; local RS256 signatures and claims are actually verified.

## Feature tracker

| Feature                               | Status      | Branch / next step                                                                          |
| ------------------------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| High-level design                     | Approved    | Maintain `docs/HIGH_LEVEL_DESIGN.md` as architecture evolves                                |
| Workspace and prerequisites           | Complete    | Published baseline `24b3a90` on `main` and `feature/Auth`                                   |
| Agent handover workflow               | Documented  | Follow root `AGENTS.md`; maintain `onboarding.md` each session                              |
| Feature testing prerequisite          | Implemented | TypeScript unit tests, JUnit XML reports, and Cucumber.js health scenarios                  |
| Authentication                        | Implemented | Email/Google auth and tests; local Google configuration enabled; real consent check pending |
| Accounts and demo fixtures            | Next        | Reuse AuthGuard and session identity; add balanced demo issuance and tests                  |
| Atomic transfers and ledger           | Planned     | Add concurrency, idempotency, and failure verification                                      |
| Transfer log and chain                | Planned     | Participant-scoped history and integrity verification                                       |
| Peer chat and outbox/recovery         | Planned     | Persistent messages, authorized sockets, reliable delivery                                  |
| Deployment and performance validation | Planned     | Set targets and verify on documented infrastructure                                         |

## Authentication handoff

Implemented the requested Google OAuth 2.0 and email/password authentication. Read [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) for setup and the API contract.

- Routes under `/api/auth`: `providers`, `csrf`, `signup`, `signin`, `me`, `signout`, `google`, and `google/callback`. User responses expose only public fields; `AuthGuard` and `AuthService` are exported for future modules.
- Email/handles are normalized and unique. Passwords use Argon2id; password sign-up requires 12–128 characters and a 3–24-character public handle. Email accounts are marked unverified because inbox verification is not implemented.
- Sessions are opaque 256-bit tokens stored only as hashes, expire explicitly, rotate on sign-in, and are revoked on sign-out. Guards also reject disabled/deleted users. Cookies are HttpOnly/SameSite=Lax, and Secure with `__Host-` names in production.
- Writes require the exact configured origin and a cookie/header CSRF token; authenticated writes bind that token to the session using HMAC. MongoDB stores shared IP/email rate-limit buckets. The API currently does not trust forwarded IP headers; a verified proxy policy is needed before production deployment.
- Google flows use PKCE, state, nonce, a browser binding cookie, single-use ten-minute attempts, and verified RS256 ID tokens. Provider subjects identify returning users. Matching email does not automatically link accounts. Google access/refresh tokens are not stored.
- Client forms support email registration/sign-in, session restoration, Google navigation, useful errors, and sign-out. The Google button is unavailable until all provider settings are configured; email auth remains available.
- Happy, negative, and edge coverage lives in `tests/unit/auth*.test.mts`, `tests/unit/google-provider.test.mts`, `tests/features/auth.feature`, `tests/features/google-auth.feature`, and executable glue in `tests/steps/auth.steps.mts`.

Google settings are now present in the ignored root `.env` and loaded by the running API. Local verification confirmed provider discovery reports Google enabled and the authorization redirect uses the configured client/callback with state, nonce, and PKCE. A cancellation callback cleaned up the probe without contacting Google or creating an account. API and web servers were restarted as separate `dev:api` and `dev:web` processes; check for existing listeners before starting another dev stack.

Remaining: real Google consent and interactive browser rendering have not been exercised. Local validation does not prove that Google accepts the credentials or that the Cloud Console redirect/consent configuration matches. Email verification delivery, password reset/magic links, account linking, session management screens, and socket auth are future work. Add the same required unit/Cucumber coverage to every new feature.

## Verification baseline and open work

Foundation verification on 24 October 2026 passed lint, type checks, production builds, formatting, MongoDB commit/rollback, and HTTP/proxy smoke checks. The dependency audit reported zero vulnerabilities after the Multer patch. These are historical results; they do not prove future changes or currently running services are healthy.

Current auth plus health coverage: the final `npm run check` passed on 24 October 2026, including lint, application/test type checks, 56 unit tests, 53 Cucumber scenarios (402 steps), production builds, and formatting. Auth scenarios exercise the full application and real MongoDB validators/indexes; health scenarios use controlled database command responses. Parsed both JUnit reports: 56/53 test cases and zero failures/errors/skips; Cucumber also generated HTML. Running API/frontend/proxy smoke checks passed, including auth provider discovery, anonymous session protection, and CSRF delivery. Verified no generated auth test databases remained. Real Google consent, interactive browser behavior, Docker startup, production deployment, load testing, and transfer business invariants remain unverified.

## Handoff log

Keep newest entries first. Add the actual branch/commit or PR, concrete changes, checks with results, unresolved issues, and the next action. When correcting a stale snapshot, update the relevant section as well as recording the change here.

### 24 October 2026 - Auth feature committed and pushed

- Branch: `feature/Auth`. Commit `b2bf0f89b3f784e777775de73ceb95c5e83cb989` (`feat(auth): add Google and email authentication with scenario tests`) was successfully pushed to `origin/feature/Auth` at the user's request. `main` was not changed.
- Published 44 files covering authentication, client screens, unit/Cucumber tests and glue, test infrastructure, agent rules, architecture documentation, and this handover. This follow-up entry records the successful publication; check Git history for the latest documentation commit.
- Validation: fetched the remote feature branch and confirmed no divergent commits; checked all 44 pending files for the configured Google client ID/secret without displaying values; confirmed `.env` is ignored and untracked. Staged whitespace and documentation formatting checks passed. After the auth push, local HEAD and `origin/feature/Auth` matched exactly and the working tree was clean.
- The earlier full check remains successful: 56 unit tests and 53 scenarios / 402 steps, lint, type checks, builds, and formatting. Feature suites were not rerun for this commit/publication task because application behavior had not changed since that check.
- Next: complete real Google consent verification, then continue the next requested module with its own architecture document and required tests. Credentials remain local in `.env`.

### 24 October 2026 - Per-module architecture documentation rule

- Branch: `feature/Auth`; published baseline remains `24b3a90`. Changes remain local and uncommitted.
- Added a root `AGENTS.md` rule requiring a dedicated architecture Markdown file for each module being implemented or changed, maintained in the same session and indexed in this handover.
- Expanded the existing `docs/AUTHENTICATION.md` with responsibilities/boundaries, a component diagram and source map, dependencies, request/data flows, persistence ownership, and decisions/tradeoffs. Reused the existing auth document to keep one module reference.
- Added the module architecture index above and linked the auth document with its current implementation/documentation status.
- Validation: checked the documented auth wiring, controller/service/guard, and persistence models against source. Prettier checks for all three edited documents and `git diff --check` passed; feature suites were not rerun for this documentation-only work.
- Next: maintain the architecture document and index with future changes; create separate documents as accounts and other modules are implemented. Real Google consent verification remains open.

### 24 October 2026 - Google configuration verification

- Branch: `feature/Auth`; baseline `24b3a90`; changes remain local and uncommitted.
- User saved the three Google settings in the root `.env`. Checked presence, application schema, client ID format, and callback/web-origin alignment without displaying values. Credentials were not changed or copied into documentation.
- Restarted the verified project API watcher and restored the web server separately. Running provider discovery now reports Google enabled through both API and frontend proxy.
- Validation: local authorization returns the expected Google redirect with the configured client/callback, state, nonce, PKCE, and HttpOnly binding cookie. Consumed the probe through the cancellation callback; no external Google sign-in or account creation occurred. Existing API/frontend/proxy smoke checks passed.
- No application source behavior changed and feature suites were not rerun for this configuration check; the last full check remains the successful 56-unit / 53-scenario run below.
- Next: open the local app and complete a real Google sign-in to verify provider-side consent and callback registration. Actual credentials and real consent remain outside automated test fixtures.

### 24 October 2026 - Authentication implementation and executable scenarios

- Branch: `feature/Auth`; published baseline remains `24b3a90`. All work remains local and uncommitted; preserved earlier documentation/test setup changes.
- Implemented email/password and Google OAuth authentication, explicit validation, MongoDB identity/session schemas and indexes, hashed revocable sessions, reusable guards, CSRF, and Mongo-backed throttling. Added shared response contracts and client authentication screens/API helper.
- Added optional Google and session-lifetime configuration, exact callback/production HTTPS validation, and `docs/AUTHENTICATION.md`. Updated the approved design and README to reflect implemented behavior.
- Added unit tests plus executable email/session and Google Cucumber features/glue with happy, negative, and edge cases. Auth scenarios use real temporary MongoDB databases and locally signed Google tokens; existing health scenarios remain isolated by `@health` hooks. The runner supports focused Cucumber arguments.
- Validation: final `npm run check` passed lint, application/test type checks, all 56 unit tests and 53 scenarios / 402 steps, production builds, and formatting. JUnit reports parsed successfully with zero failures/errors/skips. Existing smoke and live frontend-proxy auth checks passed. Verified all generated auth test databases were removed; `git diff --check` passed. Dependency installation audits reported zero vulnerabilities.
- Local MongoDB is running. Actual Google credentials were neither requested nor changed. Real provider consent and browser rendering are unverified; do not claim production deployment readiness.
- Next: configure Google locally if desired and verify real consent; continue accounts/peer lookup/balanced fixtures using the exported auth guard. Maintain unit/Cucumber coverage and this handover.

### 24 October 2026 - Mandatory feature tests and test setup

- Branch: `feature/Auth`; baseline commit `24b3a90`. Changes remain local and uncommitted.
- Added the testing rule to `AGENTS.md` first: every feature requires unit tests and executable Cucumber scenarios covering happy, negative, and edge cases. User explicitly confirmed TypeScript unit tests with JUnit XML reports plus Cucumber.js, rather than a Java/JUnit suite.
- Added pinned Cucumber.js `13.3.0`, shared tsx/Node types, test configuration, isolated MongoDB fixtures, unit tests, and executable health scenarios. Added separate suite commands and included both suites and test type checking in `check`.
- Reports are generated under `.local/test-results/`; empty reports, failures, and skipped tests make the runner fail. Pending/undefined Cucumber steps fail in strict mode; retries are disabled.
- Validation: `npm run check` passed lint, application/test type checks, both suites (11 unit tests and 10 Cucumber scenarios / 69 steps), production builds, and formatting validation. Parsed both generated JUnit reports as XML: 11 and 10 test cases respectively, with zero failure/error/skip elements. Confirmed the Cucumber HTML report exists. Dependency installation audit reported zero vulnerabilities; `git diff --check` passed.
- Scope: tests exercise the existing health behavior with a real temporary HTTP server and controlled database responses. No application behavior changed. Real database, browser UI, and external OAuth integration are outside this suite's current coverage.
- Next: implement Google OAuth 2.0 and email sign-up/sign-in on `feature/Auth`, adding the required happy, negative, and edge tests in both suites. Update this handover with implementation and validation results.

### 24 October 2026 - Agent handover rules

- Branch: `feature/Auth`; baseline commit `24b3a90`. Documentation changes are local and have not been committed or pushed.
- Read the existing handover, README, approved design, and current Git state. Added root `AGENTS.md` requiring agents to start with this document and update it before finishing work.
- Updated this handover with the workflow and the user's pending Google OAuth 2.0 plus email authentication request.
- Validation: inspected branch/status/history and checked for existing `AGENTS.md` files; none existed. Prettier `--check AGENTS.md onboarding.md` passed after formatting both documents; `git diff --check` also passed. No application tests were run for this documentation-only change.
- Environment issue: sandbox process startup failed with `helper_unknown_error: setup refresh had errors`; filesystem commands needed escalated execution.
- Next: implement authentication on `feature/Auth`, including Google OAuth 2.0 and email sign-up/sign-in, and update this document with implementation and verification results.

### 24 October 2026 - Onboarding handoff

- Added this root document on `feature/Auth` for continuity across chats.
- Recorded the approved scope, code map, local setup, completed checks, and authentication starting point.
- Published baseline remains `24b3a90`; this documentation change is a separate local change until committed and pushed.
- Next: implement authentication on `feature/Auth` when the user requests it.

### 24 October 2026 - Foundation and GitHub setup

- User approved the high-level design; scaffolded the three npm workspaces and backend module boundaries.
- Installed and verified local prerequisites; added configuration, health endpoints, and development infrastructure.
- Passed the foundation checks listed above and resolved the initial dependency audit finding.
- Pushed `24b3a90` to `main` and `feature/Auth` at `adihanky/OFFGRID`; left `feature/Auth` checked out with upstream tracking.
- No authentication or other application feature logic was implemented.

### Future entry template

```text
Date / feature:
Branch and commit or PR:
Implemented or changed:
Validation commands and results:
Open issues or decisions:
Next action:
```
