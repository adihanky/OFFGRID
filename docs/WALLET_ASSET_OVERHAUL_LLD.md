# Wallet, assets and transfer overhaul — LLD

Status: implementation in progress, 25 October 2026. Read the [overhaul HLD](WALLET_ASSET_OVERHAUL_HLD.md) first. This document defines the full target alongside the existing [v1 LLD](WALLET_AND_TRANSFER_LLD.md). Work under [orchestrator.md](../orchestrator.md). The tables describe required scope; they do not claim every proposed module or acceptance gate is complete.

Current implementation: [wallet architecture](WALLETS.md), [custody](CUSTODY.md) and [administration](ADMINISTRATION.md) cover atomic signup wallets, exact recipient resolution, the v2 demo wallet/send/outcome browser flow, compatible v1 recovery, asset policies/issuance, role setup/access/audit, participant custody activity, repeatable seed preview/run/resume and explicit local legacy backfill with backup rehearsal. Existing v1 IDs/hashes/replays are preserved. Binding proofs, network/provider configuration, global policy editors, EVM adapters/observers and testnet acceptance remain unfinished. These are still required for the full target; the demo slice does not complete O01–O12. Verified commands/results and live-service boundaries are in [onboarding](../onboarding.md).

## 1. Initial design baseline and module changes

Inspected branch `feature/Auth`, HEAD `aa208f7`, with substantial existing uncommitted wallet/transfer code and tests. Existing sources use `assetTypes`, one `accounts` record per user/asset, int64 balances, exact handle lookup, atomic ledger/chain/outbox settlement and PENDING/COMMITTED/REJECTED recovery. There is no explicit wallet entity, chain-address proof, asset administration API, per-lot custody or external settlement. `users` has no role model. Preserve the current source and executable regressions.

| Path                                                | Implementation responsibility                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/assets/` (new)                | Asset/network schemas, policy revisions, admin services, provider verification               |
| `apps/api/src/modules/wallets/` (new)               | Wallet provisioning, eligibility fences, binding challenges and exact recipient resolution   |
| `apps/api/src/modules/accounts/`                    | Keep simulation balance/issuance logic; delegate registry to Assets; add wallet linkage      |
| `apps/api/src/modules/custody/` (new)               | Lot selection, consumption/output creation, immutable lineage, scoped queries and verifier   |
| `apps/api/src/modules/blockchain/` (new)            | ERC-20 adapter, independent transaction verifier, observer, nonce/replacement reconciliation |
| `apps/api/src/modules/transfers/`                   | v2 dispatcher and intent model; reuse existing simulated executor and attempt fencing        |
| `apps/api/src/modules/admin/` and `fixtures/` (new) | Roles/audit/settings, guarded seed preview/run and migration jobs                            |
| `apps/api/src/modules/auth/`                        | Atomic wallet provisioning hook, live role authorization; retain cookie/CSRF implementation  |
| `apps/api/src/workers/`                             | Pending simulation recovery plus chain/seed jobs; finite leases and shared executors         |
| `packages/contracts/src/`                           | Versioned DTOs; do not overload old `TransferView.status` with blockchain semantics          |
| `apps/web/src/`                                     | Wallet/link, assets, transfer, custody, admin and seed screens; retain auth/intent isolation |

Prevent dependency cycles: Auth owns identity persistence and exports narrow identity/authorization adapters; a registration coordinator calls Auth and Wallet provisioning in one session. Wallets may depend on those adapters, but Auth must not import the whole Wallet module back. Assets owns catalogue/head configuration; Accounts owns balances; Transfers orchestrates all writes and passes `ClientSession`. RPC/signature-provider calls never run inside retryable database transactions. No `Promise.all` inside a settlement transaction.

## 2. Types, amounts and persistence

Application IDs remain lowercase ObjectId strings; dates are server UTC ISO strings. Network IDs are internal IDs referencing a verified chain identity. Normalize EVM addresses to validated 20-byte lowercase hex for unique keys; use checksummed display and reject malformed mixed-case checksum input. Never use token symbol as identity.

```ts
type AssetKind = 'DEMO_CRYPTO' | 'DECENTRALIZED_TOKEN';
type SettlementMode = 'SIMULATED' | 'EVM_ERC20';
type AssetLifecycle = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
type WalletLifecycle = 'ACTIVE' | 'SUSPENDED';
type BindingLifecycle = 'VERIFIED' | 'REVOKED';
type NetworkEnvironment = 'LOCAL' | 'TESTNET' | 'MAINNET';

