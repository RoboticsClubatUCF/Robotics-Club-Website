import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { compress } from 'hono/compress'
import { cors } from 'hono/cors'
import { etag } from 'hono/etag'
import { HTTPException } from 'hono/http-exception'
import { logger } from 'hono/logger'
import { prisma } from './core/db.js'
import { env } from './core/env.js'
import { aboutPage } from './routes/officer/aboutPage.js'
import { account } from './routes/account/account.js'
import { auth } from './routes/account/auth.js'
import { content } from './routes/public/content.js'
import { discordInteractions } from './routes/webhooks/discordInteractions.js'
import { dues } from './routes/member/dues.js'
import { equipment } from './routes/member/equipment.js'
import { eventManage } from './routes/projects/eventManage.js'
import { files } from './routes/public/files.js'
import { forms } from './routes/public/forms.js'
import { frontPage } from './routes/officer/frontPage.js'
import { heroSlides } from './routes/officer/heroSlides.js'
import { lab } from './routes/public/lab.js'
import { me } from './routes/member/me.js'
import { officer } from './routes/officer/officer.js'
import { officerArchive } from './routes/officer/officerArchive.js'
import { print } from './routes/member/print.js'
import { projectManage } from './routes/projects/projectManage.js'
import { signup } from './routes/account/signup.js'
import { sponsorsAdmin } from './routes/officer/sponsorsAdmin.js'
import { stripeWebhook } from './routes/webhooks/stripeWebhook.js'
import { survey } from './routes/member/survey.js'
import { surveyAdmin } from './routes/officer/surveyAdmin.js'
import { tasks } from './routes/projects/tasks.js'

export const app = new Hono()

if (env.NODE_ENV !== 'test') {
  app.use('*', logger())
}

app.use(
  '/api/*',
  cors({
    origin: env.allowedOrigins,
    // The session cookie won't cross an origin without this, and neither the browser nor
    // the server says so — `fetch` simply sends no cookie and every authenticated
    // request comes back 401. Safe here only because `origin` is an explicit allow-list:
    // `credentials` with a wildcard origin is the combination browsers refuse outright.
    credentials: true,
    maxAge: 86_400,
  }),
)
app.use('/api/*', compress())

/**
 * Nothing under `/api` is cacheable unless it says so itself.
 *
 * Registration order already decides which responses get the shared-cache header, but
 * until this existed the other half of that decision was silence: `/api/auth/me`,
 * `/api/dues/status` and every officer desk answered 200 with no `Cache-Control` at
 * all. Silence is not "do not cache" — a shared cache may store a 200 with no directive
 * and guess its own freshness, and with a CDN in front one member's session or dues
 * standing can be handed to the next visitor. The symptom is somebody else's name in
 * the corner of the page.
 *
 * `private, no-store` rather than a shorter TTL, because there's no length of time for
 * which one person's membership is the right answer for another.
 *
 * Only when nothing has been set. Registered outside everything, so its post-`next`
 * half runs last — after `publicCache` has stamped the club content and `files.ts` has
 * chosen per kind. Reading the header rather than overwriting it keeps this a floor.
 */
app.use('/api/*', async (c, next) => {
  await next()

  if (!c.res.headers.has('Cache-Control')) {
    c.res.headers.set('Cache-Control', 'private, no-store')
  }
})

/**
 * Health is deliberately uncached and cheap. Load balancers poll it constantly, so it
 * does one trivial query to prove the pool can still hand out a connection.
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
 * Club content changes a few times a week and is identical for every visitor, so it's
 * the cheapest thing to serve from a cache. `s-maxage` is what a CDN obeys — with one in
 * front, traffic spikes mostly never reach Node. `stale-while-revalidate` keeps the page
 * up even if this service is briefly down.
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
 * Registration order is the cache boundary, and it's load-bearing.
 *
 * Mounting a sub-app doesn't scope its middleware to it: `publicApi`'s etag and
 * cache-header middleware are registered at `/api/*` and run for every request that
 * reaches anything registered after them. A route registered before them ends the chain
 * first and they never run — which is why `/api/health` stays `no-store`.
 *
 * So everything that answers per-caller mounts here, before `publicApi`. A cached "who
 * am I" served to the next visitor would be somebody else's membership.
 */
app.route('/api', forms)
// Not cacheable and not GETs. An etag on "is this Discord handle free" would
// be actively wrong.
app.route('/api/signup', signup)
app.route('/api/auth', auth)
// Somebody managing their own row. Per-caller and full of credentials, so it
// belongs firmly on this side of the cache boundary.
app.route('/api/account', account)
// The gate ahead of dues, and mounted beside it for that reason. Per-caller like
// everything else in this block: a cached answer would hand one member's allergies to
// the next visitor.
app.route('/api/survey', survey)
app.route('/api/dues', dues)
// The signed-in surfaces: the member's own view, project management, and the
// officer desk.
app.route('/api/me', me)
app.route('/api', projectManage)
app.route('/api', tasks)
app.route('/api/events', eventManage)
// Before `/api/officer`, because it owns a path underneath it and Hono answers with the
// first route that matches. The survey desk moved out of `officer.ts` when half of it
// became the editor for the member form.
app.route('/api/officer/survey', surveyAdmin)
// And the same, for the same reason. The front page's slideshow is written from here and
// read from `content.ts` on the cached side below.
app.route('/api/officer/hero-slides', heroSlides)
// The other half of that desk, and the same rule again. `heroSlides` owns the
// photographs beside the headline; this owns the headline, the FAQ and the partner
// programs — the landing page's words rather than its pictures.
app.route('/api/officer/front-page', frontPage)
// And `/about`, which is written from the page itself rather than from a desk. Mounted
// here with the desks all the same: where a form is drawn has never been what decides
// who may post to it.
app.route('/api/officer/about', aboutPage)
// And again. This one owns three tables — the sponsors, what a tier costs and the ways
// to help that aren't money — because they're one page and officers write them as one.
app.route('/api/officer/sponsors', sponsorsAdmin)
// And once more. The officers desk owns `officer_terms` outright, which is the half of
// `/officers` no route could write before it.
app.route('/api/officer/archive', officerArchive)
app.route('/api/officer', officer)
app.route('/api/print', print)
app.route('/api/equipment', equipment)
// Public to read and officer-only to write, and mounted here rather than with the club
// content for the read's sake: `publicApi` would stamp it `s-maxage=300`, and a
// five-minute-old answer to "is the lab open right now" is the one answer this must
// never give. It sets its own, much shorter header.
app.route('/api/lab', lab)
// Stored files set their own cache headers — immutable for images, no-store
// for members' print models.
app.route('/api/files', files)
// Stripe's own deliveries. Unauthenticated, verified by signature instead, and the body
// must reach the handler as the exact bytes Stripe signed.
app.route('/api/stripe', stripeWebhook)
// Somebody pressing the button on the lab sign. Unauthenticated and signature-verified
// for the same reasons as the webhook above, and the raw body matters here too —
// Discord signs the exact bytes.
app.route('/api/discord', discordInteractions)

// Public club content, cacheable by anyone — the one part of the API that wants the
// shared-cache headers. Mounted last so its `/api/*` middleware wraps nothing but its
// own routes.
const publicApi = new Hono()
// etag runs inside compress, so the tag is computed over the uncompressed body and stays
// stable whether or not the client accepts gzip.
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
