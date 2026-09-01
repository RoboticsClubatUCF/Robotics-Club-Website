import { serve } from '@hono/node-server'
import { app } from './app.js'
import { prisma } from './core/db.js'
import {
  confirmInteractionEndpoint,
  discordConfigured,
  labChannelConfigured,
  memberRoleId,
  alumniSyncConfigured,
  officerSyncConfigured,
  projectLeadRoleId,
  roleSyncDryRun,
  teamLeadRoleId,
} from './discord/discord.js'
import { syncOfficerAlumni } from './discord/discordAlumni.js'
import { startDiscordGateway, stopDiscordGateway } from './discord/discordGateway.js'
import { syncDiscordOfficers } from './discord/discordOfficers.js'
import { sweepDiscordRoles } from './discord/discordRoles.js'
import { env } from './core/env.js'
import { sweepReturnReminders } from './equipment/equipmentReminder.js'
import { sweepTaskReminders } from './discord/taskReminder.js'
import { sweepLabStatus } from './lab/labStatus.js'
import { mailConfigured } from './email/mail.js'
import { sweepLapsedMembers } from './membership/membershipSweep.js'
import { sweepRateLimits } from './core/rateLimit.js'
import { sweepEmailChanges } from './routes/account/account.js'
import { sweepPasswordResets } from './routes/account/auth.js'
import { sweepSignups } from './routes/account/signup.js'
import { forgetFinishedTerms, primeCalendar } from './membership/semester.js'
import { sweepSessions } from './auth/session.js'
import { stripeConfigured, webhooksConfigured } from './payments/stripe.js'

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
  // switched on, somebody carrying the role is promoted and somebody who has
  // lost it is stood down on their very next request, with the ten-minute sweep
  // as the backstop for everyone not currently browsing. The first sweep after
  // it is switched on is the one to watch.
  console.log(
    officerSyncConfigured
      ? `Discord officer sync → role ${env.DISCORD_OFFICER_ROLE_ID ?? ''}`
      : 'Discord officer sync OFF (no DISCORD_OFFICER_ROLE_ID) — officers are set by hand',
  )
  // Same direction, one column, and worth its own line because when it is off
  // the roster's ALUMNI chip is simply empty — which reads exactly like a page
  // that is broken rather than a feature nobody switched on.
  console.log(
    alumniSyncConfigured
      ? `Discord alumni sync → role ${env.DISCORD_OFFICER_ALUMNI_ROLE_ID ?? ''}`
      : 'Discord alumni sync OFF (no DISCORD_OFFICER_ALUMNI_ROLE_ID) — the roster’s ALUMNI chip will be empty',
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
  // The lab sign. Off is a supported state — officers still open and close the
  // lab on the site and the landing page still says which — so this says which
  // of the two is running, because from inside the dashboard they look
  // identical.
  console.log(
    labChannelConfigured
      ? `Lab status → Discord channel ${env.DISCORD_LAB_CHANNEL_ID ?? ''} (Discord is the record; the site follows it)`
      : 'Lab status Discord sign OFF (no DISCORD_LAB_CHANNEL_ID) — the site still tracks whether the lab is open',
  )
  // The other half of the sign, and the half that is invisible when it is
  // missing: without it the message carries no buttons at all, so "there is no
  // button in Discord" and "the endpoint is wrong" look identical from the
  // channel. Said here as well as warned about in `env.ts`, because this is the
  // line somebody reads when an officer asks where the button went.
  //
  // **A bot is told about a button press in exactly two ways and there is no
  // third**, and which one is running is a fact about the *application* rather
  // than a setting here: an application with an interactions endpoint URL has
  // every press POSTed there and its gateway told nothing. So Discord is asked
  // once, at startup, and the answer decides whether to hold a socket open.
  void confirmInteractionEndpoint()
    .then((check) => {
      switch (check.status) {
        case 'live':
          // The HTTP road. Nothing to hold open; presses arrive as requests.
          console.log(`Lab buttons → ${check.url}`)
          startDiscordGateway(true)
          return

        case 'endpoint_unusable':
          // The worst of the four states, and the only one worth a stack of
          // words: presses go to that URL, this server refuses every one of
          // them, and the gateway is not told either. Nothing works, and from
          // inside the channel it looks exactly like a button nobody wired up.
          console.error(
            `Lab buttons BROKEN — the application POSTs presses to ${check.url} and ${check.reason}. Either fix that, or clear the Interactions Endpoint URL in the developer portal and restart, which puts the buttons on the gateway and needs no public address at all.`,
          )
          startDiscordGateway(true)
          return

        case 'no_endpoint':
          // The road the club runs on. No public address, no key, nothing to
          // configure — the bot token is the whole of it.
          startDiscordGateway(false)
          return

        case 'unchecked':
          console.log('Lab buttons OFF (no DISCORD_BOT_TOKEN)')
          return

        default:
          // Asked and not answered. Buttons stay off rather than being attached
          // on a guess, and the next restart that can reach Discord turns them
          // on.
          console.log(
            `Lab buttons OFF — could not ask Discord which way presses are delivered (${check.reason}). They come back on the next restart that can.`,
          )
          return
      }
    })
    .catch((error: unknown) => {
      console.error('discord: interactions endpoint check failed', error)
    })
  // A dues page that cannot take a card looks exactly like one that can, right
  // up to the moment somebody tries.
  console.log(
    stripeConfigured
      ? `Dues → Stripe (${(env.DUES_SEMESTER_CENTS / 100).toFixed(2)}/semester, ${(env.DUES_YEAR_CENTS / 100).toFixed(2)}/year)${webhooksConfigured ? '' : ', webhooks OFF'}`
      : 'Dues payments OFF (no STRIPE_SECRET_KEY) — the dues page says so and points at an officer',
  )
  // Both sweeps below send a message to a real person, and they are the only
  // things that do.
  if (!discordConfigured) {
    console.log(
      'Equipment return reminders and overdue-task reminders OFF (no DISCORD_BOT_TOKEN)',
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
    // The other two hashed-token tables. Same reasoning as the signup one:
    // these rows are a live way into somebody's account, and an expired one is
    // not something to leave sitting in a table.
    void sweepPasswordResets().catch((error: unknown) => {
      console.error('password reset sweep failed', error)
    })
    void sweepEmailChanges().catch((error: unknown) => {
      console.error('email change sweep failed', error)
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
      // like a misconfiguration. See `src/discord/discordOfficers.ts` — all four
      // refusals are documented there and every one of them is about not
      // standing the whole board down by accident.
      .then(() => syncDiscordOfficers())
      .then((report) => {
        // Quiet unless it did something. This fires every ten minutes and the
        // board changes twice a year.
        if (report.promoted + report.demoted + report.opened + report.closed > 0) {
          console.log(
            `discord officers: ${report.promoted} promoted, ${report.demoted} stood down, ` +
              `${report.opened} term(s) opened, ${report.closed} closed`,
          )
        }
      })
      .catch((error: unknown) => {
        console.error('discord officer sync failed', error)
      })
      // Who used to run the club, from the same direction — Discord's Officer
      // Alumni role into `User.officerAlumnus`, which is what the roster's
      // ALUMNI chip selects on. In this chain rather than beside it because it
      // is a third full walk of the guild, and three of those fired at once is
      // exactly the shape Discord throttles. Off unless
      // `DISCORD_OFFICER_ALUMNI_ROLE_ID` is set; it writes one column and
      // nothing follows from it. See `src/discord/discordAlumni.ts`.
      .then(() => syncOfficerAlumni())
      .then((report) => {
        // Quiet unless it did something. The club's alumni list changes when a
        // board rotates, which is twice a year.
        if (report.marked + report.cleared > 0) {
          console.log(
            `discord alumni: ${report.marked} marked, ${report.cleared} cleared`,
          )
        }
      })
      .catch((error: unknown) => {
        console.error('discord alumni sync failed', error)
      })
      // And the direction nothing else on this server goes: Postgres out to
      // Discord. Everything above decided what people *are*; this hands out the
      // roles that follow from it. Off unless one of the role ids is set or a
      // project carries one, and it refuses rather than writes whenever the
      // guild cannot be read or a removal looks like a misconfiguration. See
      // `src/discord/discordRoles.ts`.
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

    // Three jobs on one row. It locks the lab up when the building shuts at ten
    // — the site masks that immediately, but the row and the Discord sign need
    // writing — it **reads the sign back and corrects the row against it**,
    // which is what makes Discord the record rather than a projection, and it
    // re-pushes a sign that did not land, almost always the channel *name*:
    // Discord allows two renames per ten minutes and this tick is that same
    // window, so a throttled one lands on the very next pass.
    void sweepLabStatus()
      .then((report) => {
        if (report.closed) {
          console.log('lab status: building hours reached, lab closed')
        }
        if (report.adopted) {
          // Worth a line of its own: it means the site and Discord had drifted,
          // and the direction they were put back in was Discord's.
          console.log("lab status: the row was corrected to match Discord's sign")
        }
        if (report.retried) {
          console.log('lab status: re-pushed a sign that had not landed')
        }
      })
      .catch((error: unknown) => {
        console.error('lab status sweep failed', error)
      })

    // Unlike the sweeps above this one *sends* something, and it still runs on
    // every instance: the reminder is claimed by writing the deadline it is
    // about onto the loan, conditional on the value read a moment earlier, so
    // two instances arriving together means one write and one no-op. See
    // `src/equipment/equipmentReminder.ts`.
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

    // The other sender, claimed the same way and for the same reason — the
    // deadline the message named, written onto the task conditional on the
    // value read a moment earlier. Deliberately *not* chained onto the
    // membership sequence above: that ordering is about Postgres settling
    // before Discord is told who is a member, and nothing here writes a role.
    //
    // `sent` counts messages and `claimed` counts tasks, which is why the line
    // says both rather than reading them as one number: somebody with three
    // late tasks gets one DM. See `src/discord/taskReminder.ts`.
    void sweepTaskReminders()
      .then((report) => {
        if (report.claimed > 0) {
          console.log(
            `task reminders: ${report.sent} sent, ${report.failed} failed, about ${report.claimed} overdue tasks`,
          )
        }
      })
      .catch((error: unknown) => {
        console.error('task reminder sweep failed', error)
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
    // Closed deliberately rather than left to the process exiting: a socket
    // that goes without a close frame reads to Discord as a dropped connection,
    // and the next start pays an identify for a session it could have resumed.
    stopDiscordGateway()
    server.close(() => {
      void prisma.$disconnect().then(() => process.exit(0))
    })

    // Don't let a stuck connection hold the deploy open forever.
    setTimeout(() => process.exit(1), 10_000).unref()
  })
}
