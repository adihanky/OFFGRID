import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WEB_ORIGIN: z.url(),
  MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
  MONGODB_DB: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/),
  MONGODB_REPLICA_SET: z.string().min(1),
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
