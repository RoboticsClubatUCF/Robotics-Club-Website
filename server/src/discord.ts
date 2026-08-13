import { env } from './env.js'

/**
 * The club's Discord bot, doing one job: confirming that a handle someone typed
 * into the signup form is a real account in the club's server.
 *
 * Why this matters more than it looks: most of what the club plans to build on
 * top of an account — project sign-ups, meeting attendance, the `/teams` bot
 * command — joins on this string. A handle that is off by a character is not a
 * bad field, it is a member who quietly never gets anything, and nobody finds
 * out until someone asks why they were never added.
 *
 * Two mistakes account for nearly all of them, and both are handled here rather
 * than by asking people to be careful:
 *
 * - Typing the *display name* instead of the username. Discord shows the
 *   display name everywhere and the username almost nowhere, so this is the
 *   default mistake, not an unusual one. Only `user.username` is ever matched —
 *   `global_name` is deliberately ignored, and the join page shows a screenshot
 *   of where to find the right one.
 * - Not being in the server at all. Searching the guild rather than looking the
 *   account up globally means "not in the club Discord yet" comes back as "we
 *   can't find you", which is the answer that gets someone to scan the QR code
 *   on the same card.
 *
 * REST rather than a gateway connection, and so no `discord.js`: a websocket
 * that stays open, resumes, and reconnects is a large amount of machinery for
 * one lookup that happens a few times a day, and it would have to be held open
 * by every API instance.
 */

export type DiscordCheck =
  /** The handle is a member of the club's server. `username` is Discord's own
      spelling of it, and `id` the account's snowflake — the handle is what a
      person can change, the id is what the bot addresses a message to. */
  | { status: 'connected'; username: string; id: string }
  /** Discord answered, and nobody in the guild has that username. */
  | { status: 'not_found' }
  /** No bot configured. Nothing was asked, so nothing is known. */
  | { status: 'unchecked' }
  /** Discord could not be reached, or refused. Different from `not_found`:
      the handle may be perfectly good and it would be wrong to say otherwise. */
  | { status: 'unavailable' }

const bot =
  env.DISCORD_BOT_TOKEN && env.DISCORD_GUILD_ID
    ? { token: env.DISCORD_BOT_TOKEN, guildId: env.DISCORD_GUILD_ID }
    : null

/** Whether a handle will actually be checked. Logged at startup so it is visible. */
export const discordConfigured = bot !== null

/**
 * Discord usernames under the current scheme: 2–32 characters of lowercase
 * letters, digits, underscore and full stop. The old `Name#1234` discriminator
 * is gone, and so are capitals — Discord lowercases on the way in, which is why
 * `normaliseHandle` can too without losing anything.
 */
const HANDLE = /^[a-z0-9._]{2,32}$/

/**
 * What someone types is not what Discord stores.
 *
 * The `@` comes from the UI showing handles as `@someone`, and the capitals come
 * from people typing their name the way they think of it. Both are removed
 * rather than rejected: refusing `@PhiBiscool` when `phibiscool` is right would
 * be a validation error about punctuation, and the person on the other end has
 * no way to know that is what it meant.
 */
export function normaliseHandle(input: string): string {
  return input.trim().replace(/^@+/, '').toLowerCase()
}

export function isHandleShaped(handle: string): boolean {
  return HANDLE.test(handle)
}

interface GuildMember {
  user?: { id?: string; username?: string }
}

const API = 'https://discord.com/api/v10'

const HEADERS = {
  'User-Agent': 'RCCFWebsite (https://github.com/RoboticsClubatUCF, 13.0)',
} as const

/**
 * One call to Discord, with the deadline every one of them needs.
 *
 * Somebody else's service, on the request path of a form. Five seconds is
 * already longer than anyone will sit still for, and without a deadline a hung
 * connection holds the request open until the proxy gives up on it.
 */
