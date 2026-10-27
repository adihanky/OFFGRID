# Core demo enhancements

The user authorized delivery packages P00–P08 from the [delivery plan](ENHANCEMENT_DELIVERY_PLAN.md). This document describes the implemented source boundaries; test execution and live delivery are separate gates. Current results and the next action belong in [onboarding](../onboarding.md). EVM settlement and chat remain P09/P10.

## Boundaries and invariants

The existing transfer coordinator remains the only demo settlement executor. Its balance, journal, custody, chain, outcome and outbox writes retain one transaction and the existing v1/v2 request identities. These additions query those outcomes and reuse existing authorization and issuance services.

| Boundary               | Source                                                                                                                                                                                                           | Responsibility                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Transfer queries       | [history service](../apps/api/src/modules/transfers/transfer-history.service.ts), [query parser](../apps/api/src/modules/transfers/transfer-history-query.ts)                                                    | Participant-scoped history, committed receipts and redacted chain evidence                                |
| Workspace              | [overview](../apps/api/src/modules/workspace/workspace.service.ts), [client](../apps/web/src/UserWorkspace.tsx)                                                                                                  | Independent readiness, supported actions and addressable consumer tasks                                   |
| Configuration          | [registry](../apps/api/src/modules/configuration/policy-registry.ts), [reader](../apps/api/src/modules/configuration/policy-reader.ts), [publication](../apps/api/src/modules/configuration/settings.service.ts) | Bounded typed values, authoritative reads, revision checks and audited publication                        |
| Support requests       | [requests](../apps/api/src/modules/requests/requests.service.ts), [screens](../apps/web/src/RequestsPanel.tsx)                                                                                                   | Durable consumer requests and explicit category-administrator decisions                                   |
| Identity recovery      | [service](../apps/api/src/modules/auth/recovery.service.ts), [delivery boundary](../apps/api/src/modules/auth/recovery-delivery.ts)                                                                              | Email verification, password reset and owner session management; live delivery is disabled by user choice |
| Notifications and jobs | [operations](../apps/api/src/modules/operations/operations.service.ts), [worker](../apps/api/src/modules/operations/operations-worker.ts)                                                                        | Leased inbox delivery, read state, bounded verification and operator diagnostics                          |

Every resource request uses the active session. Mutation routes require the configured Origin and session-bound CSRF. Requests never accept a caller-supplied owner. Financial quantities remain exact decimal strings over HTTP and integer units internally. No startup migration, seed, issuance or role grant is introduced.

## Activity and recoverable work

Routes below use `/api/v2` and `Cache-Control: no-store`:

