import { ObjectId, type ClientSession } from 'mongodb';
import type { WalletsService } from '../../apps/api/src/modules/wallets/wallets.service.js';
import type { DatabaseService } from '../../apps/api/src/database/database.service.js';
import type { AccountsService } from '../../apps/api/src/modules/accounts/accounts.service.js';
import type { IdentityEligibility } from '../../apps/api/src/modules/auth/identity-eligibility.service.js';
import type { LedgerService } from '../../apps/api/src/modules/ledger/ledger.service.js';
import type { ChainService } from '../../apps/api/src/modules/chain/chain.service.js';
import type { OutboxService } from '../../apps/api/src/workers/outbox.service.js';
import { TransfersService } from '../../apps/api/src/modules/transfers/transfers.service.js';
import type { TransferRecord } from '../../apps/api/src/modules/transfers/transfers.models.js';
import { toLong } from '../../apps/api/src/modules/accounts/quantity.js';

export function transferUnitFixture() {
  const senderId = new ObjectId();
  const recipientId = new ObjectId();
  const assetId = new ObjectId();
  const senderAccountId = new ObjectId();
  const recipientAccountId = new ObjectId();
  const now = new Date('2026-10-24T00:00:00.000Z');
  const record: TransferRecord = {
    _id: new ObjectId(),
    senderId,
    recipientId,
    assetId,
    quantityUnits: toLong(325n),
    idempotencyKey: 'ce706c77-6a1b-4546-b471-f752c8d451fa',
    payloadVersion: 1,
    payloadHash: 'hash',
    status: 'PENDING',
    rejectionCode: null,
    sender: { id: senderId.toHexString(), publicHandle: 'alice', displayName: 'Alice' },
    recipient: { id: recipientId.toHexString(), publicHandle: 'bob', displayName: 'Bob' },
    asset: { id: assetId.toHexString(), code: 'DEMO', displayName: 'Demo', precision: 2 },
    attemptToken: 'claim-one',
    leaseUntil: new Date(now.getTime() + 30000),
    attempts: 1,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  };
  const state = {
    debit: 0,
    credit: 0,
    ledger: 0,
    custody: 0,
    chain: 0,
    outbox: 0,
    eligible: true,
    accountActive: true,
    debitAllowed: true,
    creditAllowed: true,
    sessionChecks: 0,
  };
  const check = (passed: ClientSession) => {
    if (passed !== session) throw new Error('Wrong transaction session');
    state.sessionChecks++;
  };
  const matches = (filter: Record<string, unknown>) =>
    (filter['status'] === undefined || filter['status'] === record.status) &&
    (filter['attemptToken'] === undefined || filter['attemptToken'] === record.attemptToken);
  const transfers = {
    updateOne: async (
      filter: Record<string, unknown>,
      update: { $set?: Record<string, unknown> },
      options?: { session?: ClientSession },
    ) => {
      if (options?.session) check(options.session);
      if (!matches(filter)) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(record, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    findOne: async () => record,
  };
  const session = {
    withTransaction: async (callback: () => Promise<unknown>) => {
      const snapshot = { ...record };
      const counts = { ...state };
      try {
        return await callback();
      } catch (error) {
        for (const key of Object.keys(record))
          if (!(key in snapshot)) delete (record as unknown as Record<string, unknown>)[key];
        Object.assign(record, snapshot);
        Object.assign(state, counts);
        throw error;
      }
    },
    endSession: async () => undefined,
  } as unknown as ClientSession;
  const database = {
    db: { collection: () => transfers },
    client: { startSession: () => session },
  } as unknown as DatabaseService;
  const accounts = {
    prepareWallets: async (_asset: ObjectId, users: ObjectId[], passed: ClientSession) => {
      check(passed);
      return new Map(users.map((id) => [id.toHexString(), { _id: id }]));
    },
    custody: {
      write: async (_input: unknown, passed: ClientSession) => {
        check(passed);
        state.custody++;
      },
    },
    ensureUser: async (id: ObjectId, _asset: ObjectId, passed: ClientSession) => {
      check(passed);
      return {
        _id: id.equals(senderId) ? senderAccountId : recipientAccountId,
        status: state.accountActive ? 'active' : 'disabled',
      };
    },
    accounts: {
      updateOne: async (
        filter: { _id: ObjectId },
        _update: unknown,
        options: { session: ClientSession },
      ) => {
        check(options.session);
        const isDebit = filter._id.equals(senderAccountId);
        if (isDebit ? !state.debitAllowed : !state.creditAllowed) return { modifiedCount: 0 };
        if (isDebit) state.debit++;
        else state.credit++;
        return { modifiedCount: 1 };
      },
    },
  } as unknown as AccountsService;
  const identities = {
    fence: async (_id: ObjectId, passed: ClientSession) => {
      check(passed);
      return state.eligible;
    },
  } as unknown as IdentityEligibility;
  const ledger = {
    pair: async (_pair: unknown, passed: ClientSession) => {
      check(passed);
      state.ledger++;
    },
  } as unknown as LedgerService;
  const chain = {
    append: async (
      _record: unknown,
      _sender: unknown,
      _recipient: unknown,
      _time: unknown,
      passed: ClientSession,
    ) => {
      check(passed);
      state.chain++;
    },
  } as unknown as ChainService;
  const outbox = {
    committed: async (_record: unknown, _time: unknown, passed: ClientSession) => {
      check(passed);
      state.outbox++;
    },
  } as unknown as OutboxService;
  const service = new TransfersService(
    database,
    accounts,
    identities,
    ledger,
    chain,
    outbox,
    {} as WalletsService,
  );
  service.now = () => now;
  return { service, record, state, session, now };
}
