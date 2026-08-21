import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),

  /**
   * Where the website lives — the *one* place its address is configured.
   *
   * Two things need it and used to be set separately, which meant moving the
   * site to a real domain took two edits and forgetting the second one sent
   * every verification email to a link on localhost. The CORS allow-list and
   * the signup link are both derived from this now; see `allowedOrigins` and
   * `signupVerifyUrl` below.
   */
  SITE_URL: z
    .url()
    .default('http://localhost:5173')
    // A trailing slash here becomes `//join` in the emailed link, which some
    // hosts serve and others 404.
    .transform((value) => value.replace(/\/+$/, '')),

  /**
   * *Extra* origins allowed to call the API, comma-separated, on top of
   * `SITE_URL` — a preview deploy, or `:4173` for `vite preview`. Leave it
   * unset and the site's own origin is the only one allowed.
   */
  CORS_ORIGINS: z
    .string()
    .default('')
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

  /** How long a verification link stays good. Long enough to survive a lecture,
      short enough that a forwarded email goes stale. */
  SIGNUP_TOKEN_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(120),

  // Discord. Optional as a set, like Postmark above: the club has to be able to
  // run the site before someone with server permissions has made a bot. With
  // these unset the handle is stored as typed and nothing confirms it — the API
  // says so at startup, because an unconfirmed handle looks exactly like a
  // confirmed one in the database.
  //
  /** A *bot* token. Not the application's client secret, and not a user token. */
  DISCORD_BOT_TOKEN: z.string().min(1).optional(),
  /** The club server's id — a snowflake, so digits only. */
  DISCORD_GUILD_ID: z
    .string()
    .regex(/^\d{17,20}$/, 'must be a Discord snowflake (17-20 digits)')
    .optional(),
  /**
   * The Discord role that *is* the officer board.
   *
   * Set it and the club appoints officers in Discord: whoever carries this role
   * is an `OFFICER` on the site, and whoever loses it stops being one. Leave it
   * unset and officers are set by hand in Prisma Studio, exactly as they were
   * before this existed.
   *
   * **Unset is the safety valve, and it is the default for a reason.** The
   * first sweep after this is set will stand down every sitting officer who is
   * in the guild without the role — so the order is: match the Discord role to
   * the board you actually want, *then* set this, then read the first sweep's
   * log. There is no way for the code to tell a board that has not been given
   * the role yet from a board that has been dissolved.
   */
  DISCORD_OFFICER_ROLE_ID: z
    .string()
    .regex(/^\d{17,20}$/, 'must be a Discord snowflake (17-20 digits)')
    .optional(),

  /**
   * The three roles that follow the *site* — the opposite direction from the
   * officer role above, and the distinction is the whole design.
   *
   * Discord appoints the board and the site reads it. The site decides these
   * three and pushes them: whoever has a dues date still running carries
   * `DISCORD_MEMBER_ROLE_ID`, whoever leads a project carries
   * `DISCORD_PROJECT_LEAD_ROLE_ID`, whoever leads a team carries
   * `DISCORD_TEAM_LEAD_ROLE_ID`. See `src/discordRoles.ts`.
   *
   * **Each is independently optional, and unset means never touched.** There
   * is no mode in which an unconfigured role is read or written, which is what
   * lets the club switch one on at a time and is the safety valve the officer
   * role has for the same reason.
   */
  DISCORD_MEMBER_ROLE_ID: z
    .string()
    .regex(/^\d{17,20}$/, 'must be a Discord snowflake (17-20 digits)')
    .optional(),
  DISCORD_PROJECT_LEAD_ROLE_ID: z
    .string()
    .regex(/^\d{17,20}$/, 'must be a Discord snowflake (17-20 digits)')
    .optional(),
  DISCORD_TEAM_LEAD_ROLE_ID: z
    .string()
    .regex(/^\d{17,20}$/, 'must be a Discord snowflake (17-20 digits)')
    .optional(),

  /**
   * Work out every role change and write none of them, naming each in the log.
   *
   * Worth having because this is the one sweep whose mistakes land on other
   * people's Discord accounts rather than in a table somebody can correct. A
   * club switching the sync on reads one sweep's output first, checks the
   * removals are the ones it meant, and only then lets it write.
   */
  DISCORD_ROLE_SYNC_DRY_RUN: z.stringbool().default(false),

  // ------------------------------------------------------------- sessions

  /**
   * How long a session survives without being used. An *idle* timeout, not a
   * hard one — every authenticated request rolls it forward — so somebody who
   * turns up to build nights is never signed out mid-term, and a browser left
   * on a lab machine still goes stale on schedule.
   */
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  SESSION_COOKIE_NAME: z.string().min(1).default('rccf_session'),

  /**
   * `SameSite` for the session cookie, and the one setting that decides whether
   * signing in works at all once this is deployed.
   *
   * `lax` is right whenever the site and the API share a registrable domain —
   * `localhost:5173` and `localhost:4000` do, and so would `rccf.org` and
   * `api.rccf.org`. Ports and subdomains are not what "same site" means.
   *
   * `none` is for the case where they genuinely differ (a site on one domain
   * calling an API on another), and it is not free: browsers refuse a
   * `SameSite=None` cookie that is not also `Secure`, so it requires https, and
   * it re-opens the cross-site request forgery that `lax` closes by itself.
   * `originGuard` in `src/routes/auth.ts` is what covers that, and it is why
   * this is a supported option rather than a footgun.
   */
  SESSION_COOKIE_SAMESITE: z.enum(['lax', 'none']).default('lax'),

  /**
   * Set only to share one session across subdomains, e.g. `.rccf.org`. Left
   * unset the cookie is host-only, which is the tighter of the two.
   */
  SESSION_COOKIE_DOMAIN: z.string().min(1).optional(),

  // ----------------------------------------------------------------- dues

  /**
   * Dues, in cents, because that is the unit Stripe charges in and converting
   * at the boundary is where rounding bugs live. Read from configuration rather
   * than written into the code so a treasurer changing the price is one line in
   * `.env` — and served to the browser from `GET /api/dues/status`, so the page
   * can never print a number the server would not charge.
   */
  DUES_SEMESTER_CENTS: z.coerce.number().int().min(50).default(2_500),
  DUES_YEAR_CENTS: z.coerce.number().int().min(50).default(5_000),

  /**
   * How long the free trial runs from the first day of classes. Everyone gets
   * it, every fall and spring; summer has no trial because summer is free
   * outright.
   */
  TRIAL_DAYS: z.coerce.number().int().min(0).max(60).default(14),

  /**
   * How long after a trial ends the sweep will still send the "your trial is
   * over" message.
   *
   * This exists for the day the feature is deployed. Without a floor, the first
   * sweep after a mid-semester release looks back at a trial that ended in
   * August and messages every member who never paid — one hundred people
   * getting a DM about a deadline six weeks past. Anyone missed by a window
   * this wide was not going to be told anything useful anyway.
   */
  TRIAL_NOTICE_GRACE_DAYS: z.coerce.number().int().min(1).max(30).default(3),

  /**
   * How long before a loan falls due the bot says something, in hours.
   *
   * A day and a half rather than a day, and the odd-looking number is the
   * point. A due date is stored as the *end* of the day it names — "back by
   * Friday" is Friday at 23:59 — so a flat 24 hours would fire the message
   * around midnight on Thursday, when nobody can do anything about it and
   * plenty of people are asleep. Thirty-six puts it at Thursday lunchtime: the
   * day before, at an hour when walking the thing back to the lab is possible.
   */
  RETURN_REMINDER_LEAD_HOURS: z.coerce.number().int().min(1).max(168).default(36),

  /**
   * UCF's academic calendar feed. Terms are read from
   * `<base>/<year>/<season>` — see `src/semester.ts`, which falls back to
   * fixed dates when this cannot be reached, because the club's dues year
   * cannot depend on somebody else's uptime.
   */
  UCF_CALENDAR_URL: z
    .url()
    .default('https://calendar.ucf.edu/json')
    .transform((value) => value.replace(/\/+$/, '')),

  // --------------------------------------------------------------- Stripe

  /**
   * Optional, like Postmark and Discord, and for the same reason: the club has
   * to be able to run the site before somebody with access to the Stripe
   * account has made keys. Unset, dues simply cannot be paid here — the page
   * says so and points at an officer — rather than the site failing to start.
   *
   * A *secret* key, `sk_…`. The publishable key belongs to the browser and is
   * configured in the web package as `VITE_STRIPE_PUBLISHABLE_KEY`.
   */
  STRIPE_SECRET_KEY: z.string().min(1).optional(),

  /**
   * The signing secret for the webhook endpoint, `whsec_…`.
   *
   * Separately optional from the key above, because the two are configured at
   * different moments: `stripe listen` prints a fresh one every time it starts,
   * and a checkout can be walked end to end without any webhook at all — the
   * confirm-return path asks Stripe directly. Without this, `/api/stripe/webhook`
   * refuses every delivery, which is the only safe thing an endpoint that cannot
   * check a signature can do.
   */
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),

  // ---------------------------------------------------------------- uploads

  /**
   * Ceilings for the two kinds of file the site stores, in megabytes. Files
   * live in Postgres as bytea — at club scale that is simpler and safer than
   * a blob store, and it is what makes "delete the file when the print is
   * done" one DELETE — but it means every upload is buffered through this
   * process, so the caps are what keep one request from being a memory event.
   */
  MAX_PRINT_FILE_MB: z.coerce.number().int().min(1).max(100).default(30),
  MAX_IMAGE_FILE_MB: z.coerce.number().int().min(1).max(20).default(5),

  /**
   * How much material each member gets for their *own* prints in one term, in
   * grams — FDM and resin together, because it is one budget rather than one
   * per machine.
   *
   * Configuration rather than a constant for the reason the dues prices are:
   * the number is a club decision, and a lab manager changing it should be one
   * line in `.env` and a restart. Prints made for a project are not counted
   * against it at all.
   */
  PERSONAL_PRINT_GRAMS: z.coerce.number().int().min(0).max(100_000).default(500),

  /**
   * Who the bot DMs about new print and equipment requests: Discord user ids,
   * comma-separated. Unset, it falls back to every ADMIN/OFFICER account with
   * a confirmed `discordId`. Does nothing without the bot pair above.
   */
  OFFICER_ALERT_DISCORD_IDS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    )
    .refine((ids) => ids.every((id) => /^\d{17,20}$/.test(id)), {
      message: 'each entry must be a Discord snowflake (17-20 digits)',
    }),
})
  .refine(
    (parsed) =>
      Boolean(parsed.DISCORD_BOT_TOKEN) === Boolean(parsed.DISCORD_GUILD_ID),
    {
      // Same reasoning as the Postmark set below. A token with no guild has
      // nowhere to look and a guild with no token cannot ask, so either one
      // alone is a check that quietly never runs — and the whole point of the
      // check is that a wrong handle is caught at signup rather than months
      // later by whoever tries to message that member.
      message:
        'DISCORD_BOT_TOKEN and DISCORD_GUILD_ID must be set together, or left unset together',
    },
  )
  .refine(
    (parsed) =>
      ![
        parsed.DISCORD_OFFICER_ROLE_ID,
        parsed.DISCORD_MEMBER_ROLE_ID,
        parsed.DISCORD_PROJECT_LEAD_ROLE_ID,
        parsed.DISCORD_TEAM_LEAD_ROLE_ID,
      ].some(Boolean) || (parsed.DISCORD_BOT_TOKEN && parsed.DISCORD_GUILD_ID),
    {
      // One-directional, unlike the pair above, because these are not the same
      // kind of dependency. A bot with no role ids is the club as it stands
      // — handles are checked, trials are announced, nobody is appointed. A
      // role id with no bot is a setting that reads exactly like it is running
      // the board and cannot ask Discord anything.
      message:
        'A Discord role id needs DISCORD_BOT_TOKEN and DISCORD_GUILD_ID — without a bot there is nothing to read the role from or write it to',
    },
  )
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

