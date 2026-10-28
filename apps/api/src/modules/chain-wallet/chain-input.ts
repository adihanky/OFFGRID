import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { getAddress, Interface, parseUnits } from 'ethers';
import { z } from 'zod';
export const erc20 = new Interface([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
]);
export const hashSchema = z.string().regex(/^0x[0-9a-f]{64}$/i);
export const addressSchema = z.string().regex(/^0x[0-9a-f]{40}$/i);
export const quantitySchema = z
  .string()
  .regex(/^0x(?:0|[1-9a-f][0-9a-f]*)$/i)
  .max(66);
export function address(value: string) {
  try {
    const result = getAddress(value);
    if (/^0x0{40}$/i.test(result)) throw new Error();
    return result.toLowerCase();
  } catch {
    throw new BadRequestException('Enter a valid nonzero checksummed EVM address.');
  }
}
export function blockNumber(value: unknown) {
  const parsed = quantitySchema.safeParse(value);
  if (!parsed.success || BigInt(parsed.data) > BigInt(Number.MAX_SAFE_INTEGER))
    throw new ServiceUnavailableException('Invalid RPC block number.');
  return Number(BigInt(parsed.data));
}
export function tokenAmount(value: string, decimals: number) {
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 36 ||
    !/^(0|[1-9][0-9]{0,77})(\.[0-9]{1,36})?$/.test(value)
  )
    throw new BadRequestException('Invalid token quantity.');
  try {
    const units = parseUnits(value, decimals);
    if (units <= 0n || units >= 2n ** 256n) throw new Error();
    return units;
  } catch {
    throw new BadRequestException('Amount must be positive and fit the token precision.');
  }
}
export const transactionSchema = z.object({
  hash: hashSchema,
  from: addressSchema,
  to: addressSchema.nullable(),
  value: quantitySchema,
  input: z.string().regex(/^0x[0-9a-f]*$/i),
  blockNumber: quantitySchema.nullable(),
  blockHash: hashSchema.nullable(),
});
export const logSchema = z.object({
  address: addressSchema,
  topics: z.array(hashSchema),
  data: z.string().regex(/^0x[0-9a-f]*$/i),
  transactionHash: hashSchema,
  logIndex: quantitySchema,
  blockNumber: quantitySchema,
  blockHash: hashSchema,
  removed: z.boolean().optional(),
});
export const receiptSchema = z.object({
  transactionHash: hashSchema,
  blockNumber: quantitySchema,
  blockHash: hashSchema,
  status: z.enum(['0x0', '0x1']),
  contractAddress: addressSchema.nullable(),
  logs: z.array(logSchema),
});
export const blockSchema = z.object({
  number: quantitySchema,
  hash: hashSchema,
  parentHash: hashSchema,
  transactions: z.array(transactionSchema),
});
export const hexBlock = (value: number) => `0x${value.toString(16)}`;
export function confirmedStatus(success: boolean, confirmations: number) {
  return !success ? 'REVERTED' : confirmations >= 12 ? 'CONFIRMED' : 'MINED';
}
