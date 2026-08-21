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
      spelling of it, `id` the account's snowflake — the handle is what a person
      can change, the id is what the bot addresses a message to — and `roles`
      the snowflakes they carry in the guild, which is what decides whether a
      signup lands as an officer.

      `roles` is required rather than optional, and that is deliberate: an
      optional field lets a caller conflate "holds no roles" with "was never
      asked", which is the exact distinction the rest of this file is built
      around. It costs nothing to fill — the search already returns it. */
  | { status: 'connected'; username: string; id: string; roles: string[] }
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
 * The role that makes somebody an officer, or null if the club has not handed
 * that decision to Discord.
 *
 * A module constant rather than a read of `env` at the call site, and that is
 * about testability as much as tidiness: `env` is parsed once at import, so
 * stubbing the variable afterwards does nothing, while this is something the
 * suites' `vi.mock(… importOriginal)` can override like any other export.
 */
export const officerRoleId = env.DISCORD_OFFICER_ROLE_ID ?? null

/** Whether the board is read off Discord at all: needs the bot *and* the role. */
export const officerSyncConfigured = bot !== null && officerRoleId !== null

/**
 * The three roles that go the other way — the site decides them and writes
 * them into the guild. Module constants for the same reason `officerRoleId`
 * is one: `env` is parsed at import, so this is what a suite can override.
 *
 * Null each means "never read, never written". There is deliberately no
 * combined switch: a club turning this on wants to do it one role at a time.
 */
export const memberRoleId = env.DISCORD_MEMBER_ROLE_ID ?? null
export const projectLeadRoleId = env.DISCORD_PROJECT_LEAD_ROLE_ID ?? null
export const teamLeadRoleId = env.DISCORD_TEAM_LEAD_ROLE_ID ?? null

/** Work out every change, write none of them, and say so. */
export const roleSyncDryRun = env.DISCORD_ROLE_SYNC_DRY_RUN

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
  /**
   * The role snowflakes this member carries in the guild. Discord has always
   * sent these and nothing here read them until officers started being
   * appointed by role. Optional because this is somebody else's JSON, not
   * because it is ever legitimately absent.
   */
  roles?: string[]
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
 *
 * `reason` becomes `X-Audit-Log-Reason`, which is what an officer reading the
 * guild's audit log sees beside the change. Worth the parameter: a bot that
 * removes somebody's role and gives no reason is a bot the club turns off.
 * Discord caps the header at 512 characters and it must be URI-encoded, since
 * a project title can carry anything a lead typed.
 */