interface SendIntentInput {
  recipientResolutionId: string;
  senderWalletId: string;
  assetId: string;
  quantity: string;
}
// senderWalletId must belong to the authenticated user, never a caller-selected sender.
// Resolution pins recipient user/wallet/binding and network; server rejects mismatches.
```

Simulation retains precision 0..8, positive transfer units <= INT64_MAX, nonnegative ordinary balances and existing bounded signed system issuance balance. EVM supports precision 0..18 and uint256 0..2^256-1; reject a configured contract outside this supported precision range. Store on-chain units as canonical digit strings (up to 78 digits), never BSON Long or Decimal128. Parse using bigint and explicit bounds. Display decimal quantities have a 100-character limit and grammar `^(0|[1-9][0-9]*)(\.[0-9]+)?$`; simulation retains its stricter existing 30-character API limit. No exponent, signs, whitespace, numbers or excess fractional digits. EVM gas/nonce/block quantities are also exact strings. BSON string quantities are not numerically sorted or summed in MongoDB; use bigint in bounded jobs. Compare same-mode values only.

### Collections and indexes

All new collections have strict validators, timestamps and schema versions. Build indexes before enabling routes. Validate referential relationships in services and verification jobs; MongoDB indexes alone do not supply foreign keys. No TTL on wallets, bindings, transfers, audit, lots or idempotency records.

| Collection                   | Required fields / constraints                                                                                                                         | Indexes                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `wallets`                    | `userId`, status, eligibilityRevision Long; exactly one per registered user                                                                           | Unique userId                                                                                          |
| `walletBindings`             | walletId, networkId, normalizedAddress, status, proofId, verifiedAt, revision; immutable owner/address/network; revocation preserves record           | Unique `(networkId,normalizedAddress)` across all statuses; unique `(walletId,networkId)` in phase one |
| `walletProofs`               | userId, sessionHash, walletId, networkId, address, nonceHash, canonical message, expiresAt, consumedAt; no private key                                | Unique nonceHash; TTL expiresAt for temporary challenges; retained proof audit separately              |
| `assetTypes` (extend)        | Existing ID/code/precision; kind, mode, lifecycle, revision, immutable identityKey, optional networkId/contractAddress; metadata and policy revision  | Unique identityKey; retain unique code as administrative slug, separate nonunique symbol               |
| `networks`                   | adapter=`EVM_ERC20`, chainId string, genesisHash, environment, lifecycle, RPC secret references, finality mode, revision                              | Unique `(adapter,chainId,genesisHash)`                                                                 |
| `configurationRevisions`     | entityType/id, revision, canonical policy, authorId, reason; immutable                                                                                | Unique `(entityType,entityId,revision)`                                                                |
| `accounts` (extend)          | Existing user/system owner, assetId and int64 balances; user accounts gain walletId matching userId                                                   | Retain unique user/asset and system/asset; add unique partial `(walletId,assetId)` for users           |
| `chainHoldings`              | bindingId, assetId, units string, observedBlockNumber/hash, finalizedAt, coverage/staleness; cache only                                               | Unique `(bindingId,assetId)`                                                                           |
| `recipientResolutions`       | callerId, assetId, senderWalletId, recipient user/wallet/binding IDs, address snapshot, revisions, expiresAt                                          | TTL expiresAt; application checks expiry independently                                                 |
| `transfers` (extend)         | v1 preserved; v2 payload version/mode, wallet/binding IDs, resolution snapshot, asset/network/policy revisions, exact quantity, status                | Retain unique `(senderId,idempotencyKey)` across v1/v2; recovery indexes by mode/status/due            |
| `chainIntents`               | transferId, immutable call, chainId, destination, token contract, units, sender address, prepareExpiry, optional reserved nonce; state/revision/lease | Unique transferId; unique partial `(networkId,senderAddress,nonce)` once nonce reserved                |
| `chainTransactions`          | intentId, txHash, networkId, nonce, decoded call, blockHash/number, receipt status, observation state; multiple replacements per intent               | Unique `(networkId,txHash)`; `(intentId,createdAt)`                                                    |
| `chainObservations`          | immutable included/orphaned/finalized evidence, block hash, tx hash, logIndex, event payload, verification version                                    | Unique dedupe key `(networkId,blockHash,txHash,logIndex,eventKind)`                                    |
| `chainCursors`               | networkId, contractAddress, nextBlock, priorBlockHash, finalized watermark, worker fence                                                              | Unique `(networkId,contractAddress)`                                                                   |
| `custodyLots`                | assetId, walletId/accountId, int64 units > 0, createdEventId, createdOrder, status UNSPENT/SPENT, spentEventId; immutable original units              | `(walletId,assetId,status,createdOrder,_id)`; `(createdEventId,_id)`                                   |
| `custodyEvents`              | assetId, kind ISSUE/TRANSFER/IMPORT_BOUNDARY, reference kind/id, sequence, previousHash, canonical payload/hash, participant wallet IDs               | Unique `(referenceKind,referenceId)` and `(assetId,sequence)`; participant/time cursor index           |
| `custodyEdges`               | eventId, inputLotId, outputLotId, int64 allocated units > 0                                                                                           | Unique `(eventId,inputLotId,outputLotId)`; indexes on each lot ID                                      |
| `custodyHeads`               | assetId, sequence Long, hash, revision                                                                                                                | Unique assetId                                                                                         |
| `roleGrants`, `adminAudit`   | user/role/status/revision; immutable actor/action/target/revision/reason/result audit (redacted)                                                      | Unique user/role; audit target/time and actor/time                                                     |
| `seedRuns`, `seedOperations` | target identity, profile/version/hash, runKey, state/lease/progress; operation kind/key/result IDs                                                    | Unique `(targetIdentity,runKey)`; unique `(runId,operationKey)`                                        |

Temporary challenge/resolution expiry is an authorization check, not a dependency on TTL deletion. `adminAudit` also records setup and role changes. Signing messages/signatures are sensitive proof artifacts: restrict access, bound retention and never expose them in public projections. Retain digest, verified address and proof metadata for durable audit.

## 3. UI configuration contracts

All below have a corresponding UI form and persisted server policy. Use draft -> verify -> activate for assets/networks. Updates require `If-Match` revision; stale edits return 409 with current safe revision. Activation/update and immutable audit record commit atomically. Failed validation leaves the active policy unchanged. Settings not listed are fixed implementation invariants, not implicit environment-only product options.

| Settings UI       | Fields and proposed defaults/bounds                                                                                        | Mutability and enforcement                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Asset editor      | Kind, mode, admin code, symbol/name, precision, network/contract; minimum 1 unit, maximum supported integer by mode        | Kind/mode/precision/network/contract fixed at first activation; names mutable with snapshots; enforce min <= max                                  |
| Demo supply       | Cap 1..INT64_MAX, initial cap 1,000,000 displayed units if representable; issue amount/recipient/reason                    | Cap cannot fall below issued supply; issuance authorized and atomic; no direct balance edit                                                       |
| Network editor    | EVM chain ID/genesis, LOCAL/TESTNET/MAINNET, approved RPC endpoint, masked secret, explorer URL                            | Identity fixed at activation; server verifies chain ID/genesis and contract metadata before enabling                                              |
| Finality          | Default `FINALIZED_TAG`; optional `CONFIRMATIONS` 1..1000 with explicit depth, mainnet minimum 12                          | Confirmation-only means “confirmed by depth,” not protocol finality; mainnet adapter must support chosen policy; existing intents retain snapshot |
| Provider/observer | Request timeout 5s (1..30s), poll 5s (1..60s), log batch 100 blocks (1..1000), max retry backoff 60s (5..300s)             | Bound load and response size; timeout never implies payment failure; record changes and keep pending observers active                             |
| Lookup / send     | Exact indexed lookup; review lifetime 120s (30..300s); user/minute lookup 120, submit 60, read 240 (1..1000)               | No fuzzy account enumeration; server limits persisted; quotas do not override auth or allow alternate senders                                     |
| Demo custody      | Maximum input lots 100 (1..1000), default FIFO deterministic selection                                                     | Never truncate requested amount; return LOT_LIMIT_EXCEEDED before mutation; future consolidation is separate work                                 |
| Seed profile      | User count 4 (2..100), asset allocations, transfer depth 3 (0..100), fixture version, deterministic seed, enable demo data | Bounds and balance dry-run before execute; restricted targets and permissions                                                                     |
| Access            | Roles `USER`, `ASSET_ADMIN`, `DEMO_OPERATOR`, `AUDITOR`, `ACCESS_ADMIN`                                                    | Live DB checks; last active ACCESS_ADMIN cannot be removed; setup endpoint disabled after bootstrap                                               |

Use existing AuthGuard and explicit session CSRF/origin enforcement on every mutation, including wallet proof and seed actions. Admin forms are inaccessible without role, and direct HTTP must also fail. Setup UI is available only while a server-side installation marker is absent; a one-use deployment setup token plus authenticated existing user grants ACCESS_ADMIN atomically. Two competing setup requests cannot both succeed. The setup/encryption root is an installation prerequisite, not ordinary UI-readable configuration.

RPC URLs accept approved hosts/protocols only; reject userinfo, redirects, loopback/private/link-local/metadata addresses and DNS rebinding in deployed environments. Local test RPC is separately allowed only under the development target guard. Never trust a UI-supplied host just because the caller is admin. Secrets go through server encrypted storage; responses contain only configured/masked state. Explorer URLs are validated HTTPS templates, never arbitrary executable links.

## 4. Wallet lifecycle and recipient resolution

### Provision and link

1. User creation and application wallet creation share a transaction. Existing users are handled by the migration; lookup/read must not silently create a second wallet. A missing wallet after cutover is a controlled integrity error, not a valid destination.
2. Authenticated owner requests a challenge for network/address. Validate selected chain identity, address syntax/nonzero address, EOA support and network availability. Generate a cryptographic nonce and a 5-minute expiry. Bind message to origin/domain, purpose “link wallet,” URI, chain ID, issued time, user/wallet and the current authenticated session. Do not repurpose signature as account login or token spending permission.
3. Verify the signed canonical message using an established ERC-4361/Ethereum signature verifier; compare every scoped field and recovered address. Reject mismatched chain, altered statement, expired challenge, consumed nonce or session switch.
4. In a transaction consume the still-live challenge, fence user/wallet eligibility, and insert/reactivate the binding under both unique indexes. An address already owned by another user is a 409; do not merge users based on address or email. Concurrent claims have exactly one winner.
5. Revocation increments binding revision and stops new preparations. Same owner may reverify the same binding; reassignment or replacing it with a different address is unsupported in this release and the UI explains this constraint. Existing submitted transactions keep their original destination/evidence. Privileged users cannot bypass proof.

Proof establishes key control at link time, not guaranteed perpetual control. Phase one EOAs have no account key-rotation API; compromise requires revocation and a future reviewed recovery workflow. Every send checks current wallet-provider account/network and requires the actual transaction signature. A recipient can receive while logged out.

### Exact resolver

`POST /api/v2/peer-resolutions` accepts `{assetId,senderWalletId,lookup:{kind:'HANDLE'|'WALLET_ID'|'CHAIN_ADDRESS',value}}`. For chain address, selected asset supplies the network. Normalize handles exactly as current Auth; equality query on unique indexes, never regex. Resolve user -> wallet -> binding when applicable, then validate active user/wallet/asset/network and mode compatibility. Check sender the same way and reject self-send/distinctness violations. No arbitrary raw-address recipient is accepted.

Return `{resolutionId,expiresAt,recipient:{userId,publicHandle,displayName,walletId},destination:{mode,networkId?,address?},revisions}`. Include no other balance or private profile field. Store resolution scoped to caller and asset. This is advisory review evidence, never a substitute for admission/execution validation. Exact resolution of missing, disabled, revoked or unregistered recipients returns the same safe `RECIPIENT_UNAVAILABLE` response. Do not examine sessions or online status.

On submit, load resolution and require unexpired, matching caller/sender/asset, unchanged recipient/destination and applicable revisions. Changed details return `REVIEW_REQUIRED`; do not silently substitute a new address. Admission copies immutable snapshots so later resolution TTL deletion does not break recovery. No Bloom filter is needed; a future cache must not create false absence or bypass authoritative checks.

## 5. Simulation execution and custody algorithm

Reuse current claim/lease/idempotency/unknown-commit behavior. v2 canonical intent is UTF-8 JSON array `[2,senderId,senderWalletId,recipientId,recipientWalletId,assetId,mode,networkIdOrNull,senderBindingIdOrNull,recipientBindingIdOrNull,destinationOrNull,unitsString]`, SHA-256. Resolve an existing sender/key before checking resolution expiry or mutable policy; compare pinned semantics, not ephemeral review ID. A same-intent replay still works after review expiry. Changed/unknown asset or destination with a reused key yields 409, including v1 cross-version conflicts. Keep stored v1 payload hashing unchanged.

Persist the admitted resolution ID and its complete destination snapshot with the transfer. A retry supplying that same resolution ID uses the stored snapshot even after the temporary resolution record expires; compare all other supplied fields and canonical units against the admitted payload. A different resolution ID must resolve to an extant caller-owned snapshot with identical destination semantics to replay successfully. If that cannot be established, return 409 without changing the existing request. Never reconstruct a recipient from a now-changed handle or current default binding during recovery.

Within one snapshot/majority transaction:

1. Fence pending transfer by attempt token; touch participant user/wallet/account documents in sorted ID order. Require ACTIVE status and matching ownership. Write-fence asset policy/head so pausing serializes with settlement.
2. Select oldest unspent sender lots by `(createdOrder,_id)` until quantity is covered. Enforce configurable lot bound and balance/lot equality. Missing provenance or imbalance fails closed with an integrity incident, not an automatic repair.
3. Conditional debit and bounded credit use existing account logic. Mark each selected lot SPENT only if still UNSPENT. Concurrent spend of a lot aborts/retries the whole transaction.
4. Create a recipient output of exactly requested units and, if selected inputs exceed the amount, a sender change output. Input lots are never partially edited. Allocate inputs to recipient first in selection order, then change, creating positive `custodyEdges` with exact unit allocations. Every consumed input's outgoing edges sum to its units; every output's incoming edges sum to its units. All inputs/outputs share the asset. Splits and merges therefore form a DAG.
5. Append custody event and advance custody head; append existing journal pair and transfer audit chain; mark COMMITTED and insert outbox. All changes share the same session. No accepted transfer may omit lineage.

Issuance uses the same discipline: active asset/wallet, bounded cap and signed system balance, stable issuance key, journal pair, one root lot and ISSUE event. Its root has no input edges and is covered by issuance evidence. Existing transfer chain remains transfers-only; custody chain adds issuance without rewriting that chain. Supply cap check and issued-total update share a fenced asset supply record. No burn in this release.

Canonical custody payload v1 is the JSON array `[1,assetId,sequenceString,eventKind,referenceKind,referenceId,eventTimeISO,previousHash,inputs,outputs,edges]`. Input/output elements are `[lotId,walletId,unitsString]`; edges are `[inputLotId,outputLotId,unitsString]`. Sort arrays lexicographically by lot IDs and then edge ID tuple before UTF-8 SHA-256. Store exact canonical payload. Genesis uses sequence zero/hash of 64 zero characters. Hash/event IDs are allocated deterministically per durable operation before a retry; no external calls in the callback. Never exceed signed Long sequence capacity.

Verifier checks journal/account equality, sum of unspent lots equals user balance, no double consumption or cycles, allocation conservation, issuance cap/totals, event hashes/sequence/head and transfer correspondence. A privileged database writer could recompute hashes; this is not proof against a privileged rewrite absent external checkpoints. User custody graph queries are paginated (default 25, max 100 events; max expansion depth 10), with redacted predecessor owners and explicit continuation boundaries. Auditors can run full verification jobs without public graph enumeration.

## 6. Blockchain intent and observation lifecycle

Use a narrow adapter with `verifyNetwork`, `inspectToken`, `readHolding`, `buildTransferCall`, `verifyTransaction`, `observeReceipt` and `scanTransferEvents`. First adapter supports direct EOA ERC-20 `transfer(recipient,units)` calls only, with zero native value and no allowance/approval flow. Verify deployed code and metadata on activation; require supported decimals and explicit admin-reviewed contract. Reject unsupported fee/rebase/proxy-change semantics; a changed reviewed code/implementation fingerprint pauses new preparation. Metadata verification is not a claim that arbitrary contracts are safe. Ordinary ERC-20 behavior is a supported-contract prerequisite, with observed discrepancies blocking finalization.

```text
AWAITING_SIGNATURE -> SUBMITTED -> INCLUDED -> FINALIZED
AWAITING_SIGNATURE -> EXPIRED
SUBMITTED/INCLUDED -> REVERTED            (canonical failed receipt under finality policy)
SUBMITTED -> REPLACED                    (canonical finalized incompatible same-nonce tx)
INCLUDED -> SUBMITTED                    (pre-finality reorg; preserve orphan evidence)
FINALIZED -> REORGED -> INCLUDED/FINALIZED (exceptional correction, never erase evidence)
any nonterminal state -> NEEDS_RECONCILIATION (uncertain broadcast/provider/nonce)
```

`NEEDS_RECONCILIATION` retains prior phase/evidence; successful reconciliation restores the appropriate state. Signing rejection before broadcast leaves the intent resumable until expiry. Expiry only closes unsigned authorization; a matching late-discovered broadcast still needs observation and an explicit late-broadcast annotation. Polling age alone never proves EXPIRED, REVERTED or REPLACED once broadcast may have occurred.

1. Admission stores immutable intent and policy snapshots under sender/key uniqueness. Return server-built call (chain ID, contract `to`, calldata, zero value, destination and units) plus a short prepare expiry. Read chain holdings and gas estimate for review with block/staleness labels. These reads are advisory; external spending can invalidate them.
2. Before invoking wallet send, reserve the intended sender nonce in a durable intent step. A second active app intent for the same binding is blocked while broadcast status is unknown. Unique network/sender/nonce prevents two app intents claiming the same nonce; replacements remain in the same intent. Provider nonce changes require reprepare/review. This cannot lock transactions sent from outside the app.
3. Client verifies wallet account/network and invokes wallet signing. Never store private keys or auto-resubmit a new transaction on response loss. Persist user-scoped intent ID before invoking provider. After returned hash, submit `{transactionHash}` to the server. Only owner can attach evidence; server fetches and verifies chain ID, signer, nonce, contract, decoded direct transfer recipient/units and zero value against prepared intent. Hash from an untrusted browser is only a lookup hint. Temporarily unavailable transaction stays unresolved; demonstrably unrelated hash returns 422 without changing payment outcome.
4. A worker recovers a lost hash by scanning the configured chain/indexer for the sender/nonce from preparation block, including receipts. Standard RPC does not guarantee a pending transaction search by sender/nonce; provider adapter must document its scanning capability. If no conclusive evidence exists, expose NEEDS_RECONCILIATION, let the owner attach a hash, and block automatic resend. Lease/fence workers and index unique observations so duplicates do not duplicate effects.
5. INCLUDED requires successful receipt and exact expected Transfer event emitted by the configured contract with expected from/to/units. Failed receipts are observed until the selected finality policy before terminal REVERTED. A successful receipt alone is insufficient if token event/amount is absent or anomalous; flag manual investigation. At finalization verify canonical block hash and configured finalized tag or confirmation depth, then atomically update local transfer status, chain evidence/custody projection and outbox. Do not debit demo accounts or write a simulated ledger pair for on-chain transfers.
6. Compatible fee replacements with same nonce/call attach to the existing intent; incompatible cancellation/replacement is REPLACED only after canonical finality evidence. Preserve all hashes and fees. Poll/rescan overlapping blocks and verify stored cursor ancestry to detect reorgs. Mark orphaned observations with new immutable events, rebuild affected cache projections and emit correction events. Do not blindly reverse balances or erase earlier finalized evidence. Multiple distinct nonces paying the same intent are separate external effects, not deduplicated away; record/anomaly flag them.

Chain custody is ordered by `(blockNumber,transactionIndex,logIndex)`, not arrival time. Each indexed contract has explicit coverage start/end and finalized watermark. External deposits, withdrawals, mint/burn and unknown owners are chain facts, not automatically valid app peers. Late events fill coverage gaps without claiming a globally unique coin lineage. A wallet balance read may exceed indexed-history net movements when history is incomplete; show that boundary. Events before an address was linked do not automatically associate historical transfers with that user's identity.

RPC credential/finality changes do not silently change admitted intent policy. If a provider is unavailable, observers retry with validated fallback for the same chain identity. Revocation/suspension after preparation prevents further app preparation/attachment authorization where appropriate but cannot reverse broadcast; system observers must still recognize genuine matching chain outcomes. Session expiry does not stop observation. Store the eligibility-change warning separately from the chain result.

## 7. API and UI contract

Prefix all new endpoints with `/api/v2`; keep v1 clients restricted to migrated SIMULATED assets. Every route authenticates, uses no-store and strict DTO validation; all mutations enforce CSRF, ownership/role and request limits. Admin mutations and seed/issuance actions are idempotent. Every response carries only authorized projections.

| Endpoint                                                                               | Contract                                                                                                                                      |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /wallet`                                                                          | Own wallet, compatible bindings and holdings; `{source:'SIMULATED'                                                                            | 'CHAIN',balance,observedAt?,block?,stale,status}` per asset |
| `POST /wallet/binding-challenges`                                                      | `{networkId,address}` -> challenge ID, exact message, expiry                                                                                  |
| `POST /wallet/bindings`                                                                | `{challengeId,signature}` -> verified binding; one-use proof                                                                                  |
| `POST /wallet/bindings/:id/revoke`                                                     | Own binding, expected revision, reason; history retained                                                                                      |
| `GET /assets`                                                                          | Enabled/displayable catalogue, modes/network labels and policies; cursor max 100                                                              |
| `POST /peer-resolutions`                                                               | Exact lookup contract in section 4                                                                                                            |
| `POST /transfers`                                                                      | `SendIntentInput`, Idempotency-Key; simulation result or blockchain intent                                                                    |
| `POST /transfers/:id/prepare`                                                          | Owner-only fresh review and nonce reservation for EVM; same intent, no monetary effect                                                        |
| `POST /transfers/:id/transactions`                                                     | Attach hash idempotently; independently verified evidence                                                                                     |
| `GET /transfers`, `GET /transfers/:id`                                                 | Cursor/filter own activity; sender sees unresolved intents, recipient sees committed simulation or included chain facts and later corrections |
| `GET /wallet/lots`, `GET /custody/events/:id`                                          | Own holdings/provenance, bounded authorized graph, redacted ancestors                                                                         |
| `POST /admin/assets`, `PATCH /admin/assets/:id`                                        | Draft creation/metadata/policy with If-Match; ASSET_ADMIN                                                                                     |
| `POST /admin/assets/:id/verify`, `POST /admin/assets/:id/lifecycle`                    | Read-only verification job and separate explicit state transition; ASSET_ADMIN                                                                |
| `POST /admin/networks`, `PATCH /admin/networks/:id`, `POST /admin/networks/:id/verify` | Provider/secret configuration and connectivity check; ASSET_ADMIN                                                                             |
| `POST /admin/networks/:id/lifecycle`                                                   | Enable/pause/archive; MAINNET requires release capability and audit                                                                           |
| `GET /admin/settings`, `PATCH /admin/settings`                                         | Typed lookup/send/observer settings and revisions; ASSET_ADMIN                                                                                |
| `POST /admin/demo-issuances`                                                           | `{walletId,assetId,quantity,reason}`, stable key; DEMO_OPERATOR, guarded environment                                                          |
| `POST /admin/seed-previews`, `POST /admin/seed-runs`, `GET /admin/seed-runs/:id`       | Validated target/profile preview hash; execute exactly that profile; progress and verifier                                                    |
| `POST /admin/verification-jobs`, `POST /admin/reindex-jobs`, `GET /admin/jobs/:id`     | Bounded integrity/coverage jobs; AUDITOR or ASSET_ADMIN as appropriate                                                                        |
| `PATCH /admin/wallets/:id/status`, `GET /admin/audit`                                  | Suspension with reason/revision; ACCESS_ADMIN; audit read AUDITOR                                                                             |
| `POST /admin/role-grants`, `POST /admin/role-grants/:id/revoke`                        | ACCESS_ADMIN; last-admin protection; no self-service role escalation                                                                          |
| `POST /setup/claim`                                                                    | One-time server-token protected bootstrap described in section 3                                                                              |

