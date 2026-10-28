# Secure P2P Asset Transfer System

The [unified testnet wallet](docs/TESTNET_WALLET.md) connects Sepolia setup, ownership verification, native ETH/ERC-20 balances, faucet funding, wallet-approved sending and indexed chain receipts. Existing simulated assets remain available as legacy demo data.

A TypeScript workspace for a server-coordinated simulation of peer-to-peer asset transfers, with MongoDB persistence, a transfer audit chain, and direct chat.

The implementation includes authentication, wallets, atomic demo transfers, participant Activity/receipts, pending discovery, consumer tasks, typed configuration, tracked administrator requests, session security, notifications and read-only verification jobs. [Core demo enhancements](docs/DEMO_ENHANCEMENTS.md) describes the P00–P08 boundaries; current test and live-delivery evidence is in [onboarding.md](onboarding.md). Live recovery email is disabled by user choice. EVM settlement, a global chain explorer and chat remain later work.

See [authentication setup and API documentation](docs/AUTHENTICATION.md) to configure Google and review session behavior.

The [approved high-level design](docs/HIGH_LEVEL_DESIGN.md) defines the implementation scope and sequence.

The [business/API HLD](docs/BUSINESS_API_ENHANCEMENT_HLD.md), [consumer experience plan](docs/CONSUMER_EXPERIENCE_PLAN.md) and [delivery plan](docs/ENHANCEMENT_DELIVERY_PLAN.md) retain the design and package acceptance criteria. Use the [implementation architecture](docs/DEMO_ENHANCEMENTS.md) and handover for actual supported contracts and verification; a roadmap entry alone does not establish live availability.

The [wallet/asset overhaul HLD](docs/WALLET_ASSET_OVERHAUL_HLD.md) and [LLD](docs/WALLET_ASSET_OVERHAUL_LLD.md) define the full target. Users can name their wallet, select a default asset and [prove ownership of an external EVM address](docs/NETWORKS.md). Administrators configure demo assets/issuance, local/testnet networks, supported product policies, access/audit and repeatable demo data. V2 sends and participant custody use explicit local migration. See [wallet architecture](docs/WALLETS.md), [custody](docs/CUSTODY.md) and [administration setup](docs/ADMINISTRATION.md). Existing data is never silently migrated. Real EVM balances/settlement and mainnet activation remain pending.

The [Wallet and Transfer HLD](docs/WALLET_AND_TRANSFER.md) defines boundaries, APIs, exact quantities, atomic settlement, idempotency and recovery. The [implementation design](docs/WALLET_AND_TRANSFER_LLD.md) records the concrete contracts and assignments; the [implementation handoff](docs/WALLET_AND_TRANSFER_IMPLEMENTATION.md) retains the work packages and required test matrix.

## Project layout

```text
apps/
  api/src/
    config/          Validated environment configuration
    database/        Official MongoDB driver lifecycle and readiness checks
    health/          Liveness and readiness endpoints
    modules/
      auth/          Email/Google sign-in, sign-up, cookie sessions, CSRF and throttling
      accounts/      Asset catalogue, balances, peer lookup and demo issuance
      transfers/     Validation, durable requests and atomic execution
      ledger/        Double-entry records and reconciliation
      chain/         Hash-linked transfer history and integrity checks
      chat/          Conversations and messages (reserved)
    workers/         Pending transfer recovery and durable outbox storage
  web/               React + Vite development client
packages/
  contracts/         Shared API response types
tests/               Unit tests and Cucumber functional scenarios
scripts/             Windows bootstrap, database management, smoke checks
docs/                Architecture and setup verification
compose.yaml         Alternative development database via Docker
```

## Windows quick start

