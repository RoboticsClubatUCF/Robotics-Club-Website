import { discordConfigured, postChannelMessage, sendDirectMessage } from './discord.js'
import { recipientFor } from './discordRecipient.js'
import { env } from '../core/env.js'
import { PrintRequestStatus } from '../generated/prisma/enums.js'

/**
 * The bot's two print messages: new prints go to the officers' print channel, and an
 * officer moving a print tells the member who sent it.
 *
 * Both are courtesies on top of the queue page, so callers fire and forget:
 *
 *     void notifyPrintChannel(...).catch((err) => console.error(...))
 */

export async function notifyPrintChannel(content: string): Promise<void> {
  if (!discordConfigured) {
    console.log(`print channel (bot unconfigured): ${content}`)
    return
  }

  const post = await postChannelMessage(env.DISCORD_PRINT_CHANNEL_ID, content)
  if (post.status !== 'sent') {
    console.warn(`print channel ${env.DISCORD_PRINT_CHANNEL_ID}: ${post.status}`)
  }
}

type Owner = { id: string; fullName: string; discordId: string | null; discordUsername: string | null }

/**
 * DM the member whose print an officer just moved. PENDING is never sent: a print only
 * goes back to the queue by an officer's correction, which isn't news to the member.
 */
export async function notifyPrintOwner(
  owner: Owner,
  print: {
    fileName: string
    status: PrintRequestStatus
    /** Set once it has been on a printer, which turns a decline into a cancellation. */
    startedAt: Date | null
    officerNote: string | null
  },
): Promise<void> {
  const line = statusLine(print.fileName, print.status, print.startedAt !== null)
  if (!line) return

  const firstName = owner.fullName.trim().split(/\s+/)[0] ?? 'there'
  const content = [
    `Hi ${firstName} — ${line}`,
    ...(print.officerNote ? [`Officer note: ${print.officerNote}`] : []),
    `${env.SITE_URL}/dashboard/print`,
  ].join('\n')

  if (!discordConfigured) {
    console.log(`print owner notify (bot unconfigured): ${content}`)
    return
  }

  const recipient = await recipientFor(owner)
  if (!recipient) return

  const delivery = await sendDirectMessage(recipient, content)
  if (delivery.status !== 'sent') {
    console.warn(`print owner notify to ${recipient}: ${delivery.status}`)
  }
}

function statusLine(file: string, status: PrintRequestStatus, started: boolean): string | null {
  switch (status) {
    case PrintRequestStatus.PRINTING:
      return `your 3D print ${file} is on the printer.`
    case PrintRequestStatus.DONE:
      return `your 3D print ${file} is done. Pick it up at the lab.`
    case PrintRequestStatus.REJECTED:
      return started
        ? `your 3D print ${file} was cancelled.`
        : `your 3D print request ${file} was declined.`
    default:
      return null
  }
}