Admin list/detail reads for assets/networks, policies, seed profiles, roles and jobs accompany their mutation screens; use the same permissions, pagination and redacted projections. Seed profile CRUD stores versioned templates, separate from a run. Network/asset verification jobs return sanitized diagnostics, never raw authenticated RPC URLs.

HTTP semantics: 400 invalid schema; 401 session invalid; 403 permission/CSRF; 404 unavailable or unauthorized resource; 409 uniqueness/idempotency/revision/review conflict; 422 definitive business validation rejection; 429 rate limit; 503 unconfirmed admission/provider availability. Simulation preserves existing 201/200/202/422 semantics. EVM POST normally returns 202 and an explicit phase; GET returns 200 for known state. Chain revert/replacement is a durable outcome, not an HTTP timeout. Stable codes include WALLET_UNAVAILABLE, WALLET_ALREADY_LINKED, PROOF_INVALID, PROOF_EXPIRED, REVIEW_REQUIRED, WRONG_NETWORK, UNSUPPORTED_TOKEN, LOT_LIMIT_EXCEEDED and NEEDS_RECONCILIATION. Never send raw provider errors or distinguish another user's private record from missing.

UI invalidates review on any recipient/asset/amount/network/account change. Show distinct spendable demo balance, observed token balance, native gas and stale-data status. Use full address available for inspection even when abbreviated in lists. A disabled/empty/error asset list retains editable recipient/amount behavior from current regressions. Store unresolved intent under user ID; clear private UI state on logout/account switch while backend recovery continues. Accessible labeled forms, keyboard confirmation, progress/error regions and browser tests are required. No optimistic balance debit; wallet refresh follows authoritative outcomes.

