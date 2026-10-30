import { createHash } from 'node:crypto';
import { z } from 'zod';
export const conversationInput = z.strictObject({
  peerHandle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{2,23}$/),
});
export const messageInput = z.strictObject({
  clientMessageId: z.uuid(),
  text: z
    .string()
    .max(16000)
    .refine(
      (value) =>
        value.trim().length > 0 &&
        [...value].length <= 4000 &&
        Buffer.byteLength(value, 'utf8') <= 16384 &&
        !/[\uD800-\uDFFF]/u.test(value),
    ),
});
export const sequenceInput = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .refine((value) => /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= (1n << 63n) - 1n);
export const messageQuery = z
  .strictObject({ before: sequenceInput.optional(), after: sequenceInput.optional() })
  .refine((value) => !(value.before && value.after));
export const readInput = z.strictObject({ throughSequence: sequenceInput });
export const blockInput = z.strictObject({ blocked: z.boolean() });
export function pairKey(a: string, b: string) {
  return [a, b].sort().join(':');
}
export function messageDigest(text: string) {
  return createHash('sha256').update(text).digest('hex');
}
