import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export const UINT256_MAX = (1n << 256n) - 1n;
const id = z.string().regex(/^[a-f0-9]{24}$/);
const integer = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .max(78);
const address = z
  .string()
  .regex(/^0x[0-9a-f]{40}$/)
  .refine((v) => v !== `0x${'0'.repeat(40)}`);
const base = {
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,15}$/),
  symbol: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,15}$/),
  displayName: z.string().trim().min(1).max(80),
};
export const assetDraftSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    ...base,
    kind: z.literal('DEMO_CRYPTO'),
    mode: z.literal('SIMULATED'),
    precision: z.number().int().min(0).max(8),
    capUnits: integer.refine((v) => BigInt(v) > 0n && BigInt(v) <= (1n << 63n) - 1n),
  }),
  z.strictObject({
    ...base,
    kind: z.literal('DECENTRALIZED_TOKEN'),
    mode: z.literal('EVM_ERC20'),
    precision: z.number().int().min(0).max(18),
    networkId: id,
    // Only canonical storage form is accepted here. Wallet/adapter boundaries must
    // validate mixed-case checksums before normalizing public address input.
    contractAddress: address,
  }),
]);
export const sendIntentSchema = z.strictObject({
  recipientResolutionId: id,
  senderWalletId: id,
  assetId: id,
  quantity: z
    .string()
    .max(100)
    .regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/),
});
export const recipientLookupSchema = z.strictObject({
  assetId: id,
  senderWalletId: id,
  lookup: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('HANDLE'),
      value: z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z][a-z0-9_]{2,23}$/),
    }),
    z.strictObject({ kind: z.literal('WALLET_ID'), value: id }),
    z.strictObject({ kind: z.literal('CHAIN_ADDRESS'), value: address }),
  ]),
});
export const policySchema = z.strictObject({
  reviewLifetimeSeconds: z.number().int().min(30).max(300),
  lookupPerMinute: z.number().int().min(1).max(1000),
  submitPerMinute: z.number().int().min(1).max(1000),
  readPerMinute: z.number().int().min(1).max(1000),
  maxInputLots: z.number().int().min(1).max(1000),
});
export const DEFAULT_WALLET_POLICY = Object.freeze({
  reviewLifetimeSeconds: 120,
  lookupPerMinute: 120,
  submitPerMinute: 60,
  readPerMinute: 240,
  maxInputLots: 100,
});
export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException('Invalid request fields.');
  return parsed.data;
}
export function parseChainQuantity(value: unknown, precision: number): bigint {
  if (
    !Number.isInteger(precision) ||
    precision < 0 ||
    precision > 18 ||
    typeof value !== 'string' ||
    value.length > 100 ||
    !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)
  )
    throw new BadRequestException('Invalid chain quantity.');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > precision) throw new BadRequestException('Excess precision.');
  const units = BigInt(whole! + fraction.padEnd(precision, '0'));
  if (units <= 0n || units > UINT256_MAX) throw new BadRequestException('Quantity out of range.');
  return units;
}
