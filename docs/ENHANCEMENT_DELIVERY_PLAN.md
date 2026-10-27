# Sequential implementation plan for future agents

Core packages P00–P08 are authorized for implementation. This plan retains the 26 October 2026 design and acceptance criteria; [implementation architecture and evidence gates](DEMO_ENHANCEMENTS.md) record current delivery status. P09/P10 remain separate scope. Packages describe sequential ownership, not a parallel agent team. Follow [AGENTS.md](../AGENTS.md) and [orchestrator.md](../orchestrator.md).

## 1. How each agent should start and finish

Read `onboarding.md`, verify the branch/worktree and exact service URL, then read the package's module documents and affected code. Preserve unrelated edits. Confirm that the user's active implementation request authorizes the selected package; a roadmap is not automatic authorization for every item. Plan requirements and happy/negative/edge scenarios before coding.

Own the package end to end: contracts, data/indexes, backend, visible frontend, tests, operations impact and handover. Work directly. At most one sequential subagent may perform a bounded review when useful; it never replaces the primary agent's verification. Do not call self-review independent review.

For every feature, add TypeScript unit tests producing JUnit XML plus executable Cucumber `.feature` scenarios and step definitions. Use disposable synthetic databases/providers. Run suites sequentially on this host; the previous handover reports an out-of-memory database interruption under concurrent test load. Actual current resource capacity must be checked.

Finish with: reviewed diff; current nonempty reports; exact-URL browser/API/persistence evidence; affected module docs; one concise update to `onboarding.md` with remaining work and exact next action. Never describe a source implementation or health response as live delivery.

## 2. Delivery order and package contracts

Dependency path: **P00 → P01 → P02 → P03 → P04 → P05 → P06 → P07 → P08**. This is the recommended sequence for the demo product; P09 is the separate chain-payment release and P10 optional chat. Some packages could technically be independent, but execution remains sequential under repository rules. A package too large for one session may split into backend and UI handoffs; keep it unfinished until both are integrated and verified.

| Package / role                                | Inputs and affected boundary                             | Deliverables and acceptance gate                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P00 — Baseline owner                          | Handover, all current modules/tests, live URL            | Run current full regression sequentially; inspect reports; record active served version/data target and migration marker. Triage any failures before enhancement work. Preserve existing balances and v1/v2 replay identities. Output a measured baseline, not a redesign.                                                                      |
| P01 — Business API architect                  | B03/B04/B09; Transfers, Chain, Custody, contracts        | Add scoped transfer history, filtered pagination, committed receipt and authorized evidence detail; include old v1 and new v2. Deliver Activity UI with pending/rejected sends and committed receipts. Clear browser storage, sign in again and recover a known admitted transfer.                                                              |
| P02 — Consumer experience owner               | B01/B02/B07; P01, App/navigation/Wallet/Auth             | Add workspace readiness/capabilities, Home, task routes, safe exits, inline retry and identity-scoped draft state. Preserve old bookmarks and recipient/amount edit behavior. Zero-balance users get Receive guidance; request actions appear only after P05 exists. Verify configuration changes cannot destroy another task's editable draft. |
| P03 — Configuration architect                 | B06; existing Admin/Wallet/Networks and policy constants | Inventory supported settings; add typed current values, revisioned validate/publish/audit and reader integration. Defaults preserve current behavior. Define role ownership and application timing; test concurrent publication and worker refresh. Unsupported chain/security knobs remain unavailable.                                        |
| P04 — Configuration experience owner          | P03; AdminPanel, NetworkAdminPanel, WalletSetupPanel     | Deliver searchable role-appropriate overview and guided editors, preview/diff, stale-form recovery, effective revision and history. Include existing settings without replacing working routes. Every supported key has UI → API → persisted readback evidence; secrets/deployment roots follow HLD boundaries.                                 |
| P05 — Consumer support/domain owner           | B02/B07; P02/P04, Admin issuance/access                  | Implement access/demo-allocation requests, review queues and linked domain decisions with durable idempotency. Consumers can track the outcome; denied requests have safe exits. Approval invokes existing grant/issuance services and cannot double-credit on retry/crash. Add configured support routes with no hardcoded real contact data.  |
| P06 — Identity recovery owner                 | B05; Auth, provider adapter and Settings                 | Implement password reset, verification delivery, session list/revocation and security UI. Resolve existing unverified-email and provider-only-account policy before enabling recovery. Controlled delivery fixtures cover expiry/replay/enumeration/session revocation; no real external sign-in or inbox in automated tests.                   |
| P07 — Notifications/operations owner          | B08; outbox, recovery, P01/P03                           | Add leased outbox consumer, deduplicated inbox, read state, polling and operations overview. Add bounded read-only verification jobs/progress. Delivery/restart failure never changes financial outcomes. No arbitrary repair endpoint; seeded historical notification boundary explicit.                                                       |
| P08 — Integration/release owner               | All P00–P07; existing users and synthetic journeys       | Complete current full check, migration rehearsal on copy, failure/restart drill, browser acceptance and accessibility/usability review. Record unresolved limits. Release demo consumer scope only when evidence meets all gates; source changes alone do not pass.                                                                             |
| P09 — EVM settlement architect, later release | B10; existing overhaul HLD/LLD and Networks              | Implement local-chain balance/intent/transaction verification/observer, then testnet evidence, replacement/reorg/finality and provider recovery. Add honest freshness/gas UI and supported policy editors. Mainnet requires a separately authorized release/readiness decision; no paid automated transactions.                                 |
| P10 — Conversation owner, optional            | B11; parent HLD, P06/P07                                 | Implement participant-authorized conversations/messages, duplicate suppression, delivery and reconnect. Verify revoked sessions lose access. Chat must never become a prerequisite for receiving an asset.                                                                                                                                      |

