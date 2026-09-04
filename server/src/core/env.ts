import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),

  /**
   * Where the website lives — the one place its address is configured.
   *
   * The CORS allow-list and the signup link are both derived from this. They used
   * to be set separately, so moving the site to a real domain took two edits and
   * forgetting the second sent every verification email to localhost.
   */
  SITE_URL: z
    .url()
    .default('http://localhost:5173')
    // A trailing slash here becomes `//join` in the emailed link, which some
    // hosts serve and others 404.
    .transform((value) => value.replace(/\/+$/, '')),

  /**
   * Extra origins allowed to call the API, comma-separated, on top of `SITE_URL` —
   * a preview deploy, or `:4173` for `vite preview`. Unset, the site's own origin
   * is the only one allowed.
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

  // Connection pool. Every instance opens up to DATABASE_POOL_MAX connections, so
  // instances x max must stay under the server's max_connections (100 by default).
  // Put PgBouncer in front before that stops being true.
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

  // Postmark, for the contact form. Optional as a set: the site has to run without
  // a mail account, because `contact_messages` is the record and email is only a
  // notification on top of it. All three or none — see the refine below.
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

  /**
   * How long a password-reset or email-change link stays good.
   *
   * Shorter than the signup one, and one value for both because they're the same
   * risk: a signup link creates an account nobody had, either of these takes over
   * one somebody already has. Nobody sits on one for two hours.
   */
  ACCOUNT_TOKEN_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),

  // Discord. Optional as a set, like Postmark: the club has to be able to run the
  // site before somebody with server permissions has made a bot. Unset, the handle
  // is stored as typed and nothing confirms it — the API says so at startup,
  // because an unconfirmed handle looks exactly like a confirmed one.
  //
  /** A *bot* token. Not the application's client secret, and not a user token. */
  DISCORD_BOT_TOKEN: z.string().min(1).optional(),
  /** The club server's id — a snowflake, so digits only. */
  DISCORD_GUILD_ID: z
    .string()
    .regex(/^\d{17,20}$/, 'must be a Discord snowflake (17-20 digits)')
    .optional(),
  /**
   * The Discord role that is the officer board.
   *
   * Set it and the club appoints officers in Discord: whoever carries this role is
   * an `OFFICER` on the site, and whoever loses it stops being one. Unset, officers
   * are set by hand in Prisma Studio.
   *
   * Unset is the safety valve and the default for a reason. The first sweep after
   * this is set stands down every sitting officer in the guild without the role, so
   * the order is: match the role to the board you want, then set this, then read
   * the first sweep's log. Nothing in the code can tell a board that hasn't been
   * given the role yet from one that's been dissolved.
   */
  DISCORD_OFFICER_ROLE_ID: z
    .string()
    .regex(/^\d{17,20}$/, 'must be a Discord snowflake (17-20 digits)')
    .optional(),

  /**
   * Who used to run the club — the club's Officer Alumni role.
   *
   * Same direction as the officer role above: Discord is the record and the site
   * follows it into `User.officerAlumnus`, which is what the roster's ALUMNI chip
   * selects on. The club has been marking alumni in Discord for years.
   *
   * It must never be added to the three below. Those are roles the site writes, and
   * this one sits below the bot in the hierarchy — so a copy of this id in their
   * company would make `discordRoles.ts` an owner of it, and the first sweep would
   * strip twenty-seven people's alumni role. Every role has exactly one owner.
   */
  DISCORD_OFFICER_ALUMNI_ROLE_ID: z
    .string()
    .regex(/^\d{17,20}$/, 'must be a Discord snowflake (17-20 digits)')
    .optional(),

  /**
   * The three roles that follow the site — the opposite direction from the two
   * above, and the distinction is the whole design.
   *
   * Discord appoints the board and the site reads it. The site decides these three
   * and pushes them: a running dues date carries `DISCORD_MEMBER_ROLE_ID`, a
   * project lead `DISCORD_PROJECT_LEAD_ROLE_ID`, a team lead
   * `DISCORD_TEAM_LEAD_ROLE_ID`. See `src/discord/discordRoles.ts`.
   *
   * Each is independently optional, and unset means never touched — there's no mode
   * in which an unconfigured role is read or written, which is what lets the club
   * switch one on at a time.
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
   * The channel the lab-open/lab-closed sign lives in.
   *
   * Independently optional like the role ids, and unset means the site still tracks
   * whether the lab is open with nothing pushed to Discord. That's supported, not
   * broken, and the API says which at startup.
   *
   * The bot needs three different permissions in this channel: Send Messages and
   * Read Message History for the sign, Manage Channels for the name. Only one
   * failing is the awkward case — the message says OPEN while the channel still
   * reads closed — so each is logged by name when Discord refuses.
   */
  DISCORD_LAB_CHANNEL_ID: z
    .string()
    .regex(/^\d{17,20}$/, 'must be a Discord snowflake (17-20 digits)')
    .optional(),

  /**
   * Where the sign starts, on a database that has never pushed one.
   *
   * A seed, and it doesn't outrank the row. It can't: opening the lab posts a new
   * message and deletes the one before it, so the id changes every evening and a
   * setting that won would point at a message this server deleted.
   *
   * It's for the first push against a channel that already has a sign: point this
   * at that message and it's adopted rather than joined by a second one. After that
   * it's never read again, and clearing it is safe.
   *
   * It has to be a message the bot itself posted — Discord lets a bot edit only its
   * own, so an id belonging to a person is a 403 for ever, logged by name.
   */
  DISCORD_LAB_MESSAGE_ID: z
    .string()
    .regex(/^\d{17,20}$/, 'must be a Discord snowflake (17-20 digits)')
    .optional(),

  /**
   * The application's public key, from the Discord developer portal.
   *
   * Almost certainly not needed. A bot is told about a button press in exactly two
   * ways: down a WebSocket it already holds open, or by an HTTP POST to a public
   * URL registered on the application. The club runs on the first, which needs no
   * public address, no endpoint URL and no key.
   *
   * This is for the second, and only matters once the API is on a real domain with
   * an Interactions Endpoint URL registered: Discord signs each POST with the
   * application's Ed25519 key and this checks the signature. Without it
   * `/api/discord/interactions` refuses every delivery, which is the only safe
   * thing an unauthenticated endpoint that can't check a signature can do.
   *
   * Setting this doesn't turn buttons on and leaving it unset doesn't turn them
   * off — `buttonsLive` decides that.
   *
   * 64 hex characters. Not the client secret and not the bot token; both are the
   * wrong length, which is why the shape is checked. The shape is all that can be
   * checked: another application's public key is also 64 hex characters and imports
   * perfectly, and the only symptom is an endpoint that refuses every delivery.
   */
  DISCORD_PUBLIC_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters — the application public key, not the bot token')
    .optional(),

  /**
   * Work out every role change and write none of them, naming each in the log.
   *
   * This is the one sweep whose mistakes land on other people's Discord accounts
   * rather than in a table somebody can correct. A club switching the sync on reads
   * one sweep's output first and checks the removals are the ones it meant.
   */
  DISCORD_ROLE_SYNC_DRY_RUN: z.stringbool().default(false),

  // ------------------------------------------------------------- sessions

  /**
   * How long a session survives without being used. An idle timeout, not a hard one
   * — every authenticated request rolls it forward — so somebody who turns up to
   * build nights is never signed out mid-term, and a browser left on a lab machine
   * still goes stale on schedule.
   */
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  SESSION_COOKIE_NAME: z.string().min(1).default('rccf_session'),

  /**
   * `SameSite` for the session cookie, and the one setting that decides whether
   * signing in works at all once this is deployed.
   *
   * `lax` is right whenever the site and the API share a registrable domain —
   * `localhost:5173` and `localhost:4000` do, and so would `rccf.org` and
   * `api.rccf.org`. Ports and subdomains aren't what "same site" means.
   *
   * `none` is for the case where they genuinely differ, and it isn't free: browsers
   * refuse a `SameSite=None` cookie that isn't also `Secure`, so it requires https,
   * and it re-opens the CSRF that `lax` closes by itself. `originGuard` in
   * `src/routes/account/auth.ts` is what covers that.
   */
  SESSION_COOKIE_SAMESITE: z.enum(['lax', 'none']).default('lax'),

  /**
   * Set only to share one session across subdomains, e.g. `.rccf.org`. Left
   * unset the cookie is host-only, which is the tighter of the two.
   */
  SESSION_COOKIE_DOMAIN: z.string().min(1).optional(),

  // ----------------------------------------------------------------- dues

  /**
   * Dues, in cents, because that's the unit Stripe charges in. Read from
   * configuration rather than the code so a treasurer changing the price is one line
   * in `.env` — and served to the browser from `GET /api/dues/status`, so the page
   * can never print a number the server wouldn't charge.
   */
  DUES_SEMESTER_CENTS: z.coerce.number().int().min(50).default(2_500),
  DUES_YEAR_CENTS: z.coerce.number().int().min(50).default(5_000),

  /**
   * How long the free trial runs from the first day of classes. Everyone gets
   * it, every fall and spring; summer has no trial because summer is free
   * outright.
   */
  TRIAL_DAYS: z.coerce.number().int().min(0).max(60).default(21),

  /**
   * How long before a loan falls due the bot says something, in hours.
   *
   * A day and a half, and the odd number is the point: a due date is stored as the
   * end of the day it names, so a flat 24 hours would fire around midnight on
   * Thursday when nobody can act on it. Thirty-six puts it at Thursday lunchtime.
   */
  RETURN_REMINDER_LEAD_HOURS: z.coerce.number().int().min(1).max(168).default(36),

  /**
   * How long after a task's deadline the bot asks about it, in minutes.
   *
   * A grace period rather than a lead time — the opposite direction from the loan
   * reminder. A task marked done five minutes late should never have been chased.
   *
   * The tick is ten minutes, so what lands is 30 to 40 minutes after the deadline.
   * That slack isn't worth engineering away.
   */
  TASK_OVERDUE_GRACE_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),

  /**
   * How far back the overdue-task sweep will look, in days.
   *
   * A floor, for the day the feature is deployed: without one, the first sweep walks
   * every task the club has ever left open and DMs people about last semester. Three
   * days is "you have just missed this"; anything older wants a lead having a word.
   */
  TASK_OVERDUE_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(90).default(3),

  /**
   * UCF's academic calendar feed. Terms are read from `<base>/<year>/<season>` — see
   * `src/membership/semester.ts`, which falls back to fixed dates when this can't be
   * reached, because the club's dues year can't depend on somebody else's uptime.
   */
  UCF_CALENDAR_URL: z
    .url()
    .default('https://calendar.ucf.edu/json')
    .transform((value) => value.replace(/\/+$/, '')),

  // --------------------------------------------------------------- Stripe

  /**
   * Optional, like Postmark and Discord: the club has to be able to run the site
   * before somebody with access to the Stripe account has made keys. Unset, dues
   * simply can't be paid here — the page says so and points at an officer — rather
   * than the site failing to start.
   *
   * A secret key, `sk_…`. The publishable key belongs to the browser and is
   * configured in the web package as `VITE_STRIPE_PUBLISHABLE_KEY`.
   */
  STRIPE_SECRET_KEY: z.string().min(1).optional(),

  /**
   * The signing secret for the webhook endpoint, `whsec_…`.
   *
   * Separately optional from the key above, because the two are configured at
   * different moments: `stripe listen` prints a fresh one every start, and a
   * checkout can be walked end to end without any webhook — the confirm-return path
   * asks Stripe directly. Without this, `/api/stripe/webhook` refuses every delivery.
   */
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),

  // ---------------------------------------------------------------- uploads

  /**
   * Ceilings for the three kinds of file the site stores, in megabytes. Files live
   * in Postgres as bytea — simpler and safer at club scale, and what makes "delete
   * the file when the print is done" one DELETE — but every upload is buffered
   * through this process, so the caps keep one request from being a memory event.
   *
   * Documents get the middle number: a design review with photographs is larger than
   * a downscaled gallery image and smaller than a mesh, and unlike both nothing
   * shrinks it on the way — a PDF can't be re-encoded the way `downscaleImage`
   * handles a photograph.
   */
  MAX_PRINT_FILE_MB: z.coerce.number().int().min(1).max(100).default(30),
  MAX_IMAGE_FILE_MB: z.coerce.number().int().min(1).max(20).default(5),
  MAX_DOCUMENT_FILE_MB: z.coerce.number().int().min(1).max(50).default(15),

  /**
   * How much material each member gets for their own prints in one term, in grams —
   * FDM and resin together, because it's one budget rather than one per machine.
   *
   * Configuration rather than a constant for the reason the dues prices are: the
   * number is a club decision. Prints made for a project aren't counted against it.
   */
  PERSONAL_PRINT_GRAMS: z.coerce.number().int().min(0).max(100_000).default(500),

  /**
   * Who the bot DMs about new print and equipment requests: Discord user ids,
   * comma-separated. Unset, it falls back to every ADMIN/OFFICER account with a
   * confirmed `discordId`. Does nothing without the bot pair above.
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
      // Same reasoning as the Postmark set below. A token with no guild has nowhere
      // to look and a guild with no token can't ask, so either alone is a check that
      // quietly never runs — and the point of the check is that a wrong handle is
      // caught at signup rather than months later.
      message:
        'DISCORD_BOT_TOKEN and DISCORD_GUILD_ID must be set together, or left unset together',
    },
  )
  .refine(
    (parsed) =>
      ![
        parsed.DISCORD_OFFICER_ROLE_ID,
        parsed.DISCORD_OFFICER_ALUMNI_ROLE_ID,
        parsed.DISCORD_MEMBER_ROLE_ID,
        parsed.DISCORD_PROJECT_LEAD_ROLE_ID,
        parsed.DISCORD_TEAM_LEAD_ROLE_ID,
        parsed.DISCORD_LAB_CHANNEL_ID,
        parsed.DISCORD_LAB_MESSAGE_ID,
        parsed.DISCORD_PUBLIC_KEY,
      ].some(Boolean) || (parsed.DISCORD_BOT_TOKEN && parsed.DISCORD_GUILD_ID),
    {
      // One-directional, unlike the pair above, because these aren't the same kind of
      // dependency. A bot with no ids under it is the club as it stands. An id with
      // no bot is a setting that reads exactly like it's running the board, or
      // keeping the lab sign up to date, and can't ask Discord anything.
      message:
        'A Discord role or channel id needs DISCORD_BOT_TOKEN and DISCORD_GUILD_ID — without a bot there is nothing to read it from or write it to',
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
      // Refusing to start is the point. Two of the three set is a server that comes
      // up, takes messages, tells everyone they were sent, and delivers nothing — a
      // failure you hear about from the person who never got a reply, months later.
      message:
        'POSTMARK_TOKEN, CONTACT_FROM_EMAIL and CONTACT_TO_EMAIL must be set together, or left unset together',
    },
  )

/**
 * Blank is unset.
 *
 * `FOO=` in a `.env` file arrives as `''`, and an operator who cleared a value meant
 * off — not "a value that fails validation", which is what an empty string is
 * against a regex, and which exits the process at boot over a line somebody thought
 * they had disabled.
 *
 * It also makes "unset" something a test can say. `vi.stubEnv(key, undefined)`
 * deletes the variable, and `dotenv` fills a missing one back in from the
 * developer's real `.env` — so a suite on a configured machine could find itself
 * testing the club's actual bot. An empty string is present, so dotenv leaves it
 * alone, and it lands here as absent.
 *
 * Safe across the whole object: every variable with a default already treats `''`
 * and absent identically, and none means anything by an empty string.
 */