The bootstrap installs pinned Node.js 24.22.1 and MongoDB Community 8.0.34 under `.tools/`, verifies their published SHA-256 checksums, creates `.env` if absent, installs dependencies, and builds the workspace. It requires Windows x64, PowerShell 5.1+, internet access, and MongoDB's platform prerequisites. It does not change system PATH or install a Windows service. Close other applications using ports 3000, 5173, or 27017 first.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/db.ps1 start
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/npm.ps1 run dev
```

Open <http://localhost:5173>. The development client reports whether the API and replica set are available. The API listens at <http://localhost:3000/api>. Both application servers bind to loopback.

In another PowerShell terminal, verify the setup:

```powershell
.\scripts\npm.ps1 run check
.\scripts\db.ps1 verify
.\scripts\npm.ps1 run smoke
```

`db.ps1 verify` exercises a real committed transaction and an aborted transaction in a uniquely named temporary collection, then removes that collection. `smoke` requires both application servers to be running and checks the HTTP endpoints and Vite proxy.

Stop application servers with Ctrl+C. Stop the portable database without deleting its data:

```powershell
.\scripts\db.ps1 stop
```

Data and logs live under `.local/mongodb/`; `.tools/`, `.local/`, `.cache/`, `.env`, build output, and dependencies are ignored by Git. Rerunning setup preserves existing `.env` and database files. Interrupted downloads with an invalid checksum must be removed from `.tools/downloads/` before retrying.

If your PowerShell execution policy blocks scripts, use the process-scoped `powershell -NoProfile -ExecutionPolicy Bypass -File ...` form above. For a terminal that prefers the local runtime for the rest of its session:

```powershell
. .\scripts\use-tools.ps1
node --version
npm run dev
```

The wrapper `scripts/npm.ps1` always uses the local Node.js installation. A plain `npm` command in a new terminal may use an older system installation.

## Docker alternative and other platforms

With supported Node.js 24, npm 11, and Docker Engine/Desktop with Compose installed, use the same workspace without the Windows bootstrap:

```sh
cp .env.example .env
npm ci
npm run build
npm run infra:up
npm run db:verify
npm run dev
```

On PowerShell, replace `cp` with `Copy-Item`. Choose either portable MongoDB or Docker for port 27017. `infra:up` waits for MongoDB to accept commands and then initializes `rs0`; the command is safe to rerun. `npm run infra:down` stops Docker without deleting its named volume. Docker is optional for Windows local development.

The single replica member advertises `127.0.0.1:27017` for clients running on the host. This configuration is not intended for containerized application clients. Database bootstrap/stop scripts target the local database only; they never initialize a configured remote database.

## Environment and health

Copy `.env.example` to `.env` and keep actual credentials out of source control. The API validates configuration at startup. Shell environment variables take precedence over the file.

| Variable               | Purpose                                                 |
| ---------------------- | ------------------------------------------------------- |
| `NODE_ENV`             | `development`, `test`, or `production`                  |
| `API_PORT`             | API listen port, default 3000                           |
| `WEB_ORIGIN`           | Allowed browser origin, default `http://localhost:5173` |
| `MONGODB_URI`          | Driver connection string with replica set configuration |
| `MONGODB_DB`           | Application database name                               |
| `MONGODB_REPLICA_SET`  | Expected replica set name, default `rs0`                |
| `SESSION_TTL_SECONDS`  | Session lifetime; defaults to 7 days                    |
| `GOOGLE_CLIENT_ID`     | Optional Google web client ID                           |
| `GOOGLE_CLIENT_SECRET` | Optional Google client secret, server only              |
| `GOOGLE_REDIRECT_URI`  | Optional registered `/api/auth/google/callback` URL     |

Vite's development proxy targets port 3000. If changing `API_PORT`, update `apps/web/vite.config.ts` too. Readiness returns 503 when the database is unavailable, the set name differs, or no writable primary is reachable. API startup requires an initial database connection; liveness is available after successful startup.

| Endpoint                | Purpose                                                 |
| ----------------------- | ------------------------------------------------------- |
| `GET /api/health/live`  | API process is serving requests                         |
| `GET /api/health/ready` | MongoDB connectivity and writable replica set readiness |

Development MongoDB is unauthenticated and bound/exposed only to loopback. This setup is for local development; production requires credentials, TLS, restricted access, and a redundant deployment. Email authentication needs no external account. Enable Google by configuring all three optional Google variables, as described in the authentication guide.

## Development commands

