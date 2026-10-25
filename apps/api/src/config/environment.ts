import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { z } from 'zod';

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    WEB_ORIGIN: z.url(),
    MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
    MONGODB_DB: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9_-]+$/),
    MONGODB_REPLICA_SET: z.string().min(1),
    SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(2592000).default(604800),
    GOOGLE_CLIENT_ID: z.string().default(''),
    GOOGLE_CLIENT_SECRET: z.string().default(''),
    GOOGLE_REDIRECT_URI: z.string().default(''),
    ADMIN_SETUP_TOKEN: z.string().default(''),
    EVM_RPC_ALLOWED_HOSTS: z
      .string()
      .default('ethereum-sepolia-rpc.publicnode.com,sepolia.drpc.org'),
  })
  .superRefine((value, context) => {
    const origin = URL.canParse(value.WEB_ORIGIN) ? new URL(value.WEB_ORIGIN) : null;
    if (
      !origin ||
      origin.origin !== value.WEB_ORIGIN ||
      !['http:', 'https:'].includes(origin.protocol)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['WEB_ORIGIN'],
        message: 'Expected an HTTP origin without a path.',
      });
    }
    const google = [value.GOOGLE_CLIENT_ID, value.GOOGLE_CLIENT_SECRET, value.GOOGLE_REDIRECT_URI];
    if (google.some(Boolean) && !google.every(Boolean)) {
      context.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_ID'],
        message: 'Configure all Google settings or leave all empty.',
      });
    }
    if (value.GOOGLE_REDIRECT_URI) {
      const redirect = URL.canParse(value.GOOGLE_REDIRECT_URI)
        ? new URL(value.GOOGLE_REDIRECT_URI)
        : null;
      if (
        !redirect ||
        !['http:', 'https:'].includes(redirect.protocol) ||
        redirect.pathname !== '/api/auth/google/callback' ||
        redirect.search ||
        redirect.hash ||
        redirect.username ||
        redirect.password
      ) {
        context.addIssue({
          code: 'custom',
          path: ['GOOGLE_REDIRECT_URI'],
          message: 'Expected the Google callback URL.',
        });
      }
    }
    if (
      value.NODE_ENV === 'production' &&
      (origin?.protocol !== 'https:' ||
        (value.GOOGLE_REDIRECT_URI && !value.GOOGLE_REDIRECT_URI.startsWith('https://')))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['WEB_ORIGIN'],
        message: 'Production authentication requires HTTPS.',
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function loadEnvironment(): Environment {
  config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });
  const result = environmentSchema.safeParse(process.env);
  if (!result.success) {
    // Report field names only: connection strings may contain credentials.
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid environment configuration: ${fields.join(', ')}`);
  }
  return result.data;
}
