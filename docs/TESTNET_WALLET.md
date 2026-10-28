# Unified testnet wallet

The journey is network → connected address → ownership proof → on-chain assets → wallet-approved payment → indexed receipt. Ethereum Sepolia is the supported public chain. Native ETH and standard ERC-20 tokens execute on the chain; MongoDB never mints or settles them. Existing simulated balances and custody remain labelled legacy data, without conversion or deletion.

## Network and ownership

Authenticated users enable the fixed Sepolia preset with `POST /api/v2/wallet/testnet`, without an administrator grant or prior binding. The server verifies chain ID 11155111 and the canonical block 5,000,000 hash `0x72247ea9191db039158939f7ba958e638a32df4f61a43edcae60cb7a686a2d55`; this supports providers that prune genesis history. The checkpoint identifies the known chain history but, like a genesis check, does not authenticate later provider data. The existing canonical genesis hash remains the stored network identity. Ordinary users cannot select arbitrary RPC destinations or resume a paused network. Custom providers remain administrator-managed.

The fixed public Sepolia providers support an explicitly configured HTTPS egress proxy with normal TLS validation; DNS resolution for those two trusted hosts is delegated to that proxy. All custom providers retain public-address DNS validation and address pinning. Both paths enforce the application host allowlist, response limits and redirect refusal.

Existing single-use, expiring, session-bound ownership proofs link an EOA to the durable user wallet identity. No key or seed phrase is sent to the app. Mutations require Origin and CSRF; chain operations require the caller's active verified binding. Stored history remains owner-readable after revocation or an RPC outage, while synchronization and new transactions require active ownership/network access.

## Assets and signing

`GET /api/v2/wallet/bindings/:id/balance` reads native ETH as decimal-string wei. Unavailable or malformed RPC data is never replaced with zero. The browser links to Ethereum's Sepolia faucet directory for gas funding.

The chain routes below share `/api/v2/wallet/bindings/:id/chain`:

| Route               | Behavior                                                                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET tokens`        | Read imported contract metadata and exact ERC-20 balances.                                                                                                                                                      |
| `POST tokens`       | Import `{address}` after checking deployed code and standard metadata. Limit 20 tokens per binding; import resets the persisted scan to its start so previous transfers are discovered.                         |
| `POST prepare`      | Validate `{token,recipient,quantity}`, ownership, exact precision and available token balance; return ERC-20 transaction calldata. No broadcast or simulated credit occurs.                                     |
| `POST transactions` | Record `{hash}` only after RPC verifies the linked sender. Idempotent by binding/hash/event identity. A hash absent from the provider must be recorded again later; never resend the transaction automatically. |
| `POST sync`         | Scan a bounded block range, reconcile receipts/events and atomically persist records with the checkpoint.                                                                                                       |
| `GET history`       | Owner-scoped indexed activity, up to 50 records per page, with opaque ID cursor, scan range, last synchronization time and background error status.                                                             |

Names and symbols are untrusted contract metadata, rendered as text. Tokens must support standard string name/symbol, decimals ≤36 and balanceOf. Transfers use bigint/ABI encoding without floating point. Code hashes and decimals are rechecked before balance reads and preparation; proxy upgrades that retain bytecode but change behavior are still a contract trust boundary. No unlimited allowance or approval is requested by the UI.

`contracts/OffgridTestToken.sol` extends pinned OpenZeppelin ERC20, permits deployment only on chain IDs 11155111 and 31337, gives the deployer 1000 OGT and exposes a 1000-unit claim with a 60-second per-address cooldown. It accepts no ETH. The browser deploys the reproducible bytecode using the user's wallet. `npm run build:test-token` compiles with pinned solc, optimizer 200 and Shanghai EVM target. Gas requires test ETH. Imported third-party tokens are not assumed to implement the OGT claim function.

Native sending and token/deployment calls verify the selected account/network before asking the EIP-1193 wallet to sign and broadcast. The wallet provides fee estimation and final user approval. Durable local markers are written before submission; unknown outcomes survive reload and require wallet-activity inspection before another request. Returned hashes are recorded independently from broadcast and can be retried without spending again. Browser storage contains public hashes/identity keys, never private keys. A hash is submitted, not confirmation.

## Indexing, concurrency and recovery

`chainTokens`, `chainActivity` and `chainSubscriptions` are separate from simulated financial collections. Unique binding/hash/event keys deduplicate repeated scans and self-transfer logs. Token imports and cursor resets commit together under a transaction so concurrent imports and scans cannot silently omit history.

Indexing begins at most 20 blocks before first subscription, explicitly shown in Wallet and Activity. Each synchronization scans at most 20 blocks, overlapping 12 recent blocks. It indexes direct native transactions, deployments/contract calls and Transfer logs for imported ERC-20 contracts, including incoming transfers. Internal contract ETH transfers require tracing and are explicitly excluded. The starting range is not a claim of full genesis-to-present account history.

Receipts distinguish PENDING, MINED, CONFIRMED (12 blocks), REVERTED and REORGED. The scanner verifies block continuity, receipt/log block hashes and the ending checkpoint before a MongoDB transaction reconciles the window. A changed checkpoint rewinds to the subscription start; orphaned events remain visible as REORGED rather than being silently erased. A persisted lease fences concurrent indexers, and network/binding writes fence pause, configuration and revocation races. Failed reads do not advance the checkpoint.

A serial background indexer rotates subscriptions every 15 seconds outside tests, using the same synchronization path. Failed provider access leaves the checkpoint intact and records an error; the next rotation retries. Shutdown drains in-flight work before closing MongoDB. Wallet and Activity also offer explicit synchronization and pagination. Large backlogs take multiple bounded scans; users see the indexed-through block and whether more remains. Previously confirmed receipts may become reorganized when a later scan detects a deep fork; twelve blocks is a product confirmation policy, not irreversible consensus finality.

## Validation and deployment

Unit tests exercise quantities, chain/account validation, signing boundaries and finality thresholds. Cucumber uses disposable MongoDB databases and a real local Ganache EVM to deploy the actual compiled contract, transfer native ETH/ERC-20, check recipient balances, index receipts, reject unauthorized/overprecision/overspending operations, verify reverted transactions and roll back/reindex a chain snapshot. Browser acceptance uses real React/API/database/EVM traffic without API interception; its EIP-1193 adapter is connected to disposable unlocked local test accounts and estimates gas like a wallet. Ganache uses its JavaScript fallback on Node 24; native optional-module warnings are not skipped tests.

Public Sepolia verification requires network access to an approved provider, an active network, a connected test wallet and faucet ETH; deployment, sending and receipts must be checked separately on the intended service. Administrators must update and resume existing paused configurations explicitly; the self-service preset does not override them. Never use mainnet funds or send wallet keys through chat.
