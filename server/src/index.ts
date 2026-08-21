import { serve } from '@hono/node-server'
import { app } from './app.js'
import { prisma } from './db.js'
import {
  discordConfigured,
  memberRoleId,
  officerSyncConfigured,
  projectLeadRoleId,
  roleSyncDryRun,
  teamLeadRoleId,
} from './discord.js'
import { syncDiscordOfficers } from './discordOfficers.js'
import { sweepDiscordRoles } from './discordRoles.js'
import { env } from './env.js'
import { sweepReturnReminders } from './equipmentReminder.js'
import { mailConfigured } from './mail.js'
import { sweepLapsedMembers } from './membershipSweep.js'
import { sweepRateLimits } from './rateLimit.js'
import { sweepSignups } from './routes/signup.js'
import { forgetFinishedTerms, primeCalendar } from './semester.js'
import { sweepSessions } from './session.js'
import { stripeConfigured, webhooksConfigured } from './stripe.js'
import { sweepTrialNotices } from './trialNotice.js'

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
  // Who is an officer is a permission level, and this is the setting that
  // decides whether Discord or a person answers that. Worth a line either way:
  // switched on, it will stand somebody down within ten minutes of them losing
  // the role, and the first sweep after it is switched on is the one to watch.
  console.log(
    officerSyncConfigured
      ? `Discord officer sync → role ${env.DISCORD_OFFICER_ROLE_ID ?? ''}`
      : 'Discord officer sync OFF (no DISCORD_OFFICER_ROLE_ID) — officers are set by hand',
  )
  // The only thing here that writes to somebody else's service, so it says
  // which of the three club roles it is allowed to touch rather than a bare
  // on/off. A project's own role is not listed — that lives on the row.
  const pushed = [
    memberRoleId && 'member',
    projectLeadRoleId && 'project lead',
    teamLeadRoleId && 'team lead',
  ].filter(Boolean)
  console.log(
    pushed.length > 0
      ? `Discord role sync → ${pushed.join(', ')}${roleSyncDryRun ? ' (DRY RUN — nothing is written)' : ''}`
      : 'Discord role sync OFF (no role ids) — only projects carrying a role are synced',
  )
  // A dues page that cannot take a card looks exactly like one that can, right
  // up to the moment somebody tries.
  console.log(
    stripeConfigured
      ? `Dues → Stripe (${(env.DUES_SEMESTER_CENTS / 100).toFixed(2)}/semester, ${(env.DUES_YEAR_CENTS / 100).toFixed(2)}/year)${webhooksConfigured ? '' : ', webhooks OFF'}`
      : 'Dues payments OFF (no STRIPE_SECRET_KEY) — the dues page says so and points at an officer',
  )
  // The trial notice is a message to a real person, and the sweep below is the
  // only thing that sends it.
  if (!discordConfigured) {
    console.log(
      'Trial-end messages and equipment return reminders OFF (no DISCORD_BOT_TOKEN)',
    )
  }

  // Which term the server thinks it is, said out loud, because it is the first
  // thing anyone asks when the dues page quotes a date that looks wrong.
  void primeCalendar().catch((error: unknown) => {
    console.error('ucf calendar: initial fetch failed', error)
  })
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
    void sweepSessions().catch((error: unknown) => {
      console.error('session sweep failed', error)
    })
    forgetFinishedTerms()

    // These three run in *sequence*, unlike everything else on this tick, and
    // the order is the point. Dues decide what somebody is; the club's Discord
    // role decides whether they are an officer on top of that; only once both
    // have settled is it worth telling Discord which roles they should carry.
    // Firing them together would push a state that the next two lines were
    // about to change, and the club would see a role flicker every ten minutes.
    //
    // It also means `sweepLapsedMembers` needs no hook of its own: it demotes
    // in one bulk `updateMany` with no per-row callback, and the role sweep
    // reconciling straight afterwards in the same tick covers it.
    void sweepLapsedMembers()
      .then((report) => {
        // Quiet unless it did something. Most of the year there is nothing
        // expired for anybody and this returns on the first query.
        if (report.demoted > 0) {
          console.log(
            `membership sweep: ${report.demoted} lapsed member(s) moved back to GUEST`,
          )
        }
      })
      .catch((error: unknown) => {
        console.error('membership sweep failed', error)
      })
      // The other half of who somebody is: dues decide MEMBER vs GUEST above,
      // the club's Discord role decides OFFICER here. Off unless
      // `DISCORD_OFFICER_ROLE_ID` is set, and it stands down rather than
      // writing anything whenever the guild cannot be read or the answer looks
      // like a misconfiguration. See `src/discordOfficers.ts` — all four
      // refusals are documented there and every one of them is about not
      // standing the whole board down by accident.
      .then(() => syncDiscordOfficers())
      .then((report) => {
        // Quiet unless it did something. This fires every ten minutes and the
        // board changes twice a year.
        if (report.promoted + report.demoted > 0) {
          console.log(
            `discord officers: ${report.promoted} promoted, ${report.demoted} stood down`,
          )
        }
      })
      .catch((error: unknown) => {
        console.error('discord officer sync failed', error)
      })
      // And the direction nothing else on this server goes: Postgres out to
      // Discord. Everything above decided what people *are*; this hands out the
      // roles that follow from it. Off unless one of the role ids is set or a
      // project carries one, and it refuses rather than writes whenever the
      // guild cannot be read or a removal looks like a misconfiguration. See
      // `src/discordRoles.ts`.
      .then(() => sweepDiscordRoles())
      .then((report) => {
        if (report.added + report.removed > 0) {
          console.log(
            `discord roles: ${report.added} added, ${report.removed} removed across ${report.people} matched member(s)`,
          )
        }
        // Both of these mean the sweep deliberately did less than it worked
        // out, and neither is an error — but silence would make a backlog look
        // like nothing to do.
        if (report.budgetSpent) {
          console.log(
            'discord roles: write budget spent, the rest follows next sweep',
          )
        }
        if (report.heldBack.length > 0) {
          console.warn(
            `discord roles: ${report.heldBack.length} role(s) held back this sweep — see the warnings above`,
          )
        }
      })
      .catch((error: unknown) => {
        console.error('discord role sync failed', error)
      })

    // Unlike the others this one *sends* something, so it runs on every
    // instance and is safe to: a notice is claimed by inserting its primary key
    // before the message goes out, so two instances arriving together means one
    // insert and one collision. See `src/trialNotice.ts`.
    void sweepTrialNotices()
      .then((report) => {
        // Quiet unless it did something. This fires every ten minutes all year
        // and the trial ends twice.
        if (report.claimed > 0) {
          console.log(
            `trial notices: ${report.sent} sent, ${report.failed} failed of ${report.claimed} claimed`,
          )
        }
      })
      .catch((error: unknown) => {
        console.error('trial notice sweep failed', error)
      })

    // The other thing that sends, and safe from every instance for the same
    // reason: the reminder is claimed by writing the deadline it is about onto
    // the loan, conditional on the value that was read a moment earlier. See
    // `src/equipmentReminder.ts`.
    void sweepReturnReminders()
      .then((report) => {
        if (report.claimed > 0) {
          console.log(
            `return reminders: ${report.sent} sent, ${report.failed} failed of ${report.claimed} claimed`,
          )
        }
      })
      .catch((error: unknown) => {
        console.error('return reminder sweep failed', error)
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
