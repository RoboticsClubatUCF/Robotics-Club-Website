import { prisma } from '../core/db.js'
import { checkDiscordHandle } from './discord.js'

/**
 * The Discord account to message, looking it up if it is not on file yet.
 *
 * `discordId` is null for every account made before the signup check started
 * capturing it, and Discord's API takes an id rather than a handle — so without
 * this, those members simply could never be messaged. The handle is enough to
 * find them, and what is found is written back, so the search happens once per
 * person rather than once per sweep.
 *
 * **Call it before claiming anything.** Resolving is a read with no side
 * effect, so a Discord that is briefly unreachable costs nothing: nothing is
 * claimed, and the next sweep tries again. Claiming first would burn somebody's
 * one message on a timeout. Both senders — the trial notice and the equipment
 * return reminder — depend on that order, which is why this lives here rather
 * than inside either of them.
 */
export async function recipientFor(user: {
  id: string
  discordId: string | null
  discordUsername: string | null
}): Promise<string | null> {
  if (user.discordId) return user.discordId
  if (!user.discordUsername) return null

  const check = await checkDiscordHandle(user.discordUsername)

  if (check.status !== 'connected') return null

  // Backfilled on the way past. `discordId` is unique, so a handle that somehow
  // resolves to an account another row already claims must not take this write
  // down with it — the message is the job, not the tidying.
  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { discordId: check.id },
    })
  } catch (error) {
    console.error(`discord: could not store id for ${user.id}`, error)
  }

  return check.id
}