// Warned about rather than ignored. A leftover value that reads exactly like
// the thing that controls the emailed link, and no longer does, is worth more
// than a startup line the first time somebody changes it and nothing moves.
if (process.env.SIGNUP_VERIFY_URL) {
  console.warn(
    'SIGNUP_VERIFY_URL is no longer read — the site address comes from SITE_URL now. Remove it from .env.',
  )
}

/**
 * The two ways moving to `https://` goes wrong quietly.
 *
 * Neither is fatal — TLS can legitimately terminate in Node, and a staging box
 * on plain http is a real thing — so these warn rather than refuse. Both are
 * worth saying out loud because the symptom is nowhere near the cause.
 */
const siteIsSecure = parsed.data.SITE_URL.startsWith('https://')

if (parsed.data.NODE_ENV === 'production' && !siteIsSecure) {
  // Every verification link carries a token in its query string, and over plain
  // http that token is readable by anything between the student and the site.
  console.warn(
    `SITE_URL is ${parsed.data.SITE_URL} in production — signup links carry a token and would be sent unencrypted. Serve the site over https.`,
  )
}

if (parsed.data.SESSION_COOKIE_SAMESITE === 'none' && !siteIsSecure) {
  // Browsers reject `SameSite=None` without `Secure` outright, and silently:
  // the Set-Cookie header is simply dropped. Signing in then appears to work —
  // 200, no error anywhere — and every request after it is anonymous.
  console.warn(
    'SESSION_COOKIE_SAMESITE=none needs an https SITE_URL. Browsers drop a SameSite=None cookie that is not Secure, so sign-in will appear to succeed and nobody will stay signed in.',
  )
}

