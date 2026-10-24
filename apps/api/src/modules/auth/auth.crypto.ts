import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Algorithm, hash, verify } from '@node-rs/argon2';

export const newToken = () => randomBytes(32).toString('base64url');
export const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
export const csrfForSession = (token: string) =>
  createHmac('sha256', token).update('p2p:csrf').digest('base64url');
export const isToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export function secureEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class PasswordService {
  private dummy?: Promise<string>;
  hash(password: string) {
    return hash(password, {
      algorithm: Algorithm.Argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }
  async verify(password: string, encoded?: string) {
    this.dummy ??= this.hash(newToken());
    const valid = await verify(encoded ?? (await this.dummy), password);
    return Boolean(encoded) && valid;
  }
}
