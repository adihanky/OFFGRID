import { ObjectId } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { createTransferHarness } from './transfer-harness.mjs';
import { CustodyService } from '../../apps/api/src/modules/custody/custody.service.js';
import { WalletsService } from '../../apps/api/src/modules/wallets/wallets.service.js';

/** Disposable replica-set fixture using the real issuance/settlement coordinator. */
export async function createCustodyHarness() {
  const h = await createTransferHarness();
  try {
    const custody = h.app.get(CustodyService);
    const alice = await h.register('custody_alice');
    const bob = await h.register('custody_bob');
    const carol = await h.register('custody_carol');
    const asset = await h.accounts.createAsset({
      code: 'CUSTODY',
      displayName: 'Custody test demo',
      precision: 2,
    });
    const owners = new Map<string, { walletId: ObjectId; accountId: ObjectId }>();
    // Each writer invocation supplies a real replica-set transaction session.
    async function write(input: Parameters<CustodyService['write']>[0], fail = false) {
      const session = h.database.client.startSession();
      try {
        await session.withTransaction(async () => {
          await custody.write(input, session);
          if (fail) throw new Error('isolated custody rollback');
        });
      } finally {
        await session.endSession();
      }
    }
    for (const caller of [alice, bob, carol]) {
      const issuance = await h.issue(caller, asset._id.toHexString(), 100000n);
      const wallet = await h.app.get(WalletsService).own(caller.id);
      const owner = { walletId: new ObjectId(wallet.id), accountId: issuance.recipientAccountId };
      owners.set(caller.id, owner);
    }
    return {
      h,
      custody,
      alice,
      bob,
      carol,
      owners,
      asset,
      write,
      async send(sender: typeof alice, recipient: typeof alice, quantity: string) {
        const result = await h.transfers.submit(
          sender.id,
          { recipientId: recipient.id, assetId: asset._id.toHexString(), quantity },
          randomUUID(),
        );
        if (result.transfer.status !== 'COMMITTED')
          throw new Error('Fixture transfer did not commit.');
      },
    };
  } catch (error) {
    await h.close();
    throw error;
  }
}
export type CustodyHarness = Awaited<ReturnType<typeof createCustodyHarness>>;
