# Wallet and Transfer: LLD and code handoff

Status: Implementation and acceptance reference. The Wallet and Transfer source, module documents, TypeScript unit tests and executable Cucumber scenarios exist. The user authorized implementation; current verification and outstanding work are recorded in [onboarding.md](../onboarding.md). Read [AGENTS.md](../AGENTS.md), [parent HLD](HIGH_LEVEL_DESIGN.md), [module HLD](WALLET_AND_TRANSFER.md), [authentication architecture](AUTHENTICATION.md), and [test guide](../tests/README.md) before continuing.

## 1. Starting instructions for the next model

Before development, follow [orchestrator.md](../orchestrator.md). Work directly by default and use at most one subagent at a time. Expand the test matrix below into a dedicated scenario map when contracts or failure modes warrant one, then execute relevant tests after integration. The primary agent owns integration and verification.

1. Inspect branch, status, history and nested agent instructions. The historical design baseline is `feature/Auth` at `aa208f7`; verify live state and preserve existing changes.
2. Follow the current user task. For design-only work, update documents without enabling routes or changing application behavior.
3. Use the concrete [LLD](WALLET_AND_TRANSFER_LLD.md) for decisions resolved from the HLD. Preserve ledger, chain, outbox, fencing and required tests; record material scope changes in the affected design documents.
4. Update the existing [Accounts](ACCOUNTS.md), [Ledger](LEDGER.md), [Chain](CHAIN.md), [Workers](WORKERS.md), [Database](DATABASE.md) and authentication documents only when their contracts change. Keep onboarding as a concise current-state handover, not a document index or history.

## 2. Required LLD decisions and deliverables

| Topic                   | Concrete LLD output before dependent code                                                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain types            | Exact TypeScript public/domain/persistence types; BSON Long to bigint conversions; immutable/mutable fields; error union; clock and ID interfaces                                             |
| Quantities              | Bounded decimal grammar; precision 0/2/8 examples; max/min vectors; canonical units and fixed-precision formatting; explicit rejection of unsafe JSON numbers                                 |
| Assets and provisioning | Catalogue and genesis initialization; virtual zero wallets; concurrent zero-account upserts; asset status update protocol; no public issuance                                                 |
| Schemas                 | Complete MongoDB validators, index definitions/names, partial owner indexes, migration/backfill and duplicate/incompatible-data failure policy                                                |
| API                     | Exact DTOs and examples for all four routes; strict body/query/header schemas; status/error precedence; authorization projections; same-key responses before/after state changes              |
| Transaction ports       | Service/repository signatures requiring `ClientSession`; injection graph without circular module imports; transaction boundary and sequential write order                                     |
| Eligibility             | Transaction-aware Auth adapter, actual conditional revision writes, user/account/asset suspension ordering, missing/inactive participant handling, compatibility with current auth validators |
| Request identity        | Versioned canonical bytes/hash; UUID normalization; duplicate insert race; retention; replay after asset disablement; no dependence on editable handles                                       |
| State machine           | Registration, claim token/lease acquisition, takeover, commit/rejection CAS filters, known-abort handling, unknown-commit reconciliation; crash-point sequence diagrams                       |
| Driver policy           | Inspect pinned driver implementation/types for bounded retries and timeout behavior; distinguish callback deadline from commit timeout; no parallel session operations                        |
| Journal and chain       | Typed issuance/transfer references; balanced-pair validation; exact hash encoding/genesis and golden vectors; sequence bounds; cross-check and reconciliation rules                           |
| Fixtures                | Explicit command, allowed target checks, synthetic users, unique issuance keys, signed system bounds, safe reruns and conflict handling; no real credentials                                  |
| Recovery and outbox     | Process/bootstrap ownership, scheduler, leases/backoff/shutdown, event schema, event uniqueness, future delivery acknowledgement; retained backlog before sockets                             |
| Web                     | Session-state ownership, API helper boundary, form/review/result states, canonical intent/key lifecycle, same-tab reload recovery, sign-out/account-switch behavior, accessibility            |
| Operations              | Proposed setting names/defaults/bounds; initialization readiness; safe logs/metrics; rollout/rollback with no data loss; outstanding performance targets                                      |
| Acceptance              | Test IDs mapped to each invariant and failure boundary; test doubles versus real DB evidence; exact commands and expected artifacts                                                           |

Open product/operational choices to record in LLD: initial demo asset code/precision/issuance size; demo identity provisioning UX; transfer/key length limits; user-facing rejection wording; current versus snapshotted display names; polling limits and stale-pending messaging; configuration defaults and worker process layout. Proposed HLD defaults may guide these routine choices; none are implemented settings. Material scope changes require an explicit recorded decision.

## 3. Code change map

Paths marked new are proposed and must be verified before creating them. Keep the existing ESM conventions: API imports use `.js`; test helper imports use the repository's `.mjs`/tsx conventions. Do not replace the official MongoDB driver with an ORM.