### Explicit implementation boundaries

- P01 extends `TransfersV2Controller`, outcome projection and shared contracts; do not infer failed/pending transfers from custody. Register static routes without shadowing `:id` routes. Use bounded indexes and recheck participant authorization on every request.
- P02 separates route state, query state, editable draft and admitted intent. Moving from hidden mounted panels must not stop recovery or leak a previous user's state. Maintain focus and browser history behavior covered by `workspace-navigation.feature`.
- P03 owns typed policies; P04 owns their interaction design. They are one feature boundary for delivery claims: a stored editor value is unfinished until domain readers use it and the UI shows the effective revision.
- P05 uses ASSET_ADMIN issuance and ACCESS_ADMIN grants as actually implemented. A request grant cannot broaden its own authority. If domain operations cannot share one transaction, use a durable intermediate state and stable operation key with reconciliation.
- P06 does not add automatic email/Google identity merging. A reset link cannot become a generic account takeover path. Delivery integration and masked configuration are prerequisites, not assumed services.
- P07 preserves attempt-token fencing and unknown-outcome recovery. Existing `deliveredAt: null` is a backlog to process deliberately, not a flag to bulk mark complete.
- P09 follows existing `POST /transfers/:id/prepare` and `/transactions` target contracts; keep separate settlement modes and immutable network/contract identity. Reconcile older design-route differences before implementation; preserve current deployed admin/seed endpoints.

## 3. Required scenario matrix

These are specifications for future executable tests, not existing test results. Every row requires both meaningful unit coverage and Cucumber scenarios with executable definitions; browser cases must assert visible outcomes and actual persisted results where relevant.

| Package | Happy                                                                                                    | Negative                                                                                                              | Edge / regression                                                                                                                                  |
| ------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| P01     | Sender/recipient find completed transfer; pending sender opens original outcome; receipt matches journal | Stranger cannot list/detail/export; recipient cannot see rejected attempt; malformed cursor rejected                  | Equal timestamps; status changes across pages; legacy v1; lost acknowledgement; fresh sign-in without local storage; archived asset still readable |
| P02     | First-use Home points to next action; Back/reload/deep links work; draft survives task/settings change   | Service/permission failure has inline recovery and Home; session expiry clears private content                        | Empty/paused assets retain editable fields; storage unavailable; 360px keyboard navigation; unknown bookmark; account switch                       |
| P03     | Default policy preserves existing behavior; validated publish changes actual admission rules             | Unauthorized key/scope, out-of-range values, missing CSRF, unsupported adapter rejected                               | Two writers race; save acknowledgement lost; active review invalidated; terminal replay unchanged; stale worker/cache; audit rollback              |
| P04     | Authorized user discovers/edits/verifies each supported setting                                          | Invalid form fields and stale revision retain input; ordinary user cannot publish                                     | Long values/mobile/zoom; provider offline; locked identity fields explain alternative; default asset paused after save                             |
| P05     | Consumer submits, authorized admin decides, outcome persists                                             | Self-approval without role, wrong role, stale decision, duplicate conflicting payload, production seed/issuance guard | Crash after financial/grant effect before request checkpoint; duplicate decision once; last-admin rule; role revoked during decision               |
| P06     | Reset through controlled delivery then sign-in; verification and session revoke                          | Invalid/expired/replayed token; unknown email generic result; cross-user session revoke; CSRF                         | Concurrent token consumption; email changed; provider-only identity; delivery unavailable; resetting revokes prior sessions                        |
| P07     | Transfer creates one inbox notification; user reads it; verification job completes                       | Cross-user notification/job access; invalid filters; worker failure remains retryable                                 | Duplicate events; process restart; expired lease/stale completion; historical backlog; missed polling; sign-out/revocation                         |
| P08     | Complete ordinary/admin journeys on exact URL with readback                                              | Existing user missing prerequisites receives actionable state                                                         | Real response loss/restart drill, migration copy, preserved balances, current full regression and manual accessibility checks                      |
| P09     | Local/testnet ERC-20 transfer observed to finality with matching intent                                  | Wrong chain/token/destination, forged evidence, invalid proof, insufficient gas                                       | uint256 bounds, nonce replacement, reorg, RPC loss, paused provider with unresolved work, restart; no duplicate broadcast                          |
| P10     | Authorized direct message and reconnect history                                                          | Stranger subscription/message denied; revoked session removed                                                         | Duplicate send ID, offline peer, gap recovery and outbox retry                                                                                     |

