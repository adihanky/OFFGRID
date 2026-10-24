# Secure P2P Asset Transfer System

A TypeScript workspace for a server-coordinated simulation of peer-to-peer asset transfers, with MongoDB persistence, a transfer audit chain, and direct chat.

Current phase: project foundation. The React client, NestJS API, configuration, MongoDB connectivity, health endpoints, and development tooling are implemented. Authentication, wallet operations, transfers, history, chain execution, and chat are reserved modules; they do not expose feature endpoints yet.

The [approved high-level design](docs/HIGH_LEVEL_DESIGN.md) defines the implementation scope and sequence.

## Project layout

```text
apps/
  api/src/
    config/          Validated environment configuration
    database/        Official MongoDB driver lifecycle and readiness checks
    health/          Liveness and readiness endpoints
    modules/
      auth/          Sign up, sign in, sessions (reserved)
      accounts/      Asset balances and peer lookup (reserved)
      transfers/     Validation and atomic execution (reserved)
      ledger/        Double-entry records (reserved)
      chain/         Hash-linked transfer history (reserved)
      chat/          Conversations and messages (reserved)
    workers/         Outbox and recovery work (reserved)
  web/               React + Vite development client
packages/
  contracts/         Shared API response types
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

| Variable              | Purpose                                                 |
| --------------------- | ------------------------------------------------------- |
| `NODE_ENV`            | `development`, `test`, or `production`                  |
| `API_PORT`            | API listen port, default 3000                           |
| `WEB_ORIGIN`          | Allowed browser origin, default `http://localhost:5173` |
| `MONGODB_URI`         | Driver connection string with replica set configuration |
| `MONGODB_DB`          | Application database name                               |
| `MONGODB_REPLICA_SET` | Expected replica set name, default `rs0`                |

Vite's development proxy targets port 3000. If changing `API_PORT`, update `apps/web/vite.config.ts` too. Readiness returns 503 when the database is unavailable, the set name differs, or no writable primary is reachable. API startup requires an initial database connection; liveness is available after successful startup.

| Endpoint                | Purpose                                                 |
| ----------------------- | ------------------------------------------------------- |
| `GET /api/health/live`  | API process is serving requests                         |
| `GET /api/health/ready` | MongoDB connectivity and writable replica set readiness |

Development MongoDB is unauthenticated and bound/exposed only to loopback. This setup is for local development; production requires credentials, TLS, restricted access, and a redundant deployment. No session secret or external account is needed at this scaffold stage.

## Development commands

Use `npm` after activating the local runtime, or replace it with `.\scripts\npm.ps1` on Windows.

| Command             | Purpose                                              |
| ------------------- | ---------------------------------------------------- |
| `npm run dev`       | Build shared contracts and start API/client watchers |
| `npm run build`     | Compile contracts, backend, and frontend             |
| `npm run typecheck` | Check TypeScript across all workspaces               |
| `npm run lint`      | ESLint with zero warnings                            |
| `npm run format`    | Format source/configuration/docs with Prettier       |
| `npm run check`     | Lint, type checking, builds, and format validation   |
| `npm run db:verify` | Verify local MongoDB commit/rollback support         |
| `npm run smoke`     | Verify running API, frontend, and proxy              |

Shared contracts are built before consumers. If editing contracts during development, rebuild them and restart `dev`. `npm run start -w @p2p/api` runs the compiled backend; frontend deployment will need an HTTPS reverse proxy for `/api` and future socket traffic. No hosting deployment has been configured.

## Prerequisite references

- [Node.js release archive](https://nodejs.org/dist/v24.22.1/) and its [SHA-256 manifest](https://nodejs.org/dist/v24.22.1/SHASUMS256.txt).
- [MongoDB official release manifest](https://downloads.mongodb.org/current.json) and [Windows installation prerequisites](https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-windows/).
- [NestJS prerequisites](https://docs.nestjs.com/first-steps) and [Vite prerequisites](https://vite.dev/guide/).