## 8. Seed data specification

Default `wallet-overhaul-v1` profile creates synthetic `demo_alice`, `demo_bob`, `demo_carol`, `demo_dana` with `.invalid` emails, one active application wallet each, DEMO precision 2 and DETH precision 8. Only Alice needs a login for the demo; Bob/Carol/Dana may have zero sessions and remain valid recipients. Passwords are explicitly supplied through a masked development UI input or existing CLI environment mechanism, hashed through Auth, never stored in the profile/run/log. After provisioning revoke any temporary sessions. A restart requiring unfinished credential creation prompts for the secret again; never persist plaintext for resumability.

| Operation key              | Operation                         | Expected effect                                                                               |
| -------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------- |
| `issue:<user>:DEMO` (four) | Issue 1000.00 DEMO to each wallet | 4000.00 total; system debit -4000.00                                                          |
| `issue:<user>:DETH` (four) | Issue 2.00000000 DETH each        | 8.00000000 total; system debit -8.00000000                                                    |
| `transfer:1`               | Alice -> Bob 125.25 DEMO          | Split Alice root, preserve change                                                             |
| `transfer:2`               | Bob -> Carol 1100.00 DEMO         | Consume Bob's root plus part of received lot; demonstrates merge/split and multi-hop ancestry |
| `transfer:3`               | Carol -> Dana 0.01 DEMO           | Minimum unit transfer                                                                         |
| `transfer:4`               | Alice -> Dana 0.00000001 DETH     | Precision-8 minimum unit                                                                      |