async function call(
  path: string,
  init: RequestInit = {},
): Promise<Response | null> {
  if (!bot) return null

  try {
    return await fetch(`${API}${path}`, {
      ...init,
      headers: {
        ...HEADERS,
        Authorization: `Bot ${bot.token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(5_000),
    })
  } catch (error) {
    console.error(`discord: ${path} failed`, error)
    return null
  }
}

/**
 * Look a handle up in the club's guild.
 *
 * The search endpoint matches on a prefix and across both username and display
 * name, so it is a way to narrow the guild down — not an answer. The answer is
 * the exact comparison below.
 */
export async function checkDiscordHandle(
  handle: string,
): Promise<DiscordCheck> {
  if (!bot) return { status: 'unchecked' }

  const query = normaliseHandle(handle)
  if (!isHandleShaped(query)) return { status: 'not_found' }

  const search = new URLSearchParams({
    query,
    // A prefix search on a 32-character exact string cannot sensibly return
    // more than a handful, and only an exact match counts anyway.
    limit: '10',
  })

  const response = await call(
    `/guilds/${bot.guildId}/members/search?${search.toString()}`,
  )

  if (!response) return { status: 'unavailable' }

  if (!response.ok) {
    // 401 is a bad token, 403 is the Server Members Intent switched off or the
    // bot not being in the guild, 429 is the rate limit. None of them are a
    // statement about the handle, so none of them may come back as `not_found`
    // — that would tell someone their correct username is wrong.
    console.error(
      `discord: member search returned ${response.status} ${response.statusText}`,
    )
    return { status: 'unavailable' }
  }

  let members: GuildMember[]

  try {
    members = (await response.json()) as GuildMember[]
  } catch (error) {
    console.error('discord: member search returned unparseable JSON', error)
    return { status: 'unavailable' }
  }

  const match = members.find(
    (member) => member.user?.username?.toLowerCase() === query,
  )?.user

  return match?.username && match.id
    ? { status: 'connected', username: match.username.toLowerCase(), id: match.id }
    : { status: 'not_found' }
}

/**
 * What became of a message the bot tried to send.
 *
 * `refused` and `unavailable` are split for the same reason `not_found` and
 * `unavailable` are split above: one is Discord answering, the other is Discord
 * not answering. A member whose privacy settings decline messages from server
 * members refuses for ever and there is nothing to retry; a 500 or a timeout
 * says nothing at all. The caller here does not retry either way — see the note
 * on `TrialNotice` — but the log has to be able to tell an officer which of the
 * two happened.
 */
export type DiscordDelivery =
  | { status: 'sent' }
  | { status: 'refused'; reason: string }
  | { status: 'unavailable'; reason: string }
  | { status: 'unchecked' }

/**
 * Send somebody a direct message.
 *
 * Two calls, because a bot has no standing channel with anyone: the first opens
 * (or re-opens) the DM channel, the second posts into it. Opening one is
 * idempotent — Discord hands back the existing channel — so this is safe to
 * call for someone who has been messaged before.
 *
 * It can only work at all for a member of a guild the bot is in, which is
 * exactly who this is ever used for. A member who has switched off direct
 * messages from server members is a 403 and stays one; that is their setting,
 * not a fault to work around.
 */
export async function sendDirectMessage(
  discordUserId: string,
  content: string,
): Promise<DiscordDelivery> {
  if (!bot) return { status: 'unchecked' }

  const channel = await call('/users/@me/channels', {
    method: 'POST',
    body: JSON.stringify({ recipient_id: discordUserId }),
  })

  if (!channel) return { status: 'unavailable', reason: 'network' }

  if (!channel.ok) {
    const reason = `open DM channel: ${channel.status} ${channel.statusText}`
    // 403 here is the recipient's privacy settings; 404 is an account that no
    // longer exists. Neither will ever start working.
    return channel.status === 403 || channel.status === 404
      ? { status: 'refused', reason }
      : { status: 'unavailable', reason }
  }

  let channelId: string | undefined

  try {
    channelId = ((await channel.json()) as { id?: string }).id
  } catch {
    return { status: 'unavailable', reason: 'unparseable channel response' }
  }

  if (!channelId) {
    return { status: 'unavailable', reason: 'channel response carried no id' }
  }

  const sent = await call(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  })

  if (!sent) return { status: 'unavailable', reason: 'network' }

  if (!sent.ok) {
    const reason = `send message: ${sent.status} ${sent.statusText}`
    return sent.status === 403
      ? { status: 'refused', reason }
      : { status: 'unavailable', reason }
  }

  return { status: 'sent' }
}
