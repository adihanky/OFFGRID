# Foundation verification

Verified on 24 October 2026 (Asia/Calcutta), on Windows x64.

## Installed prerequisites

| Component         | Verified version | Location                               |
| ----------------- | ---------------- | -------------------------------------- |
| Node.js           | 24.22.1          | Project-local `.tools/` runtime        |
| npm               | 11.19.1          | Bundled with the local Node.js runtime |
| MongoDB Community | 8.0.34           | Project-local `.tools/` server         |
| NestJS            | 12.2.0           | API workspace dependencies             |
| React             | 19.3.1           | Web workspace dependencies             |
| Vite              | 8.3.5            | Web build/development tooling          |
| TypeScript        | 6.0.3            | Workspace tooling                      |

The official Node.js and MongoDB archive SHA-256 values matched the pinned [prerequisite manifest](../scripts/prerequisites.json). Existing system Node.js 16 was left unchanged. Use `scripts/npm.ps1` or activate `scripts/use-tools.ps1` when working in this project.

## Completed checks

| Check                                                    | Result                                     |
| -------------------------------------------------------- | ------------------------------------------ |
| PowerShell bootstrap/management script parsing           | Passed                                     |
| MongoDB executable version check                         | Passed                                     |
| Local `rs0` initialization and writable primary election | Passed                                     |
| ESLint with zero warnings                                | Passed                                     |
| TypeScript checking across all three workspaces          | Passed                                     |
| Contracts, API, and web production builds                | Passed                                     |
| Prettier validation                                      | Passed                                     |
| Real MongoDB transaction commit and rollback             | Passed; temporary probe collection removed |
| API liveness and replica set readiness over HTTP         | Passed                                     |
| HTTP security header check                               | Passed                                     |
| Web HTML response and frontend-to-API development proxy  | Passed                                     |
| npm dependency audit after patching                      | Zero reported vulnerabilities              |

The API runs using native ES modules. Direct dependency versions and the npm lockfile are pinned. The root override selects Multer 2.5.0 to address the inherited [Multer advisory](https://github.com/advisories/GHSA-q7qp-rjg7-q26m); the initial dependency tree used 2.4.0. The required esbuild install script is approved for its pinned version in `package.json`.

## Local endpoints

- Web application: <http://localhost:5173>
- API liveness: <http://localhost:3000/api/health/live>
- API readiness: <http://localhost:3000/api/health/ready>
- MongoDB: `127.0.0.1:27017`, replica set `rs0`

Database and development HTTP checks ran outside the restricted execution sandbox to allow loopback connections. Application servers and the portable database were started for verification. These are development processes, not installed Windows services; use the [README](../README.md) commands to restart them in future sessions.

Docker is absent on this machine. The optional Compose configuration is supplied, but its container startup path was not exercised. Authentication, transfer execution, ledger/chain behavior, and chat remain future implementation work; this verification covers the foundation only.
