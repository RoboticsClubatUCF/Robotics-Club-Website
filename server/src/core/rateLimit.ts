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
 * `X-Forwarded-For` is only honoured when TRUST_PROXY says a proxy actually sets it.
 * Trusting it unconditionally would make the limit trivial to bypass: the header is
 * client-supplied, so a script can put a fresh random value on every request and never
 * share a counter with itself.
 *
 * Exported because the middleware below isn't the only shape a budget comes in. A route
 * that spends one window from a POST and reads the same window from a GET — the contact
 * form does exactly that — has to build the identical key on both.
 */
export function clientAddress(c: Context): string {
  if (env.TRUST_PROXY) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    if (forwarded) return forwarded
  }

  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    // `getConnInfo` reaches for the Node socket behind the request and throws outright when
    // there isn't one — an in-process `app.request()`, or any adapter that isn't
    // @hono/node-server. Same situation as an address it can't read, so it lands in the same
    // place rather than turning every guarded write into a 500.
    return 'unknown'
  }
}

/**
 * Count one request against `key` and report whether it may proceed.
 *
 * The whole window lives in a single statement so two instances incrementing at once can't
 * lose an update: the row is locked by the upsert, and the reset decision is made from the
 * database clock rather than any one process's.
 */
export async function consume(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; retryAfter: number; remaining: number }> {
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
    // RETURNING on an upsert always yields a row; treat anything else as a bug rather than
    // silently letting the request through.
    throw new Error('rate limit upsert returned no row')
  }

  return {
    allowed: row.count <= limit,
    retryAfter: Math.max(
      1,
      Math.ceil((row.expires_at.getTime() - Date.now()) / 1000),
    ),
    // What's left after this request, so a caller that wants to tell somebody how many they
    // have doesn't have to know the limit twice. Floored at zero: the count keeps climbing
    // past the limit on every refused attempt, and "-14 messages left" isn't a thing to say.
    remaining: Math.max(0, limit - row.count),
  }
}

/**
 * Read a window without spending it.
 *
 * The counterpart to `consume`, for an endpoint that has to answer "could I?" before
 * anybody has done anything — the contact form asks this before it puts a box on the page.
 * Nothing is written, so hammering this costs one indexed read.
 *
 * An absent row and a closed one are the same answer, which is why the predicate is
 * `expires_at > now()` rather than the row existing: `sweep` only tidies.
 *
 * `count` here is what has already been spent, where `consume` compares the count including
 * the current request — hence `<` against the same limit that `consume` reads as `<=`.
 */
export async function peek(
  key: string,
  limit: number,
): Promise<{ allowed: boolean; used: number; retryAfter: number }> {
  const [row] = await prisma.$queryRaw<WindowRow[]>`
    SELECT count, expires_at FROM rate_limits
    WHERE key = ${key} AND expires_at > now()
  `

  if (!row) return { allowed: true, used: 0, retryAfter: 0 }

  return {
    allowed: row.count < limit,
    used: row.count,
    retryAfter: Math.max(
      1,
      Math.ceil((row.expires_at.getTime() - Date.now()) / 1000),
    ),
  }
}

/**
 * Middleware form. `scope` keeps unrelated endpoints from sharing a counter.
 *
 * `max` overrides `RATE_LIMIT_MAX` where the default is the wrong shape of limit. Five is
 * right for something that writes a row per call; it isn't right for a field that checks
 * itself as you correct a typo.
 *
 * `options.windowSeconds` overrides the window for a limit that isn't a rate at all — the
 * thirty-second floor between password reset emails is a ceiling on how often a thing may
 * happen to somebody else's inbox. Change the window and the scope together: a scope holds
 * one row per caller, so two windows under one name means one silently inherits the
 * other's `expires_at`.
 *
 * `options.message` replaces the sentence in the 429, because "try again later" is right
 * for a burst on a form and wrong where the caller is owed a number.
 *
 * If the database is unreachable this throws rather than failing open — the routes it
 * guards all write to that same database.
 */
export function rateLimit(
  scope: string,
  max?: number,
  options: { windowSeconds?: number; message?: string } = {},
): MiddlewareHandler {
  return async (c, next) => {
    const { allowed, retryAfter } = await consume(
      `${scope}:${clientAddress(c)}`,
      max ?? env.RATE_LIMIT_MAX,
      options.windowSeconds ?? env.RATE_LIMIT_WINDOW_SECONDS,
    )

    if (!allowed) {
      c.header('Retry-After', String(retryAfter))
      throw new HTTPException(429, {
        message: options.message ?? 'Too many submissions. Try again later.',
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