if (parsed.data.STRIPE_SECRET_KEY) {
  const live = parsed.data.STRIPE_SECRET_KEY.startsWith('sk_live_')

  if (live && parsed.data.NODE_ENV !== 'production') {
    // Test keys and live keys differ by four characters and nothing else. A
    // live key on a development box means the next card typed into the dues
    // page is charged for real, to a member, with no obvious way to tell from
    // the screen that anything is different.
    console.warn(
      `STRIPE_SECRET_KEY is a LIVE key and NODE_ENV is ${parsed.data.NODE_ENV}. Payments made against this server will charge real cards. Use an sk_test_ key outside production.`,
    )
  }

  if (!live && parsed.data.NODE_ENV === 'production') {
    console.warn(
      'STRIPE_SECRET_KEY is a test key in production — dues payments will look like they worked and take no money.',
    )
  }

  if (!parsed.data.STRIPE_WEBHOOK_SECRET) {
    // Survivable, and normal in development: the confirm-return path asks
    // Stripe about the intent directly, so a member who stays on the page is
    // credited either way. What is lost is the member who pays and closes the
    // tab, or whose bank takes an hour over 3-D Secure — the webhook is the
    // only thing that credits those.
    console.warn(
      'STRIPE_WEBHOOK_SECRET is unset — /api/stripe/webhook will refuse every delivery. A payment that completes after the member closes the tab will not be credited until they open the dues page again.',
    )
  }
}

