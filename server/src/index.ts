import { serve } from '@hono/node-server'
import { app } from './app.js'
import { prisma } from './db.js'
import { discordConfigured } from './discord.js'
import { env } from './env.js'
import { mailConfigured } from './mail.js'
import { sweepRateLimits } from './rateLimit.js'
import { sweepSignups } from './routes/signup.js'

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API listening on http://localhost:${info.port}/api`)
  // Said out loud at startup because the alternative is finding out from an
  // officer who never got a message. Unconfigured is a supported state, not a
  // broken one — the row is still written either way.
  console.log(
    mailConfigured
      ? `Contact notifications → ${env.CONTACT_TO_EMAIL ?? ''}`
      : 'Contact notifications OFF (no POSTMARK_TOKEN) — messages are stored only',
  )
  // Signup is the case where no mailer is not survivable: the verification link
  // is the flow, not a notification on top of it. In development the link goes
  // to this log instead, which is worth saying before somebody goes looking for
  // an email that was never sent.
  if (!mailConfigured) {
    console.log(
      env.NODE_ENV === 'production'
        ? 'Signups DISABLED (no POSTMARK_TOKEN) — /api/signup/start returns 503'
        : 'Signup verification links go to this log (no POSTMARK_TOKEN)',
    )
  }
  // An unchecked Discord handle is stored looking exactly like a checked one,
  // and everything the club builds on top of it joins on that string.
  console.log(
    discordConfigured
      ? `Discord username checks → guild ${env.DISCORD_GUILD_ID ?? ''}`
      : 'Discord username checks OFF (no DISCORD_BOT_TOKEN) — handles are stored unconfirmed',
  )
})

// Closed rate-limit windows and expired signup links are dead rows. Every
// instance sweeps; the deletes are idempotent, so overlapping runs are
// harmless. unref() keeps the timer from holding the process open during
// shutdown.
const sweep = setInterval(
  () => {
    void sweepRateLimits().catch((error: unknown) => {
      console.error('rate limit sweep failed', error)
    })
    void sweepSignups().catch((error: unknown) => {
      console.error('signup verification sweep failed', error)
    })
  },
  10 * 60 * 1000,
)
sweep.unref()

// Stop accepting connections, let in-flight requests finish, then drop the pool.
// Without this a rolling deploy cuts requests off mid-write.
let shuttingDown = false

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return
    shuttingDown = true

    clearInterval(sweep)
    server.close(() => {
      void prisma.$disconnect().then(() => process.exit(0))
    })

    // Don't let a stuck connection hold the deploy open forever.
    setTimeout(() => process.exit(1), 10_000).unref()
  })
}
