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
      spelling of it, which is what gets stored. */
  | { status: 'connected'; username: string }
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
  user?: { username?: string }
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

  const url = new URL(
    `https://discord.com/api/v10/guilds/${bot.guildId}/members/search`,
  )
  url.searchParams.set('query', query)
  // A prefix search on a 32-character exact string cannot sensibly return more
  // than a handful, and only an exact match counts anyway.
  url.searchParams.set('limit', '10')

  let response: Response

  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bot ${bot.token}`,
        'User-Agent': 'RCCFWebsite (https://github.com/RoboticsClubatUCF, 13.0)',
      },
      // Somebody else's service, in front of a person waiting on a form. Five
      // seconds is already longer than anyone will sit still for, and without a
      // deadline a hung connection holds the request open until the proxy gives
      // up on it.
      signal: AbortSignal.timeout(5_000),
    })
  } catch (error) {
    console.error('discord: member search failed', error)
    return { status: 'unavailable' }
  }

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
  )

  return match?.user?.username
    ? { status: 'connected', username: match.user.username.toLowerCase() }
    : { status: 'not_found' }
}
