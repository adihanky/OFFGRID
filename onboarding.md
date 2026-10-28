# Current handover

Updated: 28 October 2026. User requested completion of testnet wallet support, ERC-20 execution, indexed chain history and publication to main.

## Implementation and repository

Started on clean remote baseline origin/main 4ac8b22 plus the prior authorized, uncommitted unified-wallet implementation. Preserve the combined work. Publication to main is authorized; verify actual Git status and remote HEAD before continuing. No production deployment, old-data migration or conversion of simulated funds occurred.

Read AGENTS.md, orchestrator.md, README.md, docs/HIGH_LEVEL_DESIGN.md and [the authoritative testnet design](docs/TESTNET_WALLET.md). The user-facing wallet supports self-service canonical Sepolia configuration, signed EOA ownership, native ETH and imported ERC-20 balances, browser-wallet native/token sending, test-token deployment/claims, persistent submission hashes and on-chain Activity. Legacy simulated assets remain labelled and intact.

The separate chain collections hold imported token metadata, receipts/Transfer events and durable scan checkpoints. Scoped endpoints enforce ownership, Origin/CSRF and RPC destination/identity restrictions. A serial background indexer and explicit sync share leases and transactional checkpoints. It distinguishes pending/mined/12-block confirmed/reverted/reorganized evidence, rewinds after a changed checkpoint and retains orphaned records. History remains readable during RPC outages; the scan range, last-sync time and background errors are visible. The initial range starts 20 blocks before subscription, advances in bounded chunks and excludes internal contract ETH traces. These are explicit coverage limits, not a claim of genesis-wide history or irreversible finality.

The test-only Solidity token uses pinned OpenZeppelin and solc, restricts deployment to Sepolia/local chain IDs and mints only test units. Rebuild the committed browser bytecode with npm run build:test-token. No private keys are stored by the application.

## Verification

The complete functional run passed **267 scenarios / 2779 steps**, with no failures or skipped/undefined/pending outcomes. It includes real local EVM deployment, native/ERC-20 transfers, recipient balances, idempotent indexing, reverted execution, EVM snapshot rollback/reindexing and real browser→API→MongoDB→EVM deployment/import/send/reload/Activity. No API interception is used in that browser scenario; its wallet adapter estimates gas and submits to disposable local unlocked accounts. Screenshot: .local/test-results/chain-wallet/real-evm.png. Logs: .local/onboarding/chain-full-functional.log and chain-browser.log.

The final unit suite passed **226 tests**, including trusted HTTPS-proxy routing. Inspected current unit.xml and functional.xml: 226 and 267 cases, zero failures/errors/skips. Lint, application/test type checks, production build, formatting and the running-service smoke check passed. Unit log: .local/onboarding/chain-final-unit.log; formatting log: .local/onboarding/chain-final-format.log. One earlier full run was stopped because its shell omitted P2P_TEST_BROWSER_EXECUTABLE; the complete functional rerun above used Chromium and supersedes it. Ganache falls back to JavaScript on Node 24 and emits native-module/listener warnings; no scenarios are skipped for those warnings.

## Runtime and public-chain blocker

Activate .tools/node-v24.22.1-linux-x64/bin in PATH and export P2P_TEST_BROWSER_EXECUTABLE=/usr/bin/chromium. Use docker compose -f compose.yaml -f .local/onboarding/compose.cloud.yaml up -d --wait with the retained 64000 open-file limit. Tests use disposable databases and sequential workers. The dev API/frontend use ports 3000/5173; live processes must be rechecked/restarted after updates.

The fixed public providers now support the environment's explicit HTTPS egress proxy without disabling TLS validation, host restrictions or redirect/response limits. Custom destinations retain direct DNS validation/pinning. A real public Sepolia request through the updated transport still fails because runtime network policy denies access. ethereum-sepolia-rpc.publicnode.com is already in the saved environment draft; apply/save the network change and publish the cloud environment as required, then verify real Sepolia identity, linking, faucet funding, deployment and payment receipts. Draft saving and Git pushing do not activate network settings or deploy to the user's separate local machine.

Public Sepolia payment remains unverified; the local EVM tests are genuine contract execution, not public-network evidence. Never request seed phrases/private keys or use mainnet funds. No independent subagent/reviewer was used.
