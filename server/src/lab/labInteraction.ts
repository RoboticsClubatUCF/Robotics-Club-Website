import { prisma } from '../core/db.js'
import { followUpInteraction, officerRoleId } from '../discord/discord.js'
import { UserRole } from '../generated/prisma/enums.js'
import {
  BUILDING_HOURS_SENTENCE,
  LAB_BUTTON,
  buildingOpen,
  cooldownSentence,
  flipLabStatus,
} from './labStatus.js'

/**
 * What a press on the lab sign's button means, independent of how it arrived.
 *
 * There are exactly two ways a bot is told a button was pressed, and this file is the
 * half that's the same for both:
 *
 *   - The gateway — a WebSocket the bot holds open, which delivers the press as an
 *     event. No public address and no signature: the connection is already
 *     authenticated by the bot token. It's how the club actually runs.
 *   - An HTTP interactions endpoint — Discord POSTs the press to a public HTTPS URL on
 *     the application, every delivery signature-checked.
 *
 * They're mutually exclusive by configuration: an application with an interactions
 * endpoint URL has every interaction sent there and its gateway told nothing. So a
 * press can't be handled twice, and neither side needs to know which is running.
 *
 * What's left once that difference is taken out is this file: who pressed it, whether
 * they may, and what to say back.
 */

/** Discord's `InteractionType`. */
export const INTERACTION = {
  PING: 1,
  MESSAGE_COMPONENT: 3,
} as const

/** Discord's `InteractionResponseType`. */
export const RESPONSE = {
  PONG: 1,
  REPLY: 4,
  /** Acknowledge a press and show the presser nothing at all. The sign changing under
      their cursor is the answer. */
  DEFER_UPDATE: 6,
} as const

/** Ephemeral: visible to the presser, gone when they dismiss it. */
const EPHEMERAL = 64

export interface Interaction {
  type?: number
  id?: string
  token?: string
  application_id?: string
  data?: { custom_id?: string }
  /** Present for a press inside a guild, absent for one in a DM. The roles are the
      guild's own answer to "is this an officer", which is why the check below needs no
      call back to Discord. */
  member?: {
    user?: { id?: string; username?: string; global_name?: string }
    roles?: string[]
    nick?: string
  }
}

export interface InteractionResponse {
  type: number
  data?: { content: string; flags: number }
}

/** An ephemeral sentence, sent as the interaction's own response. */
const reply = (content: string): InteractionResponse => ({
  type: RESPONSE.REPLY,
  data: { content, flags: EPHEMERAL },
})

/**
 * Decide what a press means and answer it.
 *
 * Everything it says back is private. Every refusal and warning is ephemeral: only the
 * presser sees it. This is a channel the whole club reads, and "you are not an officer"
 * posted for everybody is a worse thing to have built than an unguarded button.
 *
 * Three seconds, and then Discord stops listening. Renaming a channel and editing a
 * message is two calls behind a five-second deadline each, so nothing that touches
 * Discord may happen before this returns. A press that needs work is acknowledged with
 * `DEFER_UPDATE`, and anything to say afterwards goes back as a private follow-up.
 *
 * Dues are not checked here, on purpose. `PATCH /api/lab` runs `requireOfficer`, which
 * ends in `requireCurrentDues`, so an officer whose dues have lapsed loses the switch on
 * the dashboard. This deliberately doesn't, and it's the one place an officer thing
 * isn't behind dues standing.
 *
 * The reason is what each gate is for. The dashboard's is a nudge, beside a prompt to
 * pay, on a page the officer opened to do club admin. There's no such page here: the
 * officer is standing at a door with a phone, and a private message about a dues date
 * isn't something they can act on. Refusing would leave the lab shut and the members
 * outside.
 */
