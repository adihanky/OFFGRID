import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canonicalChain,
  chainHash,
  GENESIS_HASH,
} from '../../apps/api/src/modules/chain/chain.service.js';
const value = {
  sequence: 1n,
  transferId: '000000000000000000000001',
  senderAccountId: '000000000000000000000002',
  recipientAccountId: '000000000000000000000003',
  assetId: '000000000000000000000004',
  quantityUnits: 325n,
  committedAt: new Date('2026-10-24T00:00:00.000Z'),
  previousHash: GENESIS_HASH,
};
describe('Canonical chain W10', () => {
  it('[happy] has fixed canonical bytes', () => {
    assert.equal(
      canonicalChain(value),
      '[1,"1","000000000000000000000001","000000000000000000000002","000000000000000000000003","000000000000000000000004","325","2026-10-24T00:00:00.000Z","0000000000000000000000000000000000000000000000000000000000000000"]',
    );
    assert.equal(
      chainHash('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
  it('[negative] content or predecessor tampering changes hash', () => {
    const original = chainHash(canonicalChain(value));
    assert.notEqual(chainHash(canonicalChain({ ...value, quantityUnits: 326n })), original);
    assert.notEqual(
      chainHash(canonicalChain({ ...value, previousHash: '1'.repeat(64) })),
      original,
    );
  });
  it('[edge] sequences and quantities above Number safe range preserve bytes', () => {
    assert.ok(
      canonicalChain({
        ...value,
        sequence: 9007199254740993n,
        quantityUnits: 9223372036854775807n,
      }).includes('"9007199254740993"'),
    );
    assert.ok(
      canonicalChain({ ...value, quantityUnits: 9223372036854775807n }).includes(
        '"9223372036854775807"',
      ),
    );
  });
});
