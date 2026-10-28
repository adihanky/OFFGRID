# Current handover

Updated: 28 October 2026. The user reported Sepolia provider errors at `http://localhost:5173`. Branch `main` has uncommitted network, administrator UI, test and documentation changes; check `git status` and preserve them.

## Current state

Sepolia's configured dRPC provider rejected requests. PublicNode serves Sepolia but prunes genesis, so the implementation now checks chain ID and the canonical block 5,000,000 checkpoint while retaining the existing genesis identity. Other networks still check genesis. See [testnet design](docs/TESTNET_WALLET.md) and [network configuration](docs/NETWORKS.md). The administrator screen shows the saved provider and applies edits when resuming the selected paused network. The user resumed the local record through the administrator UI.

At 21:22–21:23 IST on 28 October, the running local database showed Sepolia `ACTIVE`, revision 7, with `https://ethereum-sepolia-rpc.publicnode.com/`. A fresh synthetic account's `POST /api/v2/wallet/testnet` through `http://localhost:5173` returned the active canonical Sepolia network. The user reported successful activation. The dev API and Vite processes were running, with MongoDB on 27017. Synthetic `rpc_…@example.invalid` identities created for diagnosis remain in the application database. No live screenshot was captured; browser wallet ownership, faucet funding, deployment and public Sepolia transfer remain unverified. Preserve existing data and do not request wallet keys or use mainnet funds.

## Verification and next action

The current unit run produced `.local/test-results/unit.xml`: 229 cases, no failures/errors/skips. Focused `@testnet_wallet` Cucumber run passed 6 scenarios / 52 steps; its JUnit report was copied to `.local/test-results/sepolia-focused.xml`. The administrator browser scenario passed 1 scenario / 9 steps, including failure and successful resume with an edited provider; `.local/test-results/functional.xml` contains that focused run, and its fixture screenshot is `.local/test-results/wallet-setup/asset-network-ui.png`. Lint, application and test type checks, production build and formatting passed. The complete `npm run check` was interrupted after 13 passing functional scenarios because it progressed very slowly; full functional coverage is unfinished. Ganache reports a Node 24 native-module fallback. Tests used isolated MongoDB on port 27018 and installed Chrome.

Next verify the user's actual browser wallet connection, testnet funding and transfer receipt on the running URL using an authorized test wallet, and complete the full functional regression when practical. Recheck processes and network state first. See [testing guide](tests/README.md) for commands and prerequisites.