| Existing boundary / path                             | Planned edits or new components                                                                                                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/contracts/src/index.ts`                    | Add or re-export Wallet, Peer, Transfer, domain error and event DTOs; strings for IDs/quantities; never expose persistence/session types                                                                           |
| `apps/api/src/modules/accounts/accounts.module.ts`   | Register/export account services; new `accounts.controller.ts`, `peers.controller.ts`, `accounts.service.ts`, `accounts.models.ts`, `accounts.validation.ts`, `mongo-accounts.store.ts`, and exact-quantity helper |
| `apps/api/src/modules/transfers/transfers.module.ts` | New controller, orchestration service, executor, validation/canonicalization, persistence contract/store, state/error types; import Auth/Accounts/Ledger/Chain and outbox provider explicitly                      |
| `apps/api/src/modules/ledger/ledger.module.ts`       | New session-required journal writer/store and reconciliation service; typed reference support for fixtures                                                                                                         |
| `apps/api/src/modules/chain/chain.module.ts`         | New canonical encoder/hash verifier and session-required append/head store; no chain HTTP explorer in initial slice                                                                                                |
| `apps/api/src/modules/auth/`                         | Add an exported narrow transaction-aware identity adapter rather than exposing credentials or writing users from Accounts; revise model/validator for eligibility revision; preserve all auth behavior             |
| `apps/api/src/workers/`                              | New outbox persistence module and pending recovery runner using Transfers executor; define scheduling/startup ownership; replace README-only state after implementation                                            |
| `apps/api/src/database/`                             | Reuse `DatabaseService.client/db`; add transaction/initialization helpers only when needed; every transaction uses this client's session                                                                           |
| `apps/api/src/app.module.ts`                         | Wire new providers/modules with explicit dependency order and initialization barriers; sibling imports alone do not export providers into each other                                                               |
| `apps/api/src/config/environment.ts`, `.env.example` | Add only LLD-approved settings with validation/defaults; update environment test fixtures/types without reading or publishing local secrets                                                                        |
| `apps/web/src/App.tsx`, `AuthPanel.tsx`, `auth.ts`   | Lift identity/session state or introduce a shared session provider; keep existing sign-up/sign-in/Google/session restoration working; share CSRF transport where useful                                            |
| `apps/web/src/` (new wallet files)                   | Wallet view, peer lookup, transfer review/outcome, exact display helpers, API client and stable intent lifecycle; use established styles and accessible forms                                                      |
| `scripts/` and root `package.json`                   | Explicit development fixture command and worker command if needed; no implicit seed on dev/start/build                                                                                                             |
| `tests/`                                             | Unit suites, executable Gherkin/steps and isolated transfer harness described below                                                                                                                                |

Existing `tests/support/auth-harness.mts` rejects non-auth paths and owns one cookie jar. Add `tests/support/transfer-harness.mts` (or safely extract shared bootstrap) with distinct caller jars and narrowly allowed local API paths. Preserve the auth harness's protections and Google mocks. Use `p2p_transfer_test_<random-id>` databases with exact generated-name validation before cleanup, and close sessions/apps in `finally` paths. Never point failure-injection tests at the application database.

## 4. Dependency-ordered implementation packages

Each package is reviewable work, not permission to call the complete module finished. Mark partial behavior honestly in all trackers.

| Order | Work package                                                                            | Required exit evidence                                                                                                                                                |
| ----- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WT-01 | LLD, module documents, contracts, exact arithmetic and canonical identity               | Frozen DTO/schema examples and golden vectors; unit and executable scenario coverage for exposed behavior                                                             |
| WT-02 | Catalogue, zero wallet reads, peer lookup, account/journal schemas, controlled issuance | Authenticated own-wallet API; minimal peer projection; rerunnable balanced fixture; happy/negative/edge unit and real-DB scenarios                                    |
| WT-03 | Chain writer, outbox writer, identity eligibility fencing, transaction ports            | Golden chain vectors; integrity and session-propagation tests; auth regressions pass; prerequisites available before transfer traffic                                 |
| WT-04 | Request registration, lease/fencing, atomic executor and status endpoint                | All invariants tested on real MongoDB; duplicate/concurrent requests; rollback at each write boundary; stable rejected outcomes; unknown commit and takeover coverage |
| WT-05 | Pending recovery and operational initialization                                         | Restart and stale-lease tests; multiple worker safety; finite retries/backoff; no abandoned admitted requests; no falsely delivered outbox events                     |
| WT-06 | Wallet/transfer UI and same-intent recovery                                             | Typed API/state tests and executable scenarios; manual browser evidence or explicit rendering gap; session changes clear private wallet state                         |
| WT-07 | Reconciliation, complete regression checks and handover                                 | Balance/journal/chain checks, both full suites/JUnit reports, project checks, docs consistent with actual implementation                                              |

WT-02 can expose a read-only wallet before transfers exist. Do not expose a successful settlement path until chain and outbox writes are inside its transaction. Automatic pending recovery is part of completing Wallet and Transfer; live socket delivery is later work. Full history filters/screens and chain explorer remain later modules. Add dedicated worker/ledger/chain documentation even when their first implementation is only the shared write path.

## 5. Mandatory test matrix

All rows require meaningful unit coverage and executable Cucumber scenarios using real implementations at the appropriate boundary. Use `@wallet` / `@transfer` plus `@happy`, `@negative`, `@edge`; no pending steps or placeholder assertions. Unit doubles test branching and scheduling, while functional tests establish HTTP/persistence outcomes.

| Area                 | Happy flow                                        | Negative flow                                                           | Edge / concurrency flow                                                                               |
| -------------------- | ------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Wallet / peers       | Own balances and exact normalized handle          | Anonymous/expired/disabled caller; unavailable peer; no private fields  | Empty catalogue, virtual zero account, mixed-case handle, other user's ID injection                   |
| Amounts              | Exact parse/display at each supported precision   | Zero/negative/exponent/JSON number/extra fields/excess precision        | One base unit; precision 0 and 8; maximum Long and overflow; values above JS safe integer             |
| Admission            | Valid confirmed request                           | CSRF/origin/key/self-transfer errors; rate limit                        | Repeated click, concurrent registration, same key for different senders                               |
| Eligibility          | Active peers/assets/accounts                      | Inactive recipient/account/asset; missing peer                          | Disable racing execution; new recipient without account; concurrent account provisioning              |
| Settlement           | Expected balances, pair, chain, outbox and status | Insufficient funds, recipient overflow                                  | Exact remaining balance; competing debits; credits racing; chain-head contention                      |
| Idempotency          | Same canonical request replays result             | Same key with different amount/asset/recipient                          | Equivalent decimal strings; lost response; pending/rejected replay; replay after asset disable        |
| Atomicity            | Successful commit observed together               | Inject failure after each debit/credit/journal/head/status/event write  | Callback retry and duplicate HTTP/worker execution; no partial effects on abort                       |
| Recovery             | Restart resumes pending request                   | Persistent outage stays pending with safe errors                        | Unknown commit; expired lease takeover; stale executor cannot reject/commit over newer attempt        |
| Authorization        | Sender status and recipient committed detail      | Third-party detail; recipient cannot inspect rejection reasons          | Unknown vs forbidden 404; sign-out after admission does not cancel; replay after reauthentication     |
| Fixtures / integrity | Balanced issuance and reconciliation              | Production/non-allowlisted target; conflicting fixture; invalid journal | Rerun has no extra credit; system lower bound; altered/missing chain or journal detected              |
| Client / events      | Review and final balance refresh                  | Validation and server rejection shown; no false success                 | Pending reload with same key; 401/account switch; timeout does not create new key; duplicate event ID |

Proposed files: `tests/unit/accounts.test.mts`, `quantity.test.mts`, `transfers.test.mts`, `transfer-client.test.mts`, `ledger.test.mts`, `chain.test.mts`, `transfer-recovery.test.mts`; `tests/features/wallet.feature`, `transfers.feature`, `transfer-recovery.feature`; matching executable steps under `tests/steps/`. Add auth regression cases in its existing suites for eligibility integration.

Example scenario specification to turn into executable steps, not an existing test:

```gherkin
@transfer @edge
Scenario: Competing transfers cannot overspend
  Given an isolated sender wallet has "10.00" units of a precision-2 asset
  And two eligible recipients have zero units of that asset
  When the sender concurrently submits two distinct requests for "7.00" units
  Then exactly one transfer is committed and one is rejected for insufficient balance
  And the sender balance is "3.00" units
  And the total recipient balance is "7.00" units
  And only the committed transfer has a ledger pair, chain entry and outbox event
