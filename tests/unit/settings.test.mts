import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  policyDefinitions,
  productDefaults,
  settingsInput,
  settingsEtag,
} from '../../apps/api/src/modules/configuration/policy-registry.js';
import { PolicyReader } from '../../apps/api/src/modules/configuration/policy-reader.js';
import type { DatabaseService } from '../../apps/api/src/database/database.service.js';
import { toLong } from '../../apps/api/src/modules/accounts/quantity.js';

describe('Typed product configuration', () => {
  it('[happy/edge] accepts quoted settings ETags without losing an exact revision', () => {
    assert.equal(settingsEtag.parse('"0"'), '0');
    assert.equal(settingsEtag.parse('"999999999999999999"'), '999999999999999999');
  });
  it('[negative] rejects unquoted, wildcard, weak and malformed settings preconditions', () => {
    for (const value of ['0', '*', 'W/"1"', '"01"', '"-1"', '"1", "2"'])
      assert.equal(settingsEtag.safeParse(value).success, false);
  });
  it('[happy] preserves existing limits and reviews by default', () => {
    assert.deepEqual(productDefaults, {
      lookupPerMinute: 120,
      readsPerMinute: 240,
      admissionsPerMinute: 60,
      reviewSeconds: 120,
    });
    assert.deepEqual(
      settingsInput.parse({ scope: 'PRODUCT', values: productDefaults }).values,
      productDefaults,
    );
    assert.equal(policyDefinitions.PRODUCT.ownerRole, 'ASSET_ADMIN');
    assert.equal(policyDefinitions.SUPPORT.ownerRole, 'ACCESS_ADMIN');
  });
  it('[negative] rejects unsupported keys, unsafe help URLs and out-of-bound policies', () => {
    for (const values of [
      { ...productDefaults, reviewSeconds: 0 },
      { ...productDefaults, lookupPerMinute: 601 },
      { ...productDefaults, readsPerMinute: 1 },
      { ...productDefaults, admissionsPerMinute: 1.5 },
      { ...productDefaults, mainnet: true },
    ])
      assert.equal(settingsInput.safeParse({ scope: 'PRODUCT', values }).success, false);
    for (const helpUrl of [
      'javascript:alert(1)',
      'http://example.invalid',
      'https://user:secret@example.invalid',
    ])
      assert.equal(
        settingsInput.safeParse({
          scope: 'SUPPORT',
          values: { helpUrl, accessRequests: true, allocationRequests: true },
        }).success,
        false,
      );
  });
  it('[edge] reads a fresh authoritative revision instead of caching worker or API values', async () => {
    let row: { revision: ReturnType<typeof toLong>; values: typeof productDefaults } | null = null;
    const reader = new PolicyReader({
      db: { collection: () => ({ findOne: async () => row }) },
    } as unknown as DatabaseService);
    assert.equal((await reader.product()).revision, '0');
    row = { revision: toLong(1n), values: { ...productDefaults, reviewSeconds: 45 } };
    assert.equal((await reader.product()).values.reviewSeconds, 45);
    row = { revision: toLong(2n), values: { ...productDefaults, reviewSeconds: 90 } };
    assert.equal((await reader.product()).revision, '2');
    assert.equal((await reader.product()).values.reviewSeconds, 90);
  });
});
