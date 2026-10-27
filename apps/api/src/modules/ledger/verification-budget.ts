interface VerificationCursor<T> {
  toArray(): Promise<T[]>;
  limit(count: number): VerificationCursor<T>;
}
export async function verificationRows<T>(
  cursor: VerificationCursor<T>,
  maximum?: number,
): Promise<T[]> {
  if (maximum === undefined) return cursor.toArray();
  if (!Number.isSafeInteger(maximum) || maximum < 1)
    throw new Error('Invalid verification record budget.');
  const rows = await cursor.limit(maximum + 1).toArray();
  if (rows.length > maximum)
    throw new Error('Verification record budget exceeded inside the snapshot.');
  return rows;
}
