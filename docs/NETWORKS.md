# EVM network configuration and ownership proofs

The [network module](../apps/api/src/modules/networks/networks.service.ts) provides verified local/testnet network identities for external-address linking. The [unified testnet wallet](TESTNET_WALLET.md) adds a self-service Sepolia preset, native ETH balance reads and browser-wallet payments. ERC-20 payments and receipt/event indexing are described in that design. Mainnet remains unavailable. The complete settlement target remains in the [overhaul LLD](WALLET_ASSET_OVERHAUL_LLD.md).

## Configuration and trust boundary

An ASSET_ADMIN uses **Administration → Networks** to add a display name, expected decimal chain ID, LOCAL/TESTNET environment and public RPC root URL. The server queries `eth_chainId` and the genesis block hash before saving, except for Sepolia testnet, which uses the fixed historical checkpoint described in [the testnet design](TESTNET_WALLET.md) and stores its canonical genesis identity. The chain ID/genesis pair is unique and immutable; changing networks requires a distinct identity. Administrators can change the name/provider, pause or resume using the expected revision and a reason. Provider changes/resume reverify the original chain identity. Updates, immutable configuration snapshots and audit entries commit together. Pausing is available even when the provider is unavailable.

When managing a paused network, **Verify & resume network** applies the URL and name currently in that network's edit form as part of the verified, audited resume. The configured network list shows the saved RPC URL; a failed verification leaves its saved settings and paused state unchanged.

Only the supported testnet IDs in source and guarded local targets are accepted. Public HTTPS hosts must occur in server `EVM_RPC_ALLOWED_HOSTS`; defaults include `sepolia.drpc.org` and `ethereum-sepolia-rpc.publicnode.com`. RPC credentials, URL paths, query strings and fragments are rejected; providers requiring API keys are not supported by this implementation. No secret is returned to the browser. Local HTTP is limited to loopback on the existing development/test database guard.

The [transport](../apps/api/src/modules/networks/rpc.ts) resolves approved hosts, rejects nonpublic results, pins the selected address while preserving TLS hostname validation, refuses redirects, and limits the whole DNS/HTTP operation to five seconds and responses to 64 KiB. Network access is outside database transactions. Invalid or unavailable provider data returns 503 and cannot save a configuration or ownership binding. The current code supports only the read methods needed for identity and ordinary EOA code checks; the server never signs or broadcasts transactions; the connected browser wallet submits approved Sepolia payments.

| Endpoint                          | Access and result                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/v2/networks`            | Authenticated users; active names, IDs, chain identities and revisions, without provider URLs.                                 |
| `GET /api/v2/admin/networks`      | ASSET_ADMIN; configured networks and public provider URLs.                                                                     |
| `POST /api/v2/admin/networks`     | ASSET_ADMIN plus CSRF/Origin; verify identity and create with reason.                                                          |
| `POST /api/v2/admin/networks/:id` | ASSET_ADMIN plus CSRF/Origin; expected revision, ACTIVE/PAUSED, reason, optional displayName/rpcUrl; stale changes return 409. |

## External ownership lifecycle

**Set up wallet → External crypto wallet** requests accounts from an EIP-1193 browser provider, checks/switches the chosen chain and requests a `personal_sign` ownership signature. The application never asks for a private key or seed phrase. Manual challenge/signature entry is available for other signing tools. Cancellation, refusal or an account/network switch prevents verification; session changes unmount and abort the operation.

The [proof service](../apps/api/src/modules/wallets/external-wallet.service.ts) creates a five-minute message in ERC-4361 format, explicitly for linking without spending permission. It binds the configured origin, chain, wallet ID, current session hash, random nonce, issued/expiry times and challenge ID. Only the exact server-stored message is verified with ethers; callers cannot substitute message fields. Both challenge and verification recheck the configured chain/genesis and reject contract/delegated accounts; this release supports ordinary EOAs only.

Verification atomically fences the active user, wallet and network revision, consumes the still-live session-bound challenge, updates/inserts the unique binding and records a proof digest audit. Invalid signatures, expired/consumed challenges, stale network revisions and other sessions cannot write bindings. Raw signatures are not retained. Temporary challenges expire by TTL, independently of application expiry checks; durable audit retains message/signature digests and verification metadata.

An address belongs to one registered wallet per network for its lifetime. Revocation preserves the row and uniqueness. The same owner can prove control again; replacement by a different address or reassignment to another user is unsupported. Revocation does not require a functioning RPC. Proof establishes control at verification time, not future key possession or legal identity.

The [unit tests](../tests/unit/wallet-setup.test.mts), [API scenarios](../tests/features/wallet-setup.feature) and [real browser scenarios](../tests/features/wallet-setup-browser.feature) cover signatures, privacy, replay, expiry/session scope, concurrent claims, revocation/reverification, provider identity, SSRF boundaries, role/CSRF/revision checks and visible configuration. Automated tests use disposable databases, real disposable signing keys and controlled local RPC/provider fixtures; no production data, external account login or paid transactions. Live evidence and current results belong in [onboarding](../onboarding.md).

Protocol/library references: [ERC-4361](https://eips.ethereum.org/EIPS/eip-4361), [ethers message signing and recovery](https://docs.ethers.org/v6/getting-started/), [MetaMask provider methods](https://docs.metamask.io/quickstart/).