const source = Object.fromEntries(
  Object.entries(process.env).map(([key, value]) => [
    key,
    value === '' ? undefined : value,
  ]),
)

const parsed = envSchema.safeParse(source)

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n')
  console.error(`Invalid environment:\n${details}`)
  process.exit(1)
}

// Warned about rather than ignored. A leftover value that reads exactly like the
// thing controlling the emailed link, and no longer does, is worth a line the first
// time somebody changes it and nothing moves.
if (process.env.SIGNUP_VERIFY_URL) {
  console.warn(
    'SIGNUP_VERIFY_URL is no longer read — the site address comes from SITE_URL now. Remove it from .env.',
  )
}

/**
 * The two ways moving to `https://` goes wrong quietly.
 *
 * Neither is fatal — TLS can legitimately terminate in Node, and a staging box on
 * plain http is a real thing — so these warn rather than refuse. Both are worth
 * saying out loud because the symptom is nowhere near the cause.
 */
const siteIsSecure = parsed.data.SITE_URL.startsWith('https://')

if (parsed.data.NODE_ENV === 'production' && !siteIsSecure) {
  // Every verification link carries a token in its query string, and over plain http
  // that token is readable by anything between the student and the site.
  console.warn(
    `SITE_URL is ${parsed.data.SITE_URL} in production — signup links carry a token and would be sent unencrypted. Serve the site over https.`,
  )
}