Illustrative scenarios to turn into `.feature` files during implementation:

```gherkin
Scenario: An admitted transfer is recoverable after signing in again
  Given a synthetic sender has an admitted pending transfer
  And its outcome response was lost
  When the sender signs out and signs in with empty browser storage
  Then Activity shows the original transfer
  And checking it never creates a second financial effect

Scenario: A configuration conflict preserves the administrator's work
  Given two authorized administrators loaded the same policy revision
  When the first publishes a valid change
  And the second attempts to publish a different change with the old revision
  Then the second sees a conflict with comparison and reload actions
  And the first change remains effective
  And the second administrator's unsaved input remains editable

Scenario: An unfunded consumer has a useful next action
  Given a synthetic consumer has an active wallet and zero DEMO balance
  When the consumer opens Home
  Then the reason they cannot send is explained
  And they can copy their receive identity or open an enabled allocation request
  And they can leave for Wallet or Settings without losing control
```

## 4. Verification commands and evidence contract

Activate the project runtime and run serially. Do not reuse earlier report files as evidence of a new run. Suite commands overwrite their normal reports; archive a full-suite result before a focused run when needed.

```powershell
. .\scripts\use-tools.ps1
.\scripts\db.ps1 start
.\scripts\npm.ps1 run test:unit
.\scripts\npm.ps1 run test:functional
.\scripts\npm.ps1 run check
```

`check` already includes both suites; running it successfully is sufficient for that combined gate without immediately repeating suites. Separate commands are useful during implementation. Use module tags during development, but a focused pass cannot close a previously incomplete full regression. New tags must actually exist in executable feature files. See [tests/README.md](../tests/README.md).

Inspect actual nonempty `.local/test-results/unit.xml`, `functional.xml` and `functional.html`: case/step counts, zero failures/errors/skips and no pending/undefined scenarios. Record commands, scope, check time, prerequisites and unresolved gaps. Do not assume report structure or earlier test counts; derive them from the run. Include lint/typecheck/build/formatting as required by `check`.

Exact-service acceptance after authorized code changes:

1. Confirm `http://localhost:5173` remains the user's URL; inspect listeners, served source/build, API registration and sanitized database target. Never infer API version solely from files on disk.
2. Build/restart only affected services if needed. Preserve data, migration markers, old transfer IDs and session semantics. A source-watching process and compiled process have different restart needs.
3. Use designated synthetic identities. Exercise the relevant ordinary-user and authorized-admin screens without API interception. Capture request method/path/status and authorized persistence readback; avoid secrets in screenshots/reports.
4. Test both a successful path and the package's blocked/recovery path. Record expected/actual result, timestamp, URL, version, data target and screenshot/report paths. Health checks establish availability only.
5. Verify existing-user prerequisites and fresh registration separately. Never run seed/migration to conceal missing application behavior. Any real live mutations must be authorized synthetic operations with a clear scope.

Maintain a package acceptance table with columns **Designed / Implemented / Unit JUnit / Cucumber / Live UI→API→DB / Remaining gap**. Mark missing evidence `unverified`, not passed. Deployment/provider access blockers keep the relevant feature unfinished even if mocks pass.

## 5. Decisions and deferred boundaries

| Decision                                                            | Proposed default                                                              | Must be resolved before            |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------- |
| Business release scope                                              | Complete demo journey before external payments                                | P00 implementation scope           |
| Demo allocation request policy                                      | Administrator approval; no public faucet or automatic credit                  | P05 rollout                        |
| Support ownership                                                   | Configured organization help route plus durable requests; no invented contact | P05 rollout                        |
| Account recovery provider and existing unverified emails            | Controlled delivery adapter first; explicit recovery eligibility policy       | P06 rollout                        |
| Production retention, alert thresholds, availability/recovery goals | No production claim until operating owner sets and tests them                 | P08 production readiness           |
| Credentialed RPC and finality configuration                         | Unsupported until secret storage and chain observer exist                     | P09                                |
| Mainnet and monetization                                            | Deferred; no UI switch makes them ready                                       | Separate business/release decision |

Future agents can implement additive local/demo foundations without guessing these deferred decisions. A dependent live rollout remains blocked until its prerequisite is concrete. The next recommended implementation task is **P00**, followed by **P01 transfer history and recoverable Activity**; do not start with cosmetic restyling or real-money settlement.
