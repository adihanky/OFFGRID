import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { After, Given, When, Then } from '@cucumber/cucumber';
import { createCustodyHarness, type CustodyHarness } from '../support/custody-harness.mjs';
interface CustodyWorld {
  custodyHarness?: CustodyHarness;
  custodyBefore?: string;
  custodyFailure?: unknown;
}
async function graphSnapshot(h: CustodyHarness) {
  const rows = [];
  for (const name of ['custodyLots', 'custodyEvents', 'custodyEdges', 'custodyHeads'])
    rows.push(
      await h.h.database.db
        .collection(name, { promoteLongs: false })
        .find({})
        .sort({ _id: 1 })
        .toArray(),
    );
  return JSON.stringify(rows);
}
Given(
  'an isolated custody graph with three issued roots',
  { timeout: 60000 },
  async function (this: CustodyWorld) {
    this.custodyHarness = await createCustodyHarness();
  },
);
When(
  'Alice sends 125.25 to Bob and Bob sends 1100.00 to Carol in the custody fixture',
  async function (this: CustodyWorld) {
    const c = this.custodyHarness!;
    await c.send(c.alice, c.bob, '125.25');
    await c.send(c.bob, c.carol, '1100.00');
  },
);
Then(
  'the custody graph reconciles with exact recipient and change lots',
  async function (this: CustodyWorld) {
    const c = this.custodyHarness!;
    assert.deepEqual(await c.custody.verify(), { ok: true, issues: [] });
    for (const [caller, expected] of [
      [c.alice, 87475n],
      [c.bob, 2525n],
      [c.carol, 210000n],
    ] as const) {
      const lots = await c.custody.lots
        .find({ walletId: c.owners.get(caller.id)!.walletId, status: 'UNSPENT' })
        .toArray();
      assert.equal(
        lots.reduce((sum, l) => sum + l.quantityUnits.toBigInt(), 0n),
        expected,
      );
    }
    assert.equal(await c.custody.events.countDocuments(), 5);
  },
);
When('a custody allocation edge is removed', async function (this: CustodyWorld) {
  await this.custodyHarness!.custody.edges.deleteOne({});
});
Then('custody verification reports the broken graph', async function (this: CustodyWorld) {
  const result = await this.custodyHarness!.custody.verify();
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => /payload|input|output/.test(i)));
});
When('a custody write fails before its transaction commits', async function (this: CustodyWorld) {
  const c = this.custodyHarness!;
  this.custodyBefore = await graphSnapshot(c);
  try {
    await c.write(
      {
        kind: 'TRANSFER',
        referenceId: new ObjectId(),
        assetId: c.asset._id,
        sender: c.owners.get(c.alice.id)!,
        recipient: c.owners.get(c.bob.id)!,
        quantity: 1n,
        at: new Date(),
      },
      true,
    );
  } catch (error) {
    this.custodyFailure = error;
  }
});
Then(
  'the custody lots events edges and head remain unchanged',
  async function (this: CustodyWorld) {
    assert.match((this.custodyFailure as Error).message, /isolated custody rollback/);
    assert.equal(await graphSnapshot(this.custodyHarness!), this.custodyBefore);
    assert.deepEqual(await this.custodyHarness!.custody.verify(), { ok: true, issues: [] });
  },
);
When(
  'Alice transfers one base unit through the custody fixture',
  async function (this: CustodyWorld) {
    const c = this.custodyHarness!;
    await c.send(c.alice, c.bob, '0.01');
  },
);
Then(
  'one base unit has a recipient lot and the graph verifies',
  async function (this: CustodyWorld) {
    const c = this.custodyHarness!;
    const lot = await c.custody.lots
      .find({ walletId: c.owners.get(c.bob.id)!.walletId, status: 'UNSPENT' })
      .sort({ _id: -1 })
      .limit(1)
      .next();
    assert.equal(lot!.quantityUnits.toBigInt(), 1n);
    assert.deepEqual(await c.custody.verify(), { ok: true, issues: [] });
  },
);
After(async function (this: CustodyWorld) {
  await this.custodyHarness?.h.close();
});