export async function handleLabInteraction(
  interaction: Interaction,
): Promise<InteractionResponse> {
  // The handshake Discord repeats to check an HTTP endpoint is still alive. Never
  // arrives over the gateway, and harmless to answer either way.
  if (interaction.type === INTERACTION.PING) return { type: RESPONSE.PONG }

  if (interaction.type !== INTERACTION.MESSAGE_COMPONENT) {
    // A slash command, a modal, something added later. Answered rather than errored: an
    // unhandled interaction type isn't a fault, and "This interaction failed" in front of
    // the club isn't what to show for one.
    return reply('That button is not one I know about.')
  }

  const wanted = interaction.data?.custom_id

  if (wanted !== LAB_BUTTON.open && wanted !== LAB_BUTTON.close) {
    return reply('That button is not one I know about.')
  }

  const open = wanted === LAB_BUTTON.open

  // A press in a DM has no guild behind it and so no roles to check. The sign only ever
  // lives in a channel, so this is somebody who has gone looking.
  if (!interaction.member?.user?.id) {
    return reply('The lab can only be opened from the club server.')
  }

  const who = await presser(interaction.member)

  if (!who) {
    return reply(
      "Only officers can open and close the lab. If you're an officer and this is refusing you, your Discord account isn't linked to your account on the site yet — sign in there and check the handle on your profile.",
    )
  }

  // Refused here as well as inside the flip, because this one can be answered without a
  // round trip and so fits inside the three seconds with a sentence rather than a
  // deferral. The button on a current sign is greyed overnight; a stale message still
  // carries a live one.
  if (open && !buildingOpen(new Date())) {
    return reply(BUILDING_HOURS_SENTENCE)
  }

  // Everything past here talks to Discord, so the press is acknowledged first and the
  // work happens behind it.
  runFlip(open, who, interaction)

  return { type: RESPONSE.DEFER_UPDATE }
}

/**
 * The flip itself, deliberately not awaited.
 *
 * The response has to be on its way inside three seconds and this is two calls with a
 * five-second deadline each. Anything worth saying afterwards comes back as a private
 * follow-up, which is what the interaction token is for.
 */
function runFlip(
  open: boolean,
  who: { id: string | null; fullName: string },
  interaction: Interaction,
): void {
  const token = interaction.token
  const applicationId = interaction.application_id

  void flipLabStatus(open, who)
    .then(async (flip) => {
      if (!token || !applicationId) return

      if (flip.status === 'cooldown') {
        await followUpInteraction(
          applicationId,
          token,
          `⏳ ${cooldownSentence(flip.retryAfterMs)}`,
        )
        return
      }

      if (flip.status === 'refused') {
        await followUpInteraction(
          applicationId,
          token,
          "⚠️ Discord wouldn't let me rename this channel, so I've left the lab as it was. An officer with Manage Channels needs to check the bot's permissions here.",
        )
        return
      }

      if (flip.status === 'unchanged') {
        // Two officers pressing the same button a second apart, or a message that hadn't
        // been edited yet. Worth saying, because the sign not moving otherwise looks like
        // the press failing.
        await followUpInteraction(
          applicationId,
          token,
          `The lab was already ${open ? 'open' : 'closed'}, so nothing changed.`,
        )
      }
    })
    .catch((error: unknown) => {
      console.error('discord interactions: the flip failed', error)

      if (token && applicationId) {
        void followUpInteraction(
          applicationId,
          token,
          "⚠️ Something went wrong on the site's end, so the lab has been left as it was.",
        )
      }
    })
}

/**
 * Who pressed it, if they're allowed to — and null for everybody else, which is what the
 * private refusal above is written from.
 *
 * Two answers to "is this an officer", asked in the order the club has set up:
 *
 *   - `DISCORD_OFFICER_ROLE_ID`, from the roles on the press itself. Free, since Discord
 *     sends the member's roles with the interaction, and already the club's own answer.
 *   - The site's own `role` column, for a club that hasn't handed that decision to
 *     Discord. Needs the account linked by `discordId`.
 *
 * Either way the account is looked up, because the row records who flipped it and a name
 * is what the sign says. An officer by role with no account here still gets to press —
 * the lab is the club's, not the website's — and the flip is recorded with nobody
 * attached.
 */
async function presser(
  member: NonNullable<Interaction['member']>,
): Promise<{ id: string | null; fullName: string } | null> {
  const discordId = member.user?.id
  if (!discordId) return null

  const account = await prisma.user.findUnique({
    where: { discordId },
    select: { id: true, fullName: true, role: true },
  })

  const byRole =
    officerRoleId !== null && member.roles?.includes(officerRoleId) === true

  const bySite =
    account?.role === UserRole.OFFICER || account?.role === UserRole.ADMIN

  if (!byRole && !bySite) return null

  if (account) return { id: account.id, fullName: account.fullName }

  // No account on the site, so nothing to attribute the flip to. The name is still
  // carried for the audit-log reason on the channel rename, which is the one place it
  // shows up.
  return {
    id: null,
    fullName:
      member.nick ?? member.user?.global_name ?? member.user?.username ?? 'an officer',
  }
}
