# Background workers

Reserved for transactional outbox delivery, pending-transfer recovery, and ledger/chain reconciliation. These workers will be implemented with the transfer and chat modules. No background job currently executes.

The draft [Wallet and Transfer HLD](../../../../docs/WALLET_AND_TRANSFER.md) and [LLD/code handoff](../../../../docs/WALLET_AND_TRANSFER_IMPLEMENTATION.md) define the next work. Pending-transfer recovery is part of completing transfers and must call the same fenced executor as HTTP, with leases, bounded backoff and shutdown handling. A timeout must not become a business rejection.

Outbox persistence belongs inside the first settlement transaction. Socket delivery can follow later; until a transport exists, retain undelivered events and reconcile status through REST. Do not mark events delivered to drain a placeholder worker. Create `docs/WORKERS.md` with lifecycle, deployment, failure and test details before implementing these jobs, and index it in `onboarding.md`. All behavior described in this paragraph is planned.
