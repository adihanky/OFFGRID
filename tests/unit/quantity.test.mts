import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatQuantity,
  MAX_UNITS,
  MIN_UNITS,
  parseQuantity,
  toLong,
  units,
} from '../../apps/api/src/modules/accounts/quantity.js';
describe('Exact quantities W05/W06', () => {
  for (const [input, precision, expected] of [
    ['1', 0, 1n],
    ['1.00', 2, 100n],
    ['0.01', 2, 1n],
    ['0.00000001', 8, 1n],
    ['9007199254740993', 0, 9007199254740993n],
    ['92233720368547758.07', 2, MAX_UNITS],
  ] as const)
    it(`[happy/edge] ${input} precision ${precision}`, () => {
      assert.equal(parseQuantity(input, precision), expected);
      assert.equal(parseQuantity(formatQuantity(expected, precision), precision), expected);
      assert.equal(units(toLong(expected)), expected);
    });
  for (const input of [
    '0',
    '-1',
    '1e2',
    ' 1',
    '1 ',
    '01',
    '1.001',
    '1.',
    '+1',
    1,
    {},
    '9'.repeat(31),
    '92233720368547758.08',
  ])
    it(`[negative] refuses ${JSON.stringify(input)}`, () =>
      assert.throws(() => parseQuantity(input, 2)));
  it('[edge] equivalent strings share units and fixed display', () => {
    assert.equal(parseQuantity('1', 2), parseQuantity('1.00', 2));
    assert.equal(formatQuantity(0n, 8), '0.00000000');
    assert.equal(formatQuantity(-101n, 2), '-1.01');
    assert.equal(units(toLong(MIN_UNITS)), MIN_UNITS);
  });
  it('[negative] signed conversion and precision refuse overflow', () => {
    assert.throws(() => toLong(MAX_UNITS + 1n));
    assert.throws(() => toLong(MIN_UNITS - 1n));
    assert.throws(() => parseQuantity('1', 9));
    assert.throws(() => parseQuantity('1.0', 0));
    assert.throws(() => formatQuantity(1n, -1));
  });
});