Expected DEMO balances: Alice 874.75, Bob 25.25, Carol 2099.99, Dana 1000.01 (total 4000.00). DETH: Alice 1.99999999, Bob 2.00000000, Carol 2.00000000, Dana 2.00000001 (total 8.00000000). Each issue/transfer goes through the domain service; no raw balance insertion. Deterministic operation keys derive from profile version/run namespace. Repeat with matching key returns existing result; changed content conflicts. Completed runs preserve subsequent user spending, so expected snapshot balances are checked at initial completion, while later reruns check immutable operations plus current reconciliation rather than restoring snapshot amounts.

Preview simulates amounts/caps, target allowlist, existing identity conflicts and supported modes; returns signed/opaque preview ID, profile hash, counts and target identity. Execute revalidates target guard and preview, requires DEMO_OPERATOR and uses a stable run key. Jobs checkpoint each domain operation durably; crash between financial effect and checkpoint is recovered with the same domain idempotency key. Per-run lease prevents competing workers. No reset/delete operation in initial UI; a failed job shows partial progress and resume, not “rolled back” unless rollback actually occurred. Reject fixture identity/password mismatches without overwriting existing users.

Extend existing `demo-target.ts` deliberately for any new disposable test database prefix; do not bypass it. Production/remote target rejection is enforced in API and worker as well as UI. Local-chain fixture profile additionally deploys a standard test ERC-20, funds disposable EOAs on a private chain, executes genuine ownership proofs and transfers through the adapter, and waits for observed results. Fixed test keys are allowed only within the isolated local-chain harness. Never expose them as usable mainnet wallets or seed fake receipts into a public-network configuration.

