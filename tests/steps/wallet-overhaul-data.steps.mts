import 'reflect-metadata';
import assert from 'node:assert/strict';
import { After, Given, When, Then } from '@cucumber/cucumber';
import { ObjectId } from 'mongodb';
import type { MigrationAssessment } from '@p2p/contracts';
import { readMigrationAssessment } from '../../apps/api/src/modules/wallets/migration-assessment.js';
import {
  parseChainQuantity,
  parseInput,
  sendIntentSchema,
} from '../../apps/api/src/modules/assets/asset-input.js';
import { createTransferHarness, type TransferHarness } from '../support/transfer-harness.mjs';
import { transferUnitFixture } from '../support/transfer-unit-fixture.mjs';

interface AssessmentWorld {
  assessmentHarness?: TransferHarness;
  assessmentCleanupStarted?: boolean;
  assessment?: MigrationAssessment;
  assessmentSnapshot?: string;
  overhaulBody?: unknown;
  overhaulQuantity?: string;
  overhaulUnits?: bigint;
  overhaulError?: unknown;
}
async function dump(h: TransferHarness) {
  const collections = (await h.database.db.listCollections().toArray()).map((i) => i.name).sort();
  const data: Record<string, unknown> = {};
  for (const name of collections) {
    const rows = await h.database.db
      .collection(name, { promoteLongs: false })
      .find({})
      .sort({ _id: 1 })
      .toArray();
    data[name] = rows;
  }
  return JSON.stringify(data);
}
Given(
  'an isolated legacy wallet assessment fixture',
  { timeout: 120000 },
  async function (this: AssessmentWorld) {
    const h = await createTransferHarness();
    if (this.assessmentCleanupStarted) {
      await h.close();
      throw new Error('Assessment fixture completed after scenario cleanup.');
    }
    this.assessmentHarness = h;
    const alice = await h.register('assess_alice');
    const asset = await h.accounts.createAsset({
      code: 'ASSESS',
      displayName: 'Assessment Demo',
      precision: 2,
    });
    // Deliberately reproduce the pre-overhaul schema in this disposable database.
    await h.database.db
      .collection('assetTypes')
      .updateOne({ _id: asset._id }, { $unset: { schemaVersion: '', custodyEnabled: '' } });
    await h.database.db.collection('custodyHeads').deleteOne({ assetId: asset._id });
    await h.database.db.collection('wallets').deleteMany({});
    await h.issue(alice, asset._id.toHexString(), 10000n);
    this.assessmentSnapshot = await dump(h);
  },
);
Given('its issuance credit journal entry is missing', async function (this: AssessmentWorld) {
  await this.assessmentHarness!.database.db.collection('ledgerEntries').deleteOne({
    side: 'credit',
  });
  this.assessmentSnapshot = await dump(this.assessmentHarness!);
});
Given('a durable pending transfer exists for assessment', async function (this: AssessmentWorld) {
  const h = this.assessmentHarness!;
  const fixture = transferUnitFixture();
  await h.database.db.collection('transfers').insertOne(fixture.record);
  this.assessmentSnapshot = await dump(h);
});
When(
  'the read-only wallet migration assessment runs',
  { timeout: 60000 },
  async function (this: AssessmentWorld) {
    this.assessment = await readMigrationAssessment(this.assessmentHarness!.database.db);
  },
);
When(
  'the read-only wallet migration assessment runs twice',
  { timeout: 60000 },
  async function (this: AssessmentWorld) {
    const first = await readMigrationAssessment(this.assessmentHarness!.database.db);
    this.assessment = await readMigrationAssessment(this.assessmentHarness!.database.db);
    assert.deepEqual({ ...first, assessedAt: '' }, { ...this.assessment, assessedAt: '' });
  },
);
Then(
  'the assessment requires a migrated provenance policy with exact supply',
  function (this: AssessmentWorld) {
    assert.equal(this.assessment!.state, 'POLICY_REQUIRED');
    assert.deepEqual(this.assessment!.blockers, []);
    assert.equal(this.assessment!.assets[0]!.userUnits, '10000');
    assert.equal(this.assessment!.assets[0]!.systemUnits, '-10000');
    assert.equal(this.assessment!.assets[0]!.provenance, 'MIGRATED_POLICY_REQUIRED');
    assert.ok(
      this.assessment!.collections.every(
        (c) =>
          (c.validatorPresent && c.indexes.length > 0) ||
          ['wallets', 'walletBindings', 'roleGrants'].includes(c.name),
      ),
    );
  },
);
Then('the assessment is blocked by {string}', function (this: AssessmentWorld, code: string) {
  assert.equal(this.assessment!.state, 'BLOCKED');
  assert.ok(this.assessment!.blockers.some((i) => i.code === code));
});
Then('the assessment has not changed the database', async function (this: AssessmentWorld) {
  assert.equal(this.assessment!.cutoverEnabled, false);
  assert.equal(await dump(this.assessmentHarness!), this.assessmentSnapshot);
});
Given('an overhaul send request with a caller selected sender', function (this: AssessmentWorld) {
  const id = new ObjectId().toHexString();
  this.overhaulBody = {
    recipientResolutionId: id,
    senderWalletId: id,
    assetId: id,
    quantity: '1',
    senderId: id,
  };
});
When('the overhaul contract is validated', function (this: AssessmentWorld) {
  try {
    parseInput(sendIntentSchema, this.overhaulBody);
  } catch (error) {
    this.overhaulError = error;
  }
});
Given('an overhaul chain quantity of {string}', function (this: AssessmentWorld, value: string) {
  this.overhaulQuantity = value;
});
When('the chain quantity is parsed at precision eighteen', function (this: AssessmentWorld) {
  try {
    this.overhaulUnits = parseChainQuantity(this.overhaulQuantity, 18);
  } catch (error) {
    this.overhaulError = error;
  }
});
Then('the chain quantity is exactly one base unit', function (this: AssessmentWorld) {
  assert.equal(this.overhaulUnits, 1n);
  assert.equal(this.overhaulError, undefined);
});
Then('the overhaul request is rejected before persistence', function (this: AssessmentWorld) {
  assert.ok(this.overhaulError);
});
After(async function (this: AssessmentWorld) {
  this.assessmentCleanupStarted = true;
  await this.assessmentHarness?.close();
});