```

Use deterministic barriers and injected clocks/driver boundaries where needed rather than sleep-based races. Unknown-commit tests must distinguish an actually committed transaction whose response was lost from a transaction known to abort; assert stored state and one financial effect in both recovery paths. If driver fault injection or real process-restart coverage cannot run, report the exact gap; do not claim those properties proven by mocks.

## 6. Verification and handoff procedure

For implementation, use the installed runtime and local replica set:

```powershell
.\scripts\db.ps1 start
.\scripts\npm.ps1 run test:unit
.\scripts\npm.ps1 run test:functional
.\scripts\npm.ps1 run check
.\scripts\db.ps1 verify
git diff --check
```

`check` already reruns both suites; use focused suites during development, then one final full check once code stabilizes. Verify `.local/test-results/unit.xml`, `functional.xml` and `functional.html`; record test/scenario counts and zero failures/errors/skips. Full check includes lint, application/test type checks, build and formatting. Run smoke only with actual servers started and record that prerequisite. Confirm disposable databases are cleaned up.

For documentation-only work, format/check changed Markdown, check relative links and `git diff --check`, and record that feature suites were not run because behavior did not change. Never replace historical auth results with invented wallet test results.

Before finishing, update affected module documents and status text in proportion to the change. Update onboarding once with actual branch/worktree, verified commands/results, blockers and exact next action. Replace stale status rather than appending a journal or duplicating the scenario map. Do not commit, push or deploy unless requested.