## 9. Migration and compatibility

1. Build a read-only migration report: schema/index versions, users without wallets, account ownership conflicts, balance/journal/chain health, pending requests and provenance reconstruction feasibility. Take/validate backup in the implementation environment. No implicit migration on startup.
2. Enter UI-visible maintenance mode for simulated mutations and pause seed jobs; drain existing pending requests with existing worker. If unresolved commit outcomes remain, block cutover. Snapshot counts/totals/checkpoints; leave historical hashes and payloads immutable.
3. Idempotently create wallets under unique userId, attach existing user accounts, map current assets to DEMO_CRYPTO/SIMULATED without changing IDs/precision/code. Create asset identity keys and map active/disabled to ACTIVE/PAUSED. Preserve old status fields during compatibility. Add role/config collections with least privilege, bootstrap admin securely.
4. Reconstruct demo lots by replaying issuance/transfer evidence per asset. Existing transfer chain orders transfers, but issuance and transfers lack a shared historical sequence: timestamp alone is not proof of a total order. Use journal references, causal balance constraints and explicit deterministic migration ordering; mark reconstructed attribution `MIGRATED_POLICY`, not historically observed unit lineage. If evidence cannot produce valid conservation, stop. With explicit migration policy, an IMPORT_BOUNDARY may capture a reconciled opening balance at cutover and retain links to legacy evidence; label its pre-boundary provenance incomplete. Never invent an ISSUE event to hide missing history.
5. Verify total balances, IDs, unique ownership, journal/old-chain hashes and custody conservation; record migration checkpoints. No historical transfer payload/status rewrite. v1 read/submit stays SIMULATED-only, resolves backfilled wallets internally and uses v2 custody writer for newly settled demo requests while retaining v1 request hash semantics. v1 cannot bypass wallet/asset status or create missing provenance. Cross-version reuse of sender/key conflicts unless resolved as the original version's identical intent.
6. Enable v2 by feature gate, verify fixture/user flows then lift maintenance. Existing signed-in identities remain valid; client clears old review state and restores pending intents by original version. Rollback before new v2 writes can restore the tested backup; after new writes use forward repair or a reviewed maintenance recovery plan. Do not drop columns/collections or deploy an old writer that omits custody after cutover.

