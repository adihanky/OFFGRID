import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { Filter } from 'mongodb';
import { z } from 'zod';
import { objectId } from '../accounts/accounts.service.js';
import { parseInput } from '../assets/asset-input.js';
import type { TransferRecord } from './transfers.models.js';

const id = z.string().regex(/^[a-f0-9]{24}$/);
const instant = z.iso.datetime({ offset: true });
const schema = z.strictObject({
  direction: z.enum(['ALL', 'SENT', 'RECEIVED']).default('ALL'),
  status: z.enum(['PENDING', 'COMMITTED', 'REJECTED']).optional(),
  assetId: id.optional(),
  peerHandle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{2,23}$/)
    .optional(),
  from: instant.optional(),
  to: instant.optional(),
  limit: z
    .string()
    .regex(/^[1-9][0-9]{0,2}$/)
    .transform(Number)
    .pipe(z.number().max(100))
    .default(20),
  cursor: z
    .string()
    .min(1)
    .max(1024)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});
const cursorSchema = z.tuple([z.literal(1), z.string().regex(/^[a-f0-9]{64}$/), instant, id]);

export function historyQuery(caller: string, value: unknown) {
  const query = parseInput(schema, value);
  const callerId = objectId(caller);
  if (Boolean(query.from) !== Boolean(query.to))
    throw new BadRequestException('Supply both from and to timestamps.');
  if (query.from && query.to) {
    const range = Date.parse(query.to) - Date.parse(query.from);
    if (range < 0 || range > 366 * 86400000)
      throw new BadRequestException('Date range must be ordered and at most 366 days.');
  }
  const { cursor, ...filters } = query;
  const digest = createHash('sha256')
    .update(JSON.stringify([caller, filters]))
    .digest('hex');
  const visibility: Filter<TransferRecord>[] = [];
  if (query.direction !== 'RECEIVED')
    visibility.push({
      senderId: callerId,
      ...(query.peerHandle ? { 'recipient.publicHandle': query.peerHandle } : {}),
    });
  if (query.direction !== 'SENT')
    visibility.push({
      recipientId: callerId,
      status: 'COMMITTED',
      ...(query.peerHandle ? { 'sender.publicHandle': query.peerHandle } : {}),
    });
  const clauses: Filter<TransferRecord>[] = [{ $or: visibility }];
  if (query.status) clauses.push({ status: query.status });
  if (query.assetId) clauses.push({ assetId: objectId(query.assetId) });
  if (query.from && query.to)
    clauses.push({ createdAt: { $gte: new Date(query.from), $lte: new Date(query.to) } });
  if (cursor) {
    try {
      const parsed = cursorSchema.parse(
        JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
      );
      if (parsed[1] !== digest) throw new Error();
      const at = new Date(parsed[2]);
      clauses.push({
        $or: [{ createdAt: { $lt: at } }, { createdAt: at, _id: { $lt: objectId(parsed[3]) } }],
      });
    } catch {
      throw new BadRequestException('Invalid history cursor or changed filters. Refresh Activity.');
    }
  }
  return { filter: { $and: clauses } satisfies Filter<TransferRecord>, limit: query.limit, digest };
}

export function historyCursor(digest: string, record: Pick<TransferRecord, '_id' | 'createdAt'>) {
  return Buffer.from(
    JSON.stringify([1, digest, record.createdAt.toISOString(), record._id.toHexString()]),
  ).toString('base64url');
}
