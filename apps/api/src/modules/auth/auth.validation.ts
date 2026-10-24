import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const signInSchema = z.object({ email, password: z.string().min(1).max(128) }).strict();
export const signUpSchema = z
  .object({
    email,
    password: z.string().min(12).max(128),
    publicHandle: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9_]{2,23}$/),
  })
  .strict();
export const googleCallbackSchema = z
  .object({
    state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    code: z.string().min(1).max(2048).optional(),
    error: z.string().min(1).max(100).optional(),
    scope: z.string().max(2000).optional(),
    authuser: z.string().max(20).optional(),
    prompt: z.string().max(50).optional(),
  })
  .refine((value) => Boolean(value.code) !== Boolean(value.error));

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new BadRequestException('Invalid authentication input. Check the field requirements.');
  return result.data;
}
