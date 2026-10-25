import { BadRequestException } from '@nestjs/common';
import { Long } from 'mongodb';

export const MAX_UNITS = 9223372036854775807n;
export const MIN_UNITS = -9223372036854775808n;
export const toLong = (value: bigint) => {
  if (value < MIN_UNITS || value > MAX_UNITS)
    throw new RangeError('Quantity exceeds signed 64-bit range.');
  return Long.fromString(value.toString());
};
export const units = (value: Long) => BigInt(value.toString());
export function parseQuantity(value: unknown, precision: number): bigint {
  if (!Number.isInteger(precision) || precision < 0 || precision > 8)
    throw new RangeError('Invalid precision.');
  if (typeof value !== 'string' || value.length > 30 || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value))
    throw new BadRequestException('Quantity must be a positive decimal string.');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > precision)
    throw new BadRequestException('Quantity exceeds asset precision.');
  const result =
    BigInt(whole!) * 10n ** BigInt(precision) + BigInt(fraction.padEnd(precision, '0') || '0');
  if (result <= 0n || result > MAX_UNITS)
    throw new BadRequestException('Quantity is outside supported bounds.');
  return result;
}
export function formatQuantity(value: bigint, precision: number): string {
  if (!Number.isInteger(precision) || precision < 0 || precision > 8)
    throw new RangeError('Invalid precision.');
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(precision);
  return `${negative ? '-' : ''}${absolute / scale}${precision ? `.${(absolute % scale).toString().padStart(precision, '0')}` : ''}`;
}
