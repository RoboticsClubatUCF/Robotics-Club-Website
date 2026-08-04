import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { compress } from 'hono/compress'
import { cors } from 'hono/cors'
import { etag } from 'hono/etag'
import { HTTPException } from 'hono/http-exception'
import { logger } from 'hono/logger'
import { prisma } from './db.js'
import { env } from './env.js'
import { content } from './routes/content.js'
import { forms } from './routes/forms.js'

export const app = new Hono()

if (env.NODE_ENV !== 'test') {
  app.use('*', logger())
}

app.use('/api/*', cors({ origin: env.CORS_ORIGINS, maxAge: 86_400 }))
app.use('/api/*', compress())

/**
 * Health is deliberately uncached and cheap. Load balancers poll it constantly,
 * so it does one trivial query to prove the pool can still hand out a
 * connection — not a real workload.
 */
app.get('/api/health', async (c) => {
  c.header('Cache-Control', 'no-store')

  try {
    await prisma.$queryRaw`SELECT 1`
    return c.json({ status: 'ok', database: 'up' })
  } catch {
    return c.json({ status: 'degraded', database: 'down' }, 503)
  }
})

/**
 * Club content changes a few times a week and is identical for every visitor,
 * so it is the cheapest thing to serve from a cache. `s-maxage` is what a CDN
 * or reverse proxy obeys — with it in front, traffic spikes (a competition, a
 * recruiting push) mostly never reach Node at all. `stale-while-revalidate`
 * keeps the page up even if this service is briefly down.
 */
const publicCache: MiddlewareHandler = async (c, next) => {
  await next()

  if (c.req.method === 'GET' && c.res.status === 200) {
    c.res.headers.set(
      'Cache-Control',
      `public, max-age=${env.CACHE_MAX_AGE}, s-maxage=${env.CACHE_S_MAXAGE}, stale-while-revalidate=600`,
    )
  }
}

const publicApi = new Hono()
// etag runs inside compress, so the tag is computed over the uncompressed body
// and stays stable whether or not the client accepts gzip.
publicApi.use('*', etag())
publicApi.use('*', publicCache)
publicApi.route('/', content)

app.route('/api', publicApi)
app.route('/api', forms)

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status)
  }

  // Never let a database error reach the client — it leaks schema details.
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})