Before implementation, follow [AGENTS.md](AGENTS.md) and [orchestrator.md](orchestrator.md). Work directly by default; at most one subagent may be active. Keep documentation proportional: update module docs when contracts, behavior, security, configuration or architecture materially change, and maintain [onboarding.md](onboarding.md) as the concise current handover only.

Use `npm` after activating the local runtime, or replace it with `.\scripts\npm.ps1` on Windows.

| Command                           | Purpose                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `npm run dev`                     | Build shared contracts and start API/client watchers                              |
| `npm run build`                   | Compile contracts, backend, and frontend                                          |
| `npm run typecheck`               | Check TypeScript across all workspaces                                            |
| `npm run lint`                    | ESLint with zero warnings                                                         |
| `npm run format`                  | Format source/configuration/docs with Prettier                                    |
| `npm test`                        | Unit tests and Cucumber functional scenarios with JUnit XML reports               |
| `npm run test:unit`               | TypeScript unit tests using the Node.js test runner                               |
| `npm run test:functional`         | Executable Cucumber `.feature` scenarios                                          |
| `npm run test:typecheck`          | Check TypeScript test sources                                                     |
| `npm run check`                   | Lint, application/test type checks, both test suites, builds, and formatting      |
| `npm run db:verify`               | Verify local MongoDB commit/rollback support                                      |
| `npm run seed:demo`               | Explicitly create synthetic demo identities and balanced, rerunnable credits      |
| `npm run wallet:migration:assess` | Read-only legacy wallet/ledger/chain/provenance preflight; no backfill or repair  |
| `npm run wallet:migration:apply`  | Explicit offline local/demo backup, restore rehearsal and wallet/custody backfill |
| `npm run seed:wallet-demo`        | Role-authorized v2 demo profile through the same service as the UI                |
| `npm run smoke`                   | Verify running API, frontend, and proxy                                           |

Shared contracts are built before consumers. If editing contracts during development, rebuild them and restart `dev`. `npm run start -w @p2p/api` runs the compiled backend; frontend deployment will need an HTTPS reverse proxy for `/api` and future socket traffic. No hosting deployment has been configured.

Every feature requires unit tests and Cucumber scenarios covering happy flows, negative flows, and edge cases. Tests produce JUnit XML reports under `.local/test-results/`, plus a Cucumber HTML report. Unit tests and health scenarios use isolated fixtures. Auth scenarios exercise the full app and temporary databases on the local MongoDB replica set, so start it before `npm test` or `npm run check`. See [the testing guide](tests/README.md) for commands, coverage, and how to add tests.

## Local demo credits

Wallets start with zero balances. The explicit fixture command creates `demo_alice@example.invalid` and `demo_bob@example.invalid`, with handles `demo_alice` and `demo_bob`, and one balanced issuance of **1000.00 DEMO** to each. Set a local `DEMO_PASSWORD` of 12–128 characters in your shell, then run `.\scripts\npm.ps1 run seed:demo` or `npm run seed:demo` after activating the project runtime. Sign in with either synthetic email and that password, then look up the other handle to transfer credits.

The command builds the API first and refuses production mode, remote or credentialed MongoDB URIs, nonstandard ports, and databases outside its allowlist. Development targets are `p2p_offgrid` and `p2p_offgrid_demo`; automated fixtures use uniquely named `p2p_transfer_test_<32 hex>` databases. Existing synthetic identities must match the supplied password; the command never resets passwords or spent balances. Repeating an issuance key with matching content has no financial effect. No assets or credits are created automatically during startup, registration or sign-in. Keep `DEMO_PASSWORD` out of source control and use it only for these synthetic identities.

## Prerequisite references

- [Node.js release archive](https://nodejs.org/dist/v24.22.1/) and its [SHA-256 manifest](https://nodejs.org/dist/v24.22.1/SHASUMS256.txt).
- [MongoDB official release manifest](https://downloads.mongodb.org/current.json) and [Windows installation prerequisites](https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-windows/).
- [NestJS prerequisites](https://docs.nestjs.com/first-steps) and [Vite prerequisites](https://vite.dev/guide/).
