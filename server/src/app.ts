import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { compress } from 'hono/compress'
import { cors } from 'hono/cors'
import { etag } from 'hono/etag'
import { HTTPException } from 'hono/http-exception'
import { logger } from 'hono/logger'
import { prisma } from './db.js'
import { env } from './env.js'
import { auth } from './routes/auth.js'
import { content } from './routes/content.js'
import { dues } from './routes/dues.js'
import { equipment } from './routes/equipment.js'
import { eventManage } from './routes/eventManage.js'
import { files } from './routes/files.js'
import { forms } from './routes/forms.js'
import { me } from './routes/me.js'
import { officer } from './routes/officer.js'
import { print } from './routes/print.js'
import { projectManage } from './routes/projectManage.js'
import { signup } from './routes/signup.js'
import { stripeWebhook } from './routes/stripeWebhook.js'
import { tasks } from './routes/tasks.js'

export const app = new Hono()

if (env.NODE_ENV !== 'test') {
  app.use('*', logger())
}

app.use(
  '/api/*',
  cors({
    origin: env.allowedOrigins,
    // The session cookie will not cross an origin without this, and neither the
    // browser nor the server says so — `fetch` simply sends no cookie and every
    // authenticated request comes back 401. Safe here only because `origin` is
    // an explicit allow-list: `credentials` with a wildcard origin is the
    // combination browsers refuse outright.
    credentials: true,
    maxAge: 86_400,
  }),
)
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

/**
 * Registration order is the cache boundary, and it is load-bearing.
 *
 * Mounting a sub-app does not scope its middleware to it: `publicApi`'s
 * etag and cache-header middleware are registered at `/api/*` and run for
 * every request that reaches anything registered *after* them. A route
 * registered *before* them ends the chain first and they never run — which is
 * why `/api/health` above stays `no-store`.
 *
 * So everything that answers per-caller mounts here, before `publicApi`. A
 * cached "who am I" or "what do I owe" served to the next visitor would be
 * somebody else's membership — and with `s-maxage` in the header, a CDN would
 * happily do exactly that.
 */
app.route('/api', forms)
// Not cacheable and not GETs. An etag on "is this Discord handle free" would
// be actively wrong.
app.route('/api/signup', signup)
app.route('/api/auth', auth)
app.route('/api/dues', dues)
// The signed-in surfaces: the member's own view, project management, and the
// officer desk.
app.route('/api/me', me)
app.route('/api', projectManage)
app.route('/api', tasks)
app.route('/api/events', eventManage)
app.route('/api/officer', officer)
app.route('/api/print', print)
app.route('/api/equipment', equipment)
// Stored files set their own cache headers — immutable for images, no-store
// for members' print models.
app.route('/api/files', files)
// Stripe's own deliveries. Unauthenticated, verified by signature instead, and
// the body must reach the handler as the exact bytes Stripe signed — see
// `routes/stripeWebhook.ts`.
app.route('/api/stripe', stripeWebhook)

// Public club content, cacheable by anyone — the one part of the API that
// *wants* the shared-cache headers. Mounted last so its `/api/*` middleware
// wraps nothing but its own routes.
const publicApi = new Hono()
// etag runs inside compress, so the tag is computed over the uncompressed body
// and stays stable whether or not the client accepts gzip.
publicApi.use('*', etag())
publicApi.use('*', publicCache)
publicApi.route('/', content)

app.route('/api', publicApi)

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status)
  }

  // Never let a database error reach the client — it leaks schema details.
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})