if (parsed.data.SESSION_COOKIE_SAMESITE === 'none' && !siteIsSecure) {
  // Browsers reject `SameSite=None` without `Secure` outright, and silently: the
  // Set-Cookie header is dropped. Signing in then appears to work — 200, no error
  // anywhere — and every request after it is anonymous.
  console.warn(
    'SESSION_COOKIE_SAMESITE=none needs an https SITE_URL. Browsers drop a SameSite=None cookie that is not Secure, so sign-in will appear to succeed and nobody will stay signed in.',
  )
}

// Nothing is warned about here for the buttons, and that's the point: whether a
// press reaches this server isn't something `.env` knows. It depends on whether the
// application has an Interactions Endpoint URL registered, which is read off Discord
// at startup — see `confirmInteractionEndpoint`.
if (parsed.data.DISCORD_PUBLIC_KEY && !parsed.data.DISCORD_LAB_CHANNEL_ID) {
  // Still worth one: the endpoint would verify signatures perfectly and there'd be
  // nothing carrying a button to press, so it never hears from Discord at all —
  // which reads exactly like a signature that doesn't verify.
  console.warn(
    'DISCORD_PUBLIC_KEY is set but DISCORD_LAB_CHANNEL_ID is not — there is no sign for the buttons to sit on.',
  )
}

