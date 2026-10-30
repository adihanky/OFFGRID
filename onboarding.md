# Current handover

Updated: 30 October 2026. The user explicitly authorized publishing the current chat and wallet-switch implementation to repository `main`. No independent background coding job is running.

## Saved source

Local branch `work`, baseline `b62bdac`. Remote `main` was verified at the same full baseline SHA before publication. This handover accompanies the chat/wallet-switch changeset authorized for `main`; use current local/remote Git state to verify its final commit. Prior design documentation changes are included. No deployment, service restart, wallet transaction or data migration is part of publication.

Wallet/Send/Settings/Activity now default to **Network / testnet wallets**, with accessible buttons for legacy simulated wallets. Legacy WalletPanel first mounts on selection and retains its draft thereafter; reload/account changes reset the selection. Existing legacy browser fixtures now select legacy explicitly. A bounded subagent implemented this switch and its focused tests; the primary agent integrated the chat work and validation.

Chat has shared contracts, registered participant-authorized REST endpoints, additive validators/indexes, canonical direct conversations, stable-ID text messages, ordered history, unread/private read state, blocking and a Chat screen. Messages/counters/events persist transactionally; chat events do not enter the demo transfer outbox. The visible thread/inbox use five-second polling and focus refresh, with paginated gap recovery. Private text/uncertain message IDs stay in memory per conversation and clear on account change/sign-out. In-chat crypto, receive-address cards, shared receipts and sockets remain later stages. See [design and implementation status](docs/CHAT_AND_CRYPTO_SHARING.md).

## Verification

Production `npm run build`, application/test type checks, lint, formatting and diff checks pass. Focused chat, wallet-switch and navigation units pass **15 cases**, no failures/errors/skips, in `.local/test-results/chat-wallet-unit.xml`. The subagent's three wallet-selection cases also pass in `wallet-view-unit.xml`. Reports were inspected for nonempty cases and failure/error/skip elements.

Commands use `PATH=/workspace/OFFGRID/.tools/node-v24.22.1-linux-x64/bin:$PATH`. The focused report command is `TSX_TSCONFIG_PATH=tests/tsconfig.json node --import=tsx --test --test-isolation=none --test-reporter=spec --test-reporter=junit --test-reporter-destination=stdout --test-reporter-destination=.local/test-results/chat-wallet-unit.xml tests/unit/chat.test.mts tests/unit/wallet-view.test.mts tests/unit/workspace-navigation.test.mts`.

The initial full unit run failed in three files: new chat cursor validation (fixed), navigation count after adding Chat (fixed), and the existing wallet-setup real HTTP transport case, which remains blocked by `listen EPERM 127.0.0.1`. A focused rerun confirmed the fixes and that networking failure. Full unit regression is not passing/complete.

Executable Cucumber scenarios/steps exist for chat happy/negative/edge paths, duplicates/privacy/CSRF/blocking, walletless users, restart and a 55-message gap. The three attempted API chat scenarios failed at fixture startup with `connect EPERM 127.0.0.1:27017`; their later steps were skipped. Three wallet-view browser scenarios likewise failed at `listen EPERM 127.0.0.1`. A new two-browser chat scenario is written/typechecked but unexecuted. No passing functional or live-browser result is claimed. Network-permission command calls stalled and were cancelled by the user; do not repeatedly request them without resolving the execution issue. This is a sandbox localhost restriction, not application configuration. Backgrounding commands cannot bypass it.

## Live target and next action

Verified configured target: development, MongoDB `127.0.0.1:27017`, database `p2p_offgrid`, API port 3000, web origin `http://localhost:5173`. A MongoDB process exists. No API/Vite process was running during inspection; sandbox curl could not connect. No browser-to-API-to-database flow or screenshot was obtained. Do not claim live delivery or infer that the user's machine shares this environment.

Next resolve sandbox permission handling for localhost TCP/listening. Then run the focused executable scenarios with `P2P_TEST_BROWSER_EXECUTABLE=/usr/bin/chromium node scripts/test.mjs functional --tags '@chat or @wallet_view'`, inspect XML/HTML for failures/skips/undefined steps, and run the required full regressions. Use only isolated synthetic fixture databases. Re-establish the user's intended service URL/served version before starting services, then verify chat and both wallet modes through that exact URL and record screenshots/actions/persisted outcomes. Public Sepolia signing/funding/send acceptance remains separate and unverified. No private keys or real funds are required for chat/wallet-display verification.