async function call(
  path: string,
  init: RequestInit = {},
  reason?: string,
): Promise<Response | null> {
  if (!bot) return null

  try {
    return await fetch(`${API}${path}`, {
      ...init,
      headers: {
        ...HEADERS,
        Authorization: `Bot ${bot.token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(reason
          ? { 'X-Audit-Log-Reason': encodeURIComponent(reason.slice(0, 400)) }
          : {}),
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
  )

  return match?.user?.username && match.user.id
    ? {
        status: 'connected',
        username: match.user.username.toLowerCase(),
        id: match.user.id,
        roles: match.roles ?? [],
      }
    : { status: 'not_found' }
}

/**
 * Everyone in the guild carrying one role.
 *
 * `ok` with an empty set and `unavailable` are different answers, and the
 * caller must be able to tell them apart: one of them means the board resigned
 * and the other means we could not ask. Acting on the second would stand the
 * club's officers down because Discord had a bad minute.
 *
 * There is no "list members with role X" endpoint, so this is the whole guild,
 * paginated. Any page that comes back wrong aborts the entire walk — half a
 * member list is indistinguishable from a guild where half the board lost its
 * role, and the second of those is a thing this would act on.
 */
export type RoleRoster =
  | {
      status: 'ok'
      /** Snowflakes of everyone carrying the role. */
      ids: Set<string>
      /** Their handles, lowercased, mapped to the same snowflake — so a member
          matched by handle can have `discordId` backfilled from the match. */
      byHandle: Map<string, string>
    }
  /** No bot configured. Nothing was asked, so nothing is known. */
  | { status: 'unchecked' }
  | { status: 'unavailable'; reason: string }

/**
 * Discord's maximum page. Exported so the pagination test can build a full one
 * without restating the number.
 */
export const MEMBER_PAGE_LIMIT = 1_000

/**
 * Ten full pages is ten thousand members. A guild that large is not this
 * club's, so reaching the cap means the cursor is not advancing — and a
 * silently truncated list is exactly the input that would demote people. An
 * outage is the safer answer.
 */
const MAX_PAGES = 10

/**
 * The whole guild, once: who is in it and what each of them carries.
 *
 * `membersWithRole` below used to do this walk and throw away everything but
 * one role. Pushing roles *out* needs every matched member's full set, and
 * both syncs run on the same ten-minute tick, so the walk is done once here
 * and filtered by whoever asked.
 */
export interface GuildRoster {
  /** Snowflake → the role snowflakes they carry. */
  byId: Map<string, string[]>
  /** Lowercased handle → snowflake, so a row with only a handle can be matched
      and have `discordId` backfilled from it. */
  idByHandle: Map<string, string>
}

export type GuildRosterResult =
  | { status: 'ok'; roster: GuildRoster }
  | { status: 'unchecked' }
  | { status: 'unavailable'; reason: string }

export async function guildRoster(): Promise<GuildRosterResult> {
  if (!bot) return { status: 'unchecked' }

  const byId = new Map<string, string[]>()
  const idByHandle = new Map<string, string>()
  let after = '0'

  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({
      limit: String(MEMBER_PAGE_LIMIT),
      after,
    })

    const response = await call(`/guilds/${bot.guildId}/members?${query}`)

    if (!response) return { status: 'unavailable', reason: 'network' }

    if (!response.ok) {
      // 403 is the Server Members Intent switched off — the same one the handle
      // search needs, so this adds no new setup step. 429 is the rate limit.
      // None of them is a statement about who holds the role.
      console.error(
        `discord: member list returned ${response.status} ${response.statusText}`,
      )
      return {
        status: 'unavailable',
        reason: `${response.status} ${response.statusText}`,
      }
    }

    let members: GuildMember[]

    try {
      members = (await response.json()) as GuildMember[]
    } catch (error) {
      console.error('discord: member list returned unparseable JSON', error)
      return { status: 'unavailable', reason: 'unparseable member page' }
    }

    for (const member of members) {
      const id = member.user?.id
      // The cursor is the highest id seen. Discord returns members sorted by id
      // ascending and offers no other end-of-list signal.
      //
      // **Compared as a number, and it has to be.** Snowflakes are 17 to 19
      // digits, so a string comparison ranks a 17-digit id beginning `9` above
      // an 18-digit one beginning `7` — which sends the cursor *backwards*,
      // re-fetches a page already seen, and walks the guild until it runs out
      // of pages and reports itself unavailable. This club's guild is 2,600
      // members and three pages; with the string compare it never finished one
      // walk. `BigInt` rather than `Number` because a snowflake is past
      // `MAX_SAFE_INTEGER` and the loss lands in the low bits, which is the
      // half that distinguishes two accounts made the same second.
      if (id && BigInt(id) > BigInt(after)) after = id
      if (!id) continue
      byId.set(id, member.roles ?? [])
      if (member.user?.username) {
        idByHandle.set(member.user.username.toLowerCase(), id)
      }
    }

    // A short page is the last page.
    if (members.length < MEMBER_PAGE_LIMIT) {
      return { status: 'ok', roster: { byId, idByHandle } }
    }

    // Discord's per-route budget is generous, and a burst of full-guild reads
    // is the shape it throttles.
    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  return { status: 'unavailable', reason: `more than ${MAX_PAGES} pages` }
}

export async function membersWithRole(roleId: string): Promise<RoleRoster> {
  const result = await guildRoster()

  if (result.status !== 'ok') return result

  const ids = new Set<string>()
  const byHandle = new Map<string, string>()

  for (const [id, roles] of result.roster.byId) {
    if (!roles.includes(roleId)) continue
    ids.add(id)
  }

  for (const [handle, id] of result.roster.idByHandle) {
    if (ids.has(id)) byHandle.set(handle, id)
  }

  return { status: 'ok', ids, byHandle }
}

/**
 * One member's roles, without walking the guild.
 *
 * `guildRoster` is three pages and two seconds against a guild this size, which
 * is the right cost once every ten minutes and the wrong one when a single
 * person has just paid their dues — and deleting a project would pay it once
 * per member on the roster. This is the one-call version.
 *
 * `not_found` is its own answer rather than an empty role list: somebody who
 * has left the guild carries no roles and neither does somebody who simply has
 * none, and only one of those is a reason to stop.
 */
export type MemberRoles =
  | { status: 'ok'; roles: string[] }
  | { status: 'not_found' }
  | { status: 'unchecked' }
  | { status: 'unavailable'; reason: string }

export async function guildMemberRoles(userId: string): Promise<MemberRoles> {
  if (!bot) return { status: 'unchecked' }

  const response = await call(`/guilds/${bot.guildId}/members/${userId}`)

  if (!response) return { status: 'unavailable', reason: 'network' }
  if (response.status === 404) return { status: 'not_found' }

  if (!response.ok) {
    return {
      status: 'unavailable',
      reason: `${response.status} ${response.statusText}`,
    }
  }

  try {
    const member = (await response.json()) as GuildMember
    return { status: 'ok', roles: member.roles ?? [] }
  } catch (error) {
    console.error('discord: member returned unparseable JSON', error)
    return { status: 'unavailable', reason: 'unparseable member' }
  }
}

/**
 * Every role in the guild, id → name.
 *
 * One cheap call, and the only thing on this server that can catch a mistyped
 * role snowflake. A wrong id is not an error at Discord's API — it appears in
 * nobody's `roles` array and matches no one, for ever — so a typo, a deleted
 * role and a genuinely empty role are byte-identical everywhere else. The
 * project form checks a pasted id against this before saving it, and the sweep
 * warns about any configured id that is not in here.
 */
export async function guildRoles(): Promise<
  { status: 'ok'; roles: Map<string, string> } | { status: 'unchecked' } | { status: 'unavailable'; reason: string }
> {
  if (!bot) return { status: 'unchecked' }

  const response = await call(`/guilds/${bot.guildId}/roles`)

  if (!response) return { status: 'unavailable', reason: 'network' }

  if (!response.ok) {
    return {
      status: 'unavailable',
      reason: `${response.status} ${response.statusText}`,
    }
  }

  try {
    const roles = (await response.json()) as { id?: string; name?: string }[]
    return {
      status: 'ok',
      roles: new Map(
        roles
          .filter((role): role is { id: string; name: string } =>
            Boolean(role.id),
          )
          .map((role) => [role.id, role.name ?? role.id]),
      ),
    }
  } catch (error) {
    console.error('discord: role list returned unparseable JSON', error)
    return { status: 'unavailable', reason: 'unparseable role list' }
  }
}

/**
 * What became of a role the bot tried to add or take away.
 *
 * `refused` and `unavailable` split the same way `DiscordDelivery` splits them,
 * and here the distinction decides whether anything retries. A member who has
 * left the guild is a 404 and will be one for ever; the bot's role sitting
 * below the target is a 403 and no amount of waiting fixes it. Both are
 * `refused`, and the reconciler will try them again on the next sweep anyway —
 * what `refused` buys is a log line that says which of the two it was, because
 * the second is a configuration problem somebody has to go and correct.
 */
export type RoleWrite =
  | { status: 'done' }
  | { status: 'refused'; reason: string }
  | { status: 'unavailable'; reason: string }
  | { status: 'unchecked' }

/**
 * Discord throttles role writes per guild, and this is the first thing here
 * that makes a burst of them. One retry rather than a loop: the reconciler
 * runs again in ten minutes, so giving up costs nothing but a delay, while a
 * loop turns one bad minute into a stuck sweep.
 */
async function roleWrite(
  method: 'PUT' | 'DELETE',
  userId: string,
  roleId: string,
  reason: string,
  retried = false,
): Promise<RoleWrite> {
  if (!bot) return { status: 'unchecked' }

  const path = `/guilds/${bot.guildId}/members/${userId}/roles/${roleId}`
  const response = await call(path, { method }, reason)

  if (!response) return { status: 'unavailable', reason: 'network' }

  // 204 is the documented success. Discord answers 204 for a role somebody
  // already has and for one they never had, so both directions are idempotent
  // and the sync can be safely wrong about what is held.
  if (response.status === 204) return { status: 'done' }

  if (response.status === 429 && !retried) {
    let wait = 1_000

    try {
      const body = (await response.json()) as { retry_after?: number }
      if (typeof body.retry_after === 'number') {
        wait = Math.min(body.retry_after * 1_000, 5_000)
      }
    } catch {
      // Keep the default. A 429 with a body we cannot read is still a 429.
    }

    await new Promise((resolve) => setTimeout(resolve, wait))
    return roleWrite(method, userId, roleId, reason, true)
  }

  const detail = `${method} role ${roleId}: ${response.status} ${response.statusText}`

  // 404 is a member who is not in the guild — ordinary, and permanent until
  // they rejoin. 403 is the bot's own role sitting at or below the target, or
  // Manage Roles missing, and it needs a person.
  if (response.status === 403) {
    console.error(
      `discord roles: refused ${detail} — check the bot has Manage Roles and its role sits above this one`,
    )
    return { status: 'refused', reason: detail }
  }

  if (response.status === 404) return { status: 'refused', reason: detail }

  return { status: 'unavailable', reason: detail }
}

export function addGuildRole(
  userId: string,
  roleId: string,
  reason: string,
): Promise<RoleWrite> {
  return roleWrite('PUT', userId, roleId, reason)
}

export function removeGuildRole(
  userId: string,
  roleId: string,
  reason: string,
): Promise<RoleWrite> {
  return roleWrite('DELETE', userId, roleId, reason)
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
