import { prisma } from '../core/db.js'
import { discordConfigured, sendDirectMessage } from './discord.js'
import { env } from '../core/env.js'
import { UserRole } from '../generated/prisma/enums.js'

/**
 * Tell the officers something happened — a new print request, a loan to
 * approve.
 *
 * Who gets the DM: `OFFICER_ALERT_DISCORD_IDS` if the club set it, otherwise
 * every ADMIN/OFFICER account with a confirmed `discordId`, capped so a
 * mis-seeded database cannot make the bot spam fifty people. With the bot
 * unconfigured this logs and returns — the queue page is the record; the DM
 * is a courtesy on top, exactly like the contact form's email.
 *
 * Callers must not await this on the request path. The pattern is the same
 * one the contact form uses for Postmark:
 *
 *     void notifyOfficers(...).catch((err) => console.error(...))
 *
 * A member's upload succeeding must never depend on Discord being up.
 */
const MAX_RECIPIENTS = 5

export async function notifyOfficers(content: string): Promise<void> {
  if (!discordConfigured) {
    console.log(`officer notify (bot unconfigured): ${content}`)
    return
  }

  let recipients = env.OFFICER_ALERT_DISCORD_IDS

  if (recipients.length === 0) {
    const officers = await prisma.user.findMany({
      where: {
        role: { in: [UserRole.ADMIN, UserRole.OFFICER] },
        discordId: { not: null },
        active: true,
      },
      select: { discordId: true },
      take: MAX_RECIPIENTS,
    })
    recipients = officers.map((o) => o.discordId).filter((id): id is string => id !== null)
  }

  if (recipients.length === 0) {
    console.log(`officer notify (nobody reachable on Discord): ${content}`)
    return
  }

  for (const id of recipients.slice(0, MAX_RECIPIENTS)) {
    const delivery = await sendDirectMessage(id, content)
    if (delivery.status !== 'sent') {
      // One line per failure, never a throw: a refused DM is that officer's
      // privacy settings, not a problem the request should hear about.
      console.warn(`officer notify to ${id}: ${delivery.status}`)
    }
  }
}
