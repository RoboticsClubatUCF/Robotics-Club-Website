import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context, MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { prisma } from './db.js'
import { env } from './env.js'

interface WindowRow {
  count: number
  expires_at: Date
}

/**
 * Identify the caller.
 *
 * `X-Forwarded-For` is only honoured when TRUST_PROXY says a proxy actually
 * sets it. Trusting it unconditionally would make the limit trivial to bypass:
 * the header is client-supplied, so a script can put a fresh random value on
 * every request and never share a counter with itself.
 */
function clientAddress(c: Context): string {
  if (env.TRUST_PROXY) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    if (forwarded) return forwarded
  }

  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    // `getConnInfo` reaches for the Node socket behind the request and throws
    // outright when there isn't one — an in-process `app.request()`, or any
    // adapter that isn't @hono/node-server. That is the same situation as an
    // address it cannot read, so it lands in the same place rather than
    // turning every guarded write into a 500. Callers that can't be told apart
    // share one bucket, which errs toward limiting too much, not too little.
    return 'unknown'
  }
}

/**
 * Count one request against `key` and report whether it may proceed.
 *
 * The whole window lives in a single statement so two instances incrementing
 * at once can't lose an update: the row is locked by the upsert, and the reset
 * decision is made from the database clock rather than any one process's.
 */
export async function consume(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const [row] = await prisma.$queryRaw<WindowRow[]>`
    INSERT INTO rate_limits (key, count, expires_at)
    VALUES (${key}, 1, now() + make_interval(secs => ${windowSeconds}))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE
        WHEN rate_limits.expires_at <= now() THEN 1
        ELSE rate_limits.count + 1
      END,
      expires_at = CASE
        WHEN rate_limits.expires_at <= now()
        THEN now() + make_interval(secs => ${windowSeconds})
        ELSE rate_limits.expires_at
      END
    RETURNING count, expires_at
  `

  if (!row) {
    // RETURNING on an upsert always yields a row; treat anything else as a bug
    // rather than silently letting the request through.
    throw new Error('rate limit upsert returned no row')
  }

  return {
    allowed: row.count <= limit,
    retryAfter: Math.max(
      1,
      Math.ceil((row.expires_at.getTime() - Date.now()) / 1000),
    ),
  }
}

/**
 * Middleware form. `scope` keeps unrelated endpoints from sharing a counter.
 *
 * If the database is unreachable this throws rather than failing open — the
 * routes it guards all write to that same database, so they could not have
 * succeeded anyway.
 */
export function rateLimit(scope: string): MiddlewareHandler {
  return async (c, next) => {
    const { allowed, retryAfter } = await consume(
      `${scope}:${clientAddress(c)}`,
      env.RATE_LIMIT_MAX,
      env.RATE_LIMIT_WINDOW_SECONDS,
    )

    if (!allowed) {
      c.header('Retry-After', String(retryAfter))
      throw new HTTPException(429, {
        message: 'Too many submissions. Try again later.',
      })
    }

    await next()
  }
}

/** Drop windows that have already closed. Safe to run from every instance. */
export async function sweepRateLimits(): Promise<number> {
  const { count } = await prisma.rateLimit.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })

  return count
}