## 10. Required acceptance and work packages

These are implementation requirements, not executed tests. For each row add TypeScript unit tests plus executable Cucumber scenarios and step definitions. Include HTTP/real replica-set checks for atomicity; controlled provider signatures/RPC fixtures for deterministic blockchain tests, with separate local-chain integration evidence. Browser scenarios must exercise every configuration form and permission boundary. Proposed files: `tests/unit/{asset-admin,wallet-binding,peer-resolution,custody,chain-intent,seed-overhaul,migration}.test.mts` and matching `tests/features/*.feature`, `tests/steps/*.steps.mts`; reuse existing harnesses.

| ID / requirement     | Happy flow                                                                       | Negative flow                                                                                  | Edge / regression                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| O01 Assets/UI        | Admin creates/verifies/enables both types; metadata persists after reload        | Nonadmin API denied; wrong chain/contract/precision and unsafe RPC rejected                    | Concurrent edits 409; activated identity immutable; same symbol on different chains stays distinct                |
| O02 Wallets          | Signup/backfill yields one wallet; valid proof binds address                     | Forged/expired/wrong-domain/wrong-session proof rejected                                       | Concurrent duplicate claims one winner; replay nonce blocked; revoked address never reassigned                    |
| O03 Peers            | Exact handle resolves registered logged-out recipient with compatible wallet     | Unknown/unregistered address, self-send, disabled/missing wallet blocked                       | Recipient signs in/out with no effect; wallet revoked after review -> REVIEW_REQUIRED                             |
| O04 Demo settlement  | Debit/credit/journal/chain/lots/outbox commit together                           | Insufficient units, cap/overflow, unavailable wallets and excess precision                     | Concurrent spends, lot limit, eligibility race and injected rollback at each added custody stage                  |
| O05 Custody          | Issuance, split, merge, change and multi-hop ancestry reconcile                  | Tamper, missing edge, wrong asset, cycle/double spend detected                                 | Minimum unit and int64 boundary; graph pagination/redaction; imported provenance labeled                          |
| O06 Chain send       | Valid signed direct call -> included -> finalized; gas displayed                 | Wrong signer/chain/nonce/recipient/contract/amount, unsupported token and false event rejected | uint256 precision, wallet account switch, user refuses signing, stale holdings, no gas                            |
| O07 Chain recovery   | Same-intent hash retries/replacement and restart converge                        | Unrelated hash cannot hijack intent; failed receipt becomes reverted at finality               | Lost broadcast hash, RPC outage, pre/post-finality reorg, external nonce replacement, late broadcast after expiry |
| O08 Seed/UI          | Preview/run default data; exact totals/custody verified                          | Production target, identity conflict, malformed allocations rejected                           | Mid-run crash/resume, same run no-op, changed run conflict, rerun after spending preserves balances               |
| O09 Authorization    | Owner sees wallet; participant sees allowed custody; auditor sees audit          | Stranger history, role escalation, CSRF and secret readback blocked                            | Last-admin/setup race; role revoked during operation; session switch clears intent UI                             |
| O10 Migration        | Existing IDs/balances/replays survive cutover                                    | Missing evidence/duplicate ownership stops migration                                           | Run twice; v1 send adds custody; v1 unknown-asset replay conflict retained; rollback gate enforced                |
| O11 Config lifecycle | Pause blocks new demo execution/preparation; observer still completes broadcasts | Unsupported adapter/mainnet without readiness gate denied                                      | Policy revision change during review; network secret rotation while observations pending                          |
| O12 Existing UI      | Recipient/amount editable while assets load or fail                              | No review with missing/disabled catalogue                                                      | Refresh selection, interrupted JSON body, same-key recovery and account-switch regressions retained               |

