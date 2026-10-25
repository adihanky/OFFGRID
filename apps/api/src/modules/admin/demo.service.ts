import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import type { DemoProfile, SeedPreview, TransferView } from '@p2p/contracts';
import { AdminService } from './admin.service.js';
import { AuthService } from '../auth/auth.service.js';
import { PasswordService } from '../auth/auth.crypto.js';
import { assertDemoTarget, validateDemoPassword } from '../accounts/demo-target.js';
import { parseInput } from '../assets/asset-input.js';
import { TransfersService } from '../transfers/transfers.service.js';

const profileSchema = z.strictObject({
  userCount: z.number().int().min(2).max(100),
  transferDepth: z.number().int().min(0).max(100),
});
const names = ['alice', 'bob', 'carol', 'dana'];
export const demoHandles = (count: number) =>
  Array.from({ length: count }, (_, i) => `sample_${names[i] ?? `peer_${i + 1}`}`);
export function seedProfileHash(profile: DemoProfile) {
  return createHash('sha256')
    .update(JSON.stringify(['wallet-demo-v2', profile.userCount, profile.transferDepth]))
    .digest('hex');
}
export function seedTransferKey(step: string) {
  const value = createHash('sha256').update(`wallet-demo-v2:${step}`).digest('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
}
/** A worker may claim admission before the seed caller. Poll that exact ID; never resubmit a payment. */
export async function waitForSeedTransfer(
  initial: TransferView,
  read: () => Promise<{ transfer: TransferView }>,
  pause: () => Promise<unknown> = () => wait(200),
  attempts = 225,
) {
  let transfer = initial;
  for (let i = 0; transfer.status === 'PENDING' && i < attempts; i++) {
    await pause();
    const next = (await read()).transfer;
    if (next.id !== initial.id) throw new Error('Seed outcome identity changed.');
    transfer = next;
  }
  if (transfer.status !== 'COMMITTED')
    throw new BadRequestException(
      'Seed transfer is unresolved or rejected. Resume this run after resolving its outcome.',
    );
  return transfer;
}
export function demoTransfers(profile: DemoProfile) {
  const handles = demoHandles(profile.userCount);
  const first =
    profile.userCount >= 4
      ? [
          { from: handles[0]!, to: handles[1]!, code: 'DEMO', quantity: '125.25' },
          { from: handles[1]!, to: handles[2]!, code: 'DEMO', quantity: '1100.00' },
          { from: handles[2]!, to: handles[3]!, code: 'DEMO', quantity: '0.01' },
        ]
      : [{ from: handles[0]!, to: handles[1]!, code: 'DEMO', quantity: '125.25' }];
  const result = first.slice(0, profile.transferDepth);
  for (let i = result.length; i < profile.transferDepth; i++)
    result.push({
      from: handles[i % handles.length]!,
      to: handles[(i + 1) % handles.length]!,
      code: 'DEMO',
      quantity: '0.01',
    });
  if (profile.transferDepth > 0)
    result.push({ from: handles[0]!, to: handles.at(-1)!, code: 'DETH', quantity: '0.00000001' });
  return result;
}

@Injectable()
export class DemoService {
  constructor(
    @Inject(AdminService) readonly admin: AdminService,
    @Inject(AuthService) readonly auth: AuthService,
    @Inject(PasswordService) readonly passwords: PasswordService,
    @Inject(TransfersService) readonly transfers: TransfersService,
  ) {}
  async verifyFinancialState() {
    const results = await Promise.all([
      this.admin.accounts.custody.verify(),
      this.admin.accounts.ledger.reconcile(),
      this.transfers.chain.verify(),
    ]);
    if (results.some((result) => !result.ok))
      throw new Error('Demo financial reconciliation failed. No balances were reset.');
  }
  async status(actor: string) {
    assertDemoTarget(this.admin.environment);
    return this.admin.transaction(actor, 'DEMO_OPERATOR', async (session) => {
      const run = await this.admin.database.db
        .collection('seedRuns')
        .findOne({ key: 'wallet-demo-v2' }, { session });
      return run
        ? {
            state: run['state'] as string,
            operations: run['operations'] as number,
            resumeAfter: run['token'] ? (run['leaseUntil'] as Date).toISOString() : null,
          }
        : { state: 'NOT_STARTED', operations: 0, resumeAfter: null };
    });
  }
  async preview(actor: string, value: unknown): Promise<SeedPreview> {
    assertDemoTarget(this.admin.environment);
    const profile = parseInput(profileSchema, value);
    await this.admin.transaction(actor, 'DEMO_OPERATOR', async () => undefined);
    const id = new ObjectId();
    const preview: SeedPreview = {
      id: id.toHexString(),
      profile,
      profileHash: seedProfileHash(profile),
      expiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
      users: demoHandles(profile.userCount).map((handle) => ({
        handle,
        email: `${handle}@example.invalid`,
      })),
      allocations: [
        { code: 'DEMO', quantityPerUser: '1000.00' },
        { code: 'DETH', quantityPerUser: '2.00000000' },
      ],
      transferCount: demoTransfers(profile).length,
    };
    for (const user of preview.users) {
      const existing = await this.auth.store.findUser(user.email);
      if (
        existing &&
        (existing.publicHandle !== user.handle ||
          existing.status !== 'active' ||
          existing.googleSubject)
      )
        throw new ConflictException('A synthetic identity conflicts with existing data.');
    }
    await this.admin.database.db
      .collection('seedPreviews')
      .insertOne({ _id: id, actor, preview, expiresAt: new Date(preview.expiresAt) });
    return preview;
  }
  async run(actor: string, value: unknown) {
    assertDemoTarget(this.admin.environment);
    const input = parseInput(
      z.strictObject({
        previewId: z.string().regex(/^[a-f0-9]{24}$/),
        password: z.string().min(12).max(128),
      }),
      value,
    );
    validateDemoPassword(input.password);
    await this.admin.transaction(actor, 'DEMO_OPERATOR', async () => undefined);
    const record = await this.admin.database.db
      .collection<{ _id: ObjectId; actor: string; preview: SeedPreview; expiresAt: Date }>(
        'seedPreviews',
      )
      .findOne({ _id: new ObjectId(input.previewId), actor, expiresAt: { $gt: new Date() } });
    if (!record) throw new ConflictException('Preview expired. Preview the profile again.');
    const preview = record.preview;
    const runs = this.admin.database.db.collection('seedRuns');
    const old = await runs.findOne({ key: 'wallet-demo-v2' });
    if (old && old['profileHash'] !== preview.profileHash)
      throw new ConflictException(
        'A different profile already owns this seed run. Existing demo data is preserved.',
      );
    // Validate every existing identity and asset before creating any domain data.
    for (const user of preview.users) {
      const existing = await this.auth.store.findUser(user.email);
      if (
        existing &&
        (existing.publicHandle !== user.handle ||
          existing.displayName !== user.handle ||
          existing.googleSubject ||
          existing.status !== 'active' ||
          !(await this.passwords.verify(input.password, existing.passwordHash)))
      )
        throw new ConflictException(
          'Demo identity or password conflicts. No identity was overwritten.',
        );
    }
    for (const code of ['DEMO', 'DETH']) {
      const asset = await this.admin.accounts.assets.findOne({ code });
      if (
        asset &&
        (asset.precision !== (code === 'DEMO' ? 2 : 8) ||
          asset.status !== 'active' ||
          !asset.custodyEnabled)
      )
        throw new ConflictException('Demo asset needs migration or has conflicting configuration.');
    }
    if (old?.['state'] === 'COMPLETED') {
      await this.verifyFinancialState();
      return {
        state: 'COMPLETED',
        alreadyComplete: true,
        users: preview.users,
        operations: old['operations'] as number,
      };
    }
    if (!old) {
      try {
        await runs.insertOne({
          key: 'wallet-demo-v2',
          profileHash: preview.profileHash,
          state: 'READY',
          token: null,
          operations: 0,
        });
      } catch {
        throw new ConflictException('Seed run changed. Retry the same preview.');
      }
    }
    const token = randomUUID();
    const lease = await runs.findOneAndUpdate(
      {
        key: 'wallet-demo-v2',
        profileHash: preview.profileHash,
        $or: [{ token: null }, { leaseUntil: { $lt: new Date() } }],
      },
      { $set: { token, leaseUntil: new Date(Date.now() + 10 * 60000), state: 'RUNNING' } },
      { returnDocument: 'after' },
    );
    if (!lease) throw new ConflictException('This seed run is already active.');
    let operations = 0;
    const checkpoint = async () => {
      operations++;
      if (
        (
          await runs.updateOne(
            { _id: lease._id, token },
            { $set: { operations, leaseUntil: new Date(Date.now() + 10 * 60000) } },
          )
        ).matchedCount !== 1
      )
        throw new ConflictException('Seed run lease changed. Resume the same run.');
    };
    try {
      const users = new Map<string, ObjectId>();
      for (const user of preview.users) {
        await this.admin.transaction(actor, 'DEMO_OPERATOR', async () => undefined);
        let stored = await this.auth.store.findUser(user.email);
        if (!stored) {
          const result = await this.auth.signUp({
            email: user.email,
            password: input.password,
            publicHandle: user.handle,
          });
          await this.auth.signOut(result.token);
          stored = await this.auth.store.findUser(user.email);
        }
        if (!stored) throw new Error('Synthetic identity creation failed.');
        users.set(user.handle, stored._id);
        await checkpoint();
      }
      const assets = new Map<string, ObjectId>();
      for (const code of ['DEMO', 'DETH']) {
        await this.admin.transaction(actor, 'DEMO_OPERATOR', async () => undefined);
        const oldAsset = await this.admin.accounts.assets.findOne({ code });
        const asset =
          oldAsset ??
          (await this.admin.accounts.createAsset({
            code,
            displayName: code === 'DEMO' ? 'Demo credits' : 'Demo Ether',
            precision: code === 'DEMO' ? 2 : 8,
          }));
        assets.set(code, asset._id);
        for (const [handle, userId] of users) {
          await this.admin.accounts.issueDemo({
            fixtureKey: `wallet-demo-v2:${handle}:${code}`,
            assetId: asset._id,
            userId,
            quantityUnits: code === 'DEMO' ? 100000n : 200000000n,
            authorize: (session) => this.admin.authorize(actor, 'DEMO_OPERATOR', session),
            onCreated: (issuance, session) =>
              this.admin.audit(
                actor,
                'SEED_ISSUED',
                issuance._id,
                'Wallet demo profile v2',
                session,
              ),
          });
          await checkpoint();
        }
      }
      for (const [i, transfer] of demoTransfers(preview.profile).entries()) {
        await this.admin.transaction(actor, 'DEMO_OPERATOR', async () => undefined);
        const result = await this.transfers.submit(
          users.get(transfer.from)!.toHexString(),
          {
            recipientId: users.get(transfer.to)!.toHexString(),
            assetId: assets.get(transfer.code)!.toHexString(),
            quantity: transfer.quantity,
          },
          seedTransferKey(String(i)),
        );
        await waitForSeedTransfer(result.transfer, () =>
          this.transfers.detail(users.get(transfer.from)!.toHexString(), result.transfer.id),
        );
        await checkpoint();
      }
      await this.verifyFinancialState();
      await this.admin.transaction(actor, 'DEMO_OPERATOR', (session) =>
        this.admin.audit(actor, 'SEED_COMPLETED', lease._id, 'Wallet demo profile v2', session),
      );
      await runs.updateOne(
        { _id: lease._id, token },
        { $set: { state: 'COMPLETED', token: null, completedAt: new Date(), operations } },
      );
      return { state: 'COMPLETED', alreadyComplete: false, users: preview.users, operations };
    } catch (error) {
      await runs.updateOne(
        { _id: lease._id, token },
        { $set: { state: 'INCOMPLETE', token: null, operations } },
      );
      throw error;
    }
  }
}