if (siteIsSecure && !parsed.data.TRUST_PROXY) {
  // An https site almost always means TLS terminates in front of this process,
  // and to a proxied request every visitor arrives from the proxy's address.
  // The rate limiter then buckets the entire internet together: the fifth
  // signup of the day, from anyone, gets a 429 nobody can explain.
  console.warn(
    'SITE_URL is https but TRUST_PROXY is false. If TLS terminates at a proxy, every visitor shares one rate-limit bucket — set TRUST_PROXY=true, but only once that proxy overwrites X-Forwarded-For.',
  )
}

export const env = {
  ...parsed.data,

  /**
   * Every origin a browser may call the API from: the site itself, plus
   * whatever `CORS_ORIGINS` adds. The site's own origin can't be left out by
   * accident, which is the failure this replaces — an allow-list that no longer
   * contains the site is a page of error states and a console full of CORS.
   */
  allowedOrigins: [...new Set([parsed.data.SITE_URL, ...parsed.data.CORS_ORIGINS])],

  /**
   * Where the verification link in the signup email points.
   *
   * The frontend, not this API: the join page there posts the token back, so
   * the token is spent by a POST rather than by the GET that opens the URL.
   * Mail scanners follow every link in an incoming message, and against a GET
   * endpoint that uses the verification up before the student ever clicks it.
   */
  signupVerifyUrl: `${parsed.data.SITE_URL}/join`,
}