Example Gherkin to translate into real `.feature` files (these examples alone do not satisfy the test requirement):

```gherkin
Scenario: A registered recipient can receive while logged out
  Given Alice and Bob have distinct active wallets and DEMO is enabled
  And Bob has no active login sessions
  And Alice holds 100.00 DEMO with valid issuance provenance
  When Alice resolves Bob and confirms a transfer of 12.50 DEMO
  Then Alice holds 87.50 DEMO and Bob holds 12.50 DEMO
  And the journal, custody outputs and committed transfer agree

Scenario: Revoking a destination invalidates review
  Given Alice reviewed Bob's verified EVM destination
  When Bob revokes that binding before Alice prepares the transaction
  Then preparation returns REVIEW_REQUIRED
  And no wallet signing request or broadcast occurs

Scenario: A lost blockchain response does not cause a second payment
  Given a signed transfer was broadcast and its response was lost
  When Alice reloads and resumes the same intent
  Then the app shows an unresolved outcome and does not broadcast again
  And observation of the matching sender nonce attaches the original transaction

Scenario: Rerunning seed data preserves spending
  Given the default seed run completed and Alice subsequently spent 5.00 DEMO
  When an operator repeats the same seed run
  Then Alice's spent balance remains unchanged
  And no additional issuance, transfer or custody root is created
```

| Package     | Depends on                         | Completion gate                                                                                        |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| O-DATA      | Design                             | v2 DTOs, schemas, roles, migration dry-run and unit/functional scenarios                               |
| O-UI-CONFIG | O-DATA                             | Asset/network/settings/access UI and APIs with audit/concurrency/secret tests                          |
| O-WALLETS   | O-DATA                             | Signup/backfill, ownership proofs, exact resolver and both-participant validation                      |
| O-DEMO      | O-WALLETS, O-UI-CONFIG             | Custody/issuance/settlement, compatible v1 path and conservation/race tests                            |
| O-SEED      | O-DEMO                             | Guarded preview/run UI, default fixture, restart/no-reset evidence                                     |
| O-EVM       | O-WALLETS, O-UI-CONFIG             | Adapter, nonce/intent/observer, reorg recovery; deterministic and local-chain suites                   |
| O-CLIENT    | Stable API from preceding packages | Complete wallet/send/history/custody UI and browser scenarios for demo + mocked chain                  |
| O-VERIFY    | All                                | Migration rehearsal, full suites/reports, testnet exercise and handover; mainnet gate remains separate |

Use the project runtime and isolated local replica set. Required commands: `.\scripts\npm.ps1 run test:unit`, `.\scripts\npm.ps1 run test:functional`, then `.\scripts\npm.ps1 run check` for integration. Inspect `.local/test-results/unit.xml`, `functional.xml`, `functional.html`; zero failures/errors/skips/pending/undefined required. Tests use mocks/private chain and synthetic users; no paid mainnet transaction, production database or external account sign-in. Record actual commands/results/prerequisites and any unverified reorg/process-failure/browser coverage in `onboarding.md`. Design document review cannot be reported as feature test success.

## 11. Protocol references

- [ERC-4361 account proof format and verification](https://eips.ethereum.org/EIPS/eip-4361).
- [ERC-20 interface and Transfer event](https://eips.ethereum.org/EIPS/eip-20).
- [Ethereum JSON-RPC transaction, receipt, log and block methods](https://ethereum.org/developers/docs/apis/json-rpc/).

Use maintained protocol libraries and verify their exact version/API during implementation; no new library or provider dependency has been selected or installed in this design session.
