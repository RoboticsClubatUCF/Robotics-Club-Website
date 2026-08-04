import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  /** Comma-separated. Browsers may only call the API from these origins. */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  // Connection pool. Every instance opens up to DATABASE_POOL_MAX connections,
  // so instances × max must stay under the server's max_connections (100 by
  // default). Put PgBouncer in front before that stops being true.
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).default(5_000),

  /** Only enable behind a proxy that overwrites X-Forwarded-For. */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(5),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(600),

  /** Browser cache seconds for public GETs. */
  CACHE_MAX_AGE: z.coerce.number().int().min(0).default(60),
  /** Shared/CDN cache seconds — the number that actually sheds load. */
  CACHE_S_MAXAGE: z.coerce.number().int().min(0).default(300),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n')
  console.error(`Invalid environment:\n${details}`)
  process.exit(1)
}

export const env = parsed.data