if (parsed.data.STRIPE_SECRET_KEY) {
  const live = parsed.data.STRIPE_SECRET_KEY.startsWith('sk_live_')

  if (live && parsed.data.NODE_ENV !== 'production') {
    // Test keys and live keys differ by four characters and nothing else. A live key
    // on a development box means the next card typed into the dues page is charged
    // for real, with nothing on screen to say so.
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
    // Survivable, and normal in development: the confirm-return path asks Stripe
    // about the intent directly, so a member who stays on the page is credited either
    // way. What's lost is the member who pays and closes the tab, or whose bank takes
    // an hour over 3-D Secure.
    console.warn(
      'STRIPE_WEBHOOK_SECRET is unset — /api/stripe/webhook will refuse every delivery. A payment that completes after the member closes the tab will not be credited until they open the dues page again.',
    )
  }
}

if (siteIsSecure && !parsed.data.TRUST_PROXY) {
  // An https site almost always means TLS terminates in front of this process, and to
  // a proxied request every visitor arrives from the proxy's address. The rate
  // limiter then buckets the entire internet together: the fifth signup of the day,
  // from anyone, gets a 429 nobody can explain.
  console.warn(
    'SITE_URL is https but TRUST_PROXY is false. If TLS terminates at a proxy, every visitor shares one rate-limit bucket — set TRUST_PROXY=true, but only once that proxy overwrites X-Forwarded-For.',
  )
}

export const env = {
  ...parsed.data,

  /**
   * Every origin a browser may call the API from: the site itself, plus whatever
   * `CORS_ORIGINS` adds. The site's own origin can't be left out by accident, which
   * is the failure this replaces.
   */
  allowedOrigins: [...new Set([parsed.data.SITE_URL, ...parsed.data.CORS_ORIGINS])],

  /**
   * Where the verification link in the signup email points.
   *
   * The frontend, not this API: the join page posts the token back, so it's spent by
   * a POST rather than by the GET that opens the URL. Mail scanners follow every link
   * in an incoming message, and against a GET endpoint that spends the verification
   * before the student ever clicks it.
   */
  signupVerifyUrl: `${parsed.data.SITE_URL}/join`,

  /**
   * Where the password-reset link points. The frontend again, and for the same
   * reason: the reset page posts the token back, so a mail scanner following the URL
   * can't spend it.
   */
  passwordResetUrl: `${parsed.data.SITE_URL}/reset-password`,

  /**
   * Where the email-change confirmation points — the profile page the change was
   * started from, which posts the token back and then says the address has moved.
   * Behind the dashboard's session gate, which carries the query string through.
   */
  emailChangeUrl: `${parsed.data.SITE_URL}/dashboard/profile`,
}