| Route                        | Behavior                                                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /workspace`             | Readiness, capabilities, roles, receive identity, pending count and effective product-policy revision; a failed section does not fabricate a ready state |
| `GET /transfers`             | Own sends plus committed receipts; `direction=ALL/SENT/RECEIVED`, `status`, exact `peerHandle`, `assetId`, paired `from/to`, `limit` and `cursor`        |
| `GET /transfers/:id`         | Existing authoritative outcome; original payload version retained                                                                                        |
| `GET /transfers/:id/receipt` | Committed participant receipt with admission snapshots and actual commit time                                                                            |
| `GET /transfers/:id/chain`   | Committed participant evidence: sequence, entry/predecessor hashes and commit time; no predecessor transfer or account traversal                         |

Recipients cannot discover another person's pending or rejected attempts. Strangers receive the same unavailable detail response as an unknown ID. History uses immutable `(createdAt DESC, _id DESC)` ordering, existing sender/recipient indexes, a default page of 20 and a maximum of 100. Cursor validation binds the tuple to the caller and normalized filters. Queries have a five-second database time bound. A supplied date range needs both ends, in order, within 366 days.

Pagination is a live view: new admissions appear after refresh, and an earlier item can become terminal while later pages load. The UI merges page rows by transfer ID. Admission-time public identity/asset labels are preserved for both supported payload versions. A receipt certifies an application demo outcome; it makes no legal-payment or external-chain claim.

Home, Wallet, Send, Activity, Settings, Assets, Help and Administration have hash destinations. Security and Notifications are nested tasks. Existing heading bookmarks remain aliases; unknown destinations return Home. Panels are keyed by identity rather than configuration revision. Settings updates refresh data without remounting another task's draft.

Editable sends use a separate identity-scoped session-storage record. Incomplete quantities remain editable. Sign-out/account switching clears private drafts and local retry identities; admitted work remains discoverable through server Activity. Restricted storage produces an explicit page-lifetime message. Pending discovery blocks another new send until the original outcome can be checked; it never treats leaving a screen as cancellation.

## Supported configuration

`GET /admin/settings` returns supported values, defaults, owner, effective revision, a quoted `etag`, bounds, units and application timing. Existing wallet, asset, network, access and demo controls remain available through the configuration overview.

| Scope/key                     | Default / bounds                                                  | Owner        | Application                                                         |
| ----------------------------- | ----------------------------------------------------------------- | ------------ | ------------------------------------------------------------------- |
| PRODUCT `lookupPerMinute`     | 120; 10–600                                                       | ASSET_ADMIN  | Next recipient lookup                                               |
| PRODUCT `readsPerMinute`      | 240; 60–1200                                                      | ASSET_ADMIN  | Next wallet/activity read                                           |
| PRODUCT `admissionsPerMinute` | 60; 1–120                                                         | ASSET_ADMIN  | New transfer submissions; terminal replay is preserved              |
| PRODUCT `reviewSeconds`       | 120; 30–600 seconds                                               | ASSET_ADMIN  | New reviews; any product revision invalidates an unsubmitted review |
| SUPPORT `helpUrl`             | Empty; HTTPS URL up to 300 characters, no credentials or fragment | ACCESS_ADMIN | Next Help view                                                      |
| SUPPORT `accessRequests`      | true                                                              | ACCESS_ADMIN | New access requests                                                 |
| SUPPORT `allocationRequests`  | true, additionally guarded by demo-target/asset eligibility       | ACCESS_ADMIN | New allocation requests                                             |

`POST /admin/settings/validate` returns the current revision, typed differences and impact without publishing. `PATCH /admin/settings` requires the scope's quoted `If-Match` ETag, complete typed values, a reason and UUID `commandId`. Stale publication returns 412; malformed preconditions return 400. Legacy asset/network POST revision contracts are unchanged. `GET /admin/settings/revisions?scope=...&cursor=...` returns 20 authorized immutable revisions per page; auditors can inspect supported scopes.

`productSettings` stores one revisioned record per scope. Publication atomically updates values, `configurationRevisions`, `adminAudit` and caller-scoped `policyCommands`. The same command/content returns its original publication; conflicting reuse returns 409. The editor retains a stale draft, fetches current values for comparison and requires explicit discard before replacing input. An uncertain response retries the original command, then reads back the effective revision.

Readers perform authoritative database reads and validate stored values; invalid data fails closed. Review records pin the product revision, with default-zero compatibility for existing records. Admitted transfers continue through the original executor; policy changes cannot rewrite a terminal replay or turn an unknown financial outcome into rejection. Worker lease/retry constants, deployment secrets, chain finality and unsupported adapters are not configurable through these forms.

## Tracked support requests

`GET /requests` lists the owner's requests. `POST /requests` requires `Idempotency-Key` and either ACCESS `{role,reason}` or DEMO_ALLOCATION `{assetId,quantity,reason}`. New admission is limited to ten per caller/minute; original-key replays remain available. Allocation submission and approval require the existing guarded local/demo target. The request alone has no role or balance effect.

`consumerRequests` has unique owner/key identity and a unique matching OPEN payload. Replaying the original key with matching content returns the original request. A new key matching an OPEN request returns 409 with its reference; conflicting reuse of an original key also returns 409. Pages contain 20 rows and reapply owner/category authorization. Disabling a category affects new submissions, not existing tracking or an administrator's ability to decide admitted work.

`GET /admin/requests` exposes only ACCESS_ADMIN access requests and ASSET_ADMIN allocation requests. `POST /admin/requests/:id/decision` requires revision, reason, decision and UUID command. Another authorized administrator must decide the owner's request. Live user/role checks run inside the domain transaction.

Approval invokes existing role/issuance services. The request decision, linked operation, domain audit and financial/grant effect share a transaction. Stable allocation keys prevent duplicate issuance. A checkpoint failure aborts the complete effect; replay reconciles the original decision. No repair, self-mint, public faucet or authority-broadening endpoint exists.

## Identity recovery and sessions

Live email delivery is intentionally disabled. `RecoveryDelivery` is injectable; automated scenarios override it with an isolated in-memory inbox. No endpoint exposes tokens or a test inbox. The Security and recovery screens show actual delivery availability.

- `GET /api/auth/recovery-status` reports capability and eligibility policy.
- `POST /api/auth/password-reset-requests` always uses a generic acknowledgment. Only active, verified-email users with an existing password are eligible when delivery is enabled. Unknown, unverified and provider-only accounts receive the same public result.
- `POST /api/auth/email-verification-requests` requires the owner's authenticated session. `POST /api/auth/email-verifications` additionally requires the delivered code for that same user/email version.
- `POST /api/auth/password-resets` consumes a valid reset code and replaces the password while revoking all prior owner sessions in one transaction. It never signs in or links Google identities automatically.
- `GET /api/auth/sessions` shows at most 100 active owner sessions, safe timestamps and current-session indication. `POST /api/auth/sessions/:id/revoke` is owner scoped; `/sessions/revoke-others` revokes every other active session, including older rows outside the displayed page.

`recoveryTokens` stores token hashes, purpose, owner/email version, explicit 15-minute expiry and consumed state. User revision writes serialize concurrent consumption and invalidate other old links. TTL is cleanup, not validity enforcement. Failed delivery consumes the undelivered token. Public reset acknowledgment does not expose a delivery error or account existence. Tokens and session hashes never appear in UI reports.

## Notifications and verification jobs

Operations starts a persistent notification activation boundary in `deliveryState`. Only outbox events at/after that boundary are eligible. Earlier events remain retained and are counted separately; startup never falsely marks that backlog delivered.

Each API instance has one bounded Operations tick: at most 20 notification attempts and one verification job every two seconds, with in-flight work drained at shutdown. Notification claims use a 30-second lease and attempt token. Both participant inbox upserts and delivery acknowledgment commit together. Unique `(recipientId,eventId)` records preserve deduplication and read state through retries. A stale worker cannot acknowledge a newer claim. Failed delivery leaves financial settlement unchanged and remains retryable.

`GET /notifications` returns 20 owner-scoped rows in delivery-ID order, with optional unread filtering and cursor. `POST /notifications/:id/read` is idempotent and has no financial effect. The Inbox polls while open and links to authorized receipts.

AUDITOR owns `GET /admin/operations`, `POST /admin/verification-jobs` and owner-scoped `GET /admin/jobs/:id`. The sole supported job scope is `DEMO_INTEGRITY`, with a stable command key. Jobs check ledger, transfer chain and custody in separate snapshots. They enforce a 5,000-record-per-collection bound both before execution and inside verification reads. A 120-second attempt lease fences progress/completion. Restarting an expired attempt repeats safe read-only checks; no job repairs data or alters balances. Results contain status, progress and issue counts.

## Verification and delivery gates

Sources and executable cases are under `tests/unit/` and `tests/features/`: `transfer-history`, `consumer-workspace`, `settings`, `consumer-requests`, `account-recovery`, `notifications-operations`, and their browser scenarios. Existing wallet, navigation, recovery and migration regressions remain part of full `check`. The migration rehearsal restores an EJSON backup of controlled legacy fixtures into a separate guarded database; it does not copy or migrate the running application's data.

Use `.\scripts\npm.ps1 run check` sequentially. Inspect nonempty unit/functional JUnit XML, Cucumber HTML and message results. Scoped reports are archived under `.local/p2p-enhancements/`; they do not replace a fresh full run. Exact-URL UI/API/database checks, restart evidence, screenshots and remaining manual accessibility/usability limits are recorded separately from automated fixture success.

| Package | Designed | Implemented source                          | Unit JUnit             | Cucumber                                                         | Live UI → API → DB  | Remaining gate                                        |
| ------- | -------- | ------------------------------------------- | ---------------------- | ---------------------------------------------------------------- | ------------------- | ----------------------------------------------------- |
| P00     | Yes      | Baseline and guarded target checks          | Fresh full run pending | Fresh full run pending                                           | Recheck in progress | Complete regression and served version                |
| P01     | Yes      | History, receipt, evidence and discovery    | Fresh full run pending | Scoped API/browser pass                                          | Unverified          | Exact-URL acceptance                                  |
| P02     | Yes      | Readiness, tasks, safe exits and drafts     | Fresh full run pending | Scoped browser pass                                              | Unverified          | Exact-URL acceptance                                  |
| P03/P04 | Yes      | Typed policies, readers and guided editors  | Fresh full run pending | Scoped API/browser pass; final ETag correction awaiting full run | Unverified          | Every supported key readback                          |
| P05     | Yes      | Requests and atomic administrator decisions | Fresh full run pending | Scoped API/browser pass                                          | Unverified          | Exact-URL acceptance                                  |
| P06     | Yes      | Controlled recovery, session security       | Fresh full run pending | Scoped API pass                                                  | Unverified          | Session acceptance; live email intentionally disabled |
| P07     | Yes      | Leased inbox, jobs and operations           | Fresh full run pending | Scoped API pass                                                  | Unverified          | Exact-URL acceptance and restart                      |
| P08     | Yes      | Synthetic restore/migration rehearsal added | Fresh full run pending | Rehearsal/full run pending                                       | Unverified          | Release checks and documented limits                  |
