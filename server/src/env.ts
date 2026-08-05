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

  // Postmark, for the contact form. Optional as a set: the site has to run
  // without a mail account, because `contact_messages` is the record and email
  // is only a notification on top of it. See the refine below — all three or
  // none.
  POSTMARK_TOKEN: z.string().min(1).optional(),
  /** Must be a verified sender signature on the Postmark account. */
  CONTACT_FROM_EMAIL: z.email().optional(),
  /** The inbox contact form messages are delivered to. */
  CONTACT_TO_EMAIL: z.email().optional(),
  /** Postmark stream. Transactional mail belongs on `outbound`. */
  POSTMARK_MESSAGE_STREAM: z.string().min(1).default('outbound'),
})
  .refine(
    (parsed) => {
      const parts = [
        parsed.POSTMARK_TOKEN,
        parsed.CONTACT_FROM_EMAIL,
        parsed.CONTACT_TO_EMAIL,
      ]
      return parts.every(Boolean) || !parts.some(Boolean)
    },
    {
      // Refusing to start is the point. Two of the three set is a server that
      // comes up, takes messages, tells everyone they were sent, and delivers
      // nothing — a failure you find out about from the person who never got a
      // reply, months later.
      message:
        'POSTMARK_TOKEN, CONTACT_FROM_EMAIL and CONTACT_TO_EMAIL must be set together, or left unset together',
    },
  )

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n')
  console.error(`Invalid environment:\n${details}`)
  process.exit(1)
}

export const env = parsed.data
