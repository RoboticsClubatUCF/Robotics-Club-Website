import { createPublicKey, verify } from 'node:crypto'
import { env } from '../core/env.js'

/**
 * The club's Discord bot, doing one job: confirming that a handle somebody typed
 * into the signup form is a real account in the club's server.
 *
 * It matters more than it looks. Most of what the club plans to build on an
 * account joins on this string, so a handle off by a character is a member who
 * quietly never gets anything, and nobody finds out for months.
 *
 * Two mistakes account for nearly all of them, handled here rather than by asking
 * people to be careful. Typing the display name instead of the username — Discord
 * shows the display name everywhere and the username almost nowhere — so only
 * `user.username` is ever matched and `global_name` is ignored. And not being in
 * the server at all: searching the guild rather than looking the account up
 * globally turns that into "we can't find you", which is what gets somebody to
 * scan the QR code on the same card.
 *
 * REST rather than a gateway connection, so no `discord.js`: a socket that stays
 * open, resumes and reconnects is a lot of machinery for one lookup a few times a
 * day, held open by every API instance.
 */

export type DiscordCheck =
  /** The handle is a member of the club's server. `username` is Discord's own
      spelling, `id` the snowflake the bot addresses a message to, `roles` what
      they carry in the guild — which decides whether a signup lands as an officer.

      `roles` is required rather than optional so a caller can't conflate "holds no
      roles" with "was never asked". It costs nothing; the search already returns it. */
  | { status: 'connected'; username: string; id: string; roles: string[] }
  /** Discord answered, and nobody in the guild has that username. */
  | { status: 'not_found' }
  /** No bot configured. Nothing was asked, so nothing is known. */
  | { status: 'unchecked' }
  /** Discord couldn't be reached, or refused. Different from `not_found`: the
      handle may be perfectly good and it would be wrong to say otherwise. */
  | { status: 'unavailable' }

const bot =
  env.DISCORD_BOT_TOKEN && env.DISCORD_GUILD_ID
    ? { token: env.DISCORD_BOT_TOKEN, guildId: env.DISCORD_GUILD_ID }
    : null

/** Whether a handle will actually be checked. Logged at startup so it is visible. */
export const discordConfigured = bot !== null

/**
 * The role that makes somebody an officer, or null if the club hasn't handed that
 * decision to Discord.
 *
 * A module constant rather than a read of `env` at the call site, for testability:
 * `env` is parsed once at import, so stubbing the variable afterwards does nothing
 * while this is something a suite's `vi.mock` can override.
 */
export const officerRoleId = env.DISCORD_OFFICER_ROLE_ID ?? null

/** Whether the board is read off Discord at all: needs the bot *and* the role. */
export const officerSyncConfigured = bot !== null && officerRoleId !== null

/**
 * The club's Officer Alumni role — who used to run it.
 *
 * Read in the same direction as `officerRoleId` and for the same reason: the club
 * has kept this list in Discord for years, so the site follows rather than asking
 * anybody to maintain it twice. It lands in `User.officerAlumnus`.
 *
 * Never put this in `clubRoles()`. It's read-only, it sits below the bot in the
 * hierarchy so nothing at Discord's end would refuse, and the first sweep that
 * counted it as managed would take it off everybody — the site never asks anyone
 * to carry it.
 */
export const officerAlumniRoleId =
  env.DISCORD_OFFICER_ALUMNI_ROLE_ID ?? null

/** Whether the alumni list is read off Discord: needs the bot *and* the role. */
export const alumniSyncConfigured =
  bot !== null && officerAlumniRoleId !== null

/**
 * The three roles that go the other way — the site decides them and writes them
 * into the guild. Module constants for the reason `officerRoleId` is one.
 *
 * Null each means "never read, never written". Deliberately no combined switch: a
 * club turning this on wants to do it one role at a time.
 */
export const memberRoleId = env.DISCORD_MEMBER_ROLE_ID ?? null
export const projectLeadRoleId = env.DISCORD_PROJECT_LEAD_ROLE_ID ?? null
export const teamLeadRoleId = env.DISCORD_TEAM_LEAD_ROLE_ID ?? null

/**
 * The channel the lab sign lives in — a message the bot keeps up to date and a
 * name it keeps in step with it. A module constant for the reason the four above
 * are.
 */
export const labChannelId = env.DISCORD_LAB_CHANNEL_ID ?? null

/** Whether anything about the lab is pushed at all: needs the bot and the channel.
    Logged at startup, because unpushed looks exactly like pushed from inside. */
export const labChannelConfigured = bot !== null && labChannelId !== null

/**
 * A message id to adopt as the sign, on a row that has never pushed one. Only a
 * seed — see the setting's comment in `env.ts`.
 */
export const labMessageId = env.DISCORD_LAB_MESSAGE_ID ?? null

/**
 * The application's Ed25519 public key, as Discord's own hex.
 *
 * Held as a `KeyObject` rather than the string, so the import happens once at
 * startup and a key this Node build won't take is a line in the log at boot
 * instead of a refusal three weeks later. Null means unset or unusable, and both
 * behave identically: nothing is believed and no buttons are attached.
 *
 * A key of the right shape is not a key that will verify anything. Any 32 bytes
 * import cleanly, so pasting another application's public key gets a working
 * endpoint that silently refuses every delivery. Nothing here can catch it.
 */
export const interactionKey = (() => {
  if (!env.DISCORD_PUBLIC_KEY) return null

  try {
    return createPublicKey({
      format: 'jwk',
      key: {
        kty: 'OKP',
        crv: 'Ed25519',
        // Discord publishes the raw 32 bytes as hex; a JWK wants base64url. Node
        // has no raw Ed25519 import, and an SPKI prefix by hand is the same
        // conversion with a magic byte string in front.
        x: Buffer.from(env.DISCORD_PUBLIC_KEY, 'hex').toString('base64url'),
      },
    })
  } catch (error) {
    console.error(
      'discord: DISCORD_PUBLIC_KEY is 64 hex characters but not a valid Ed25519 key — button presses will be refused',
      error,
    )
    return null
  }
})()

/** Whether a button press can be believed — the key half. Not the same question as
    whether one will ever arrive; see `buttonsLive`. */
export const interactionsConfigured = bot !== null && interactionKey !== null

/**
 * Whether a press would reach this process right now, and by which road.
 *
 * A bot is told about a press in exactly two ways and there is no third, so this is
 * two flags:
 *
 *   - The gateway — a WebSocket held open by `discordGateway.ts`. Needs no public
 *     address and no key; authenticated once at IDENTIFY by the bot token. It's how
 *     the club runs.
 *   - An HTTP interactions endpoint — Discord POSTs to a public HTTPS URL on the
 *     application, signature-checked against `DISCORD_PUBLIC_KEY`. For the day the
 *     API is on a real domain.
 *
 * Both start false and are only turned on by something that has confirmed itself: a
 * button whose press goes nowhere answers "This interaction failed" in front of the
 * whole club, which is worse than a sign with no button.
 */
let gatewayLive = false
let endpointLive = false

/** Set by the gateway as it connects and drops. Not exported as a value, because
    the whole point is that it changes. */
export const setGatewayConnected = (connected: boolean): void => {
  gatewayLive = connected
}

export const gatewayConnected = (): boolean => gatewayLive

/**
 * Whether to put buttons on anything.
 *
 * A function rather than a constant because this one genuinely isn't known at
 * import — it takes a connection or a round trip to find out. `labButtons` is the
 * only caller.
 */
export const buttonsLive = (): boolean =>
  discordConfigured && (gatewayLive || (interactionsConfigured && endpointLive))

export type EndpointCheck =
  /** An endpoint URL is registered and the key checks out. Discord will POST
      presses there, and the gateway must stay shut. */
  | { status: 'live'; url: string }
  /** An endpoint URL is registered and this server couldn't use a delivery to it —
      no `DISCORD_PUBLIC_KEY`, or the wrong one. The worst of the four: presses go
      there and are refused, the gateway is told nothing, and nothing says why. */
  | { status: 'endpoint_unusable'; url: string; reason: string }
  /** No endpoint URL. Nothing is POSTed anywhere, so the gateway is the road. */
  | { status: 'no_endpoint' }
  /** No bot configured at all. */
  | { status: 'unchecked' }
  /** Discord could not be asked. */
  | { status: 'unavailable'; reason: string }

/**
 * Ask Discord, once at startup, whether this application has an HTTP interactions
 * endpoint — which decides which of the two roads is open.
 *
 * An application with an endpoint URL has every interaction POSTed there and its
 * gateway told nothing, so this isn't a preference to configure on our side; it's a
 * fact to read off Discord before deciding whether to hold a socket open.
 *
 * The application object also carries `verify_key`, the same 64 hex characters
 * `DISCORD_PUBLIC_KEY` should hold — so this doubles as the one check that catches
 * another application's public key.
 */
export async function confirmInteractionEndpoint(): Promise<EndpointCheck> {
  if (!bot) return { status: 'unchecked' }

  const response = await call('/oauth2/applications/@me')

  if (!response) return { status: 'unavailable', reason: 'network' }

  if (!response.ok) {
    return {
      status: 'unavailable',
      reason: `read application: ${response.status} ${response.statusText}`,
    }
  }

  try {
    const application = (await response.json()) as {
      verify_key?: string
      interactions_endpoint_url?: string | null
    }

    const url = application.interactions_endpoint_url

    if (!url) return { status: 'no_endpoint' }

    if (!interactionKey) {
      return {
        status: 'endpoint_unusable',
        url,
        reason: 'DISCORD_PUBLIC_KEY is not set, so deliveries to that URL cannot be verified',
      }
    }

    if (
      application.verify_key &&
      env.DISCORD_PUBLIC_KEY &&
      application.verify_key.toLowerCase() !== env.DISCORD_PUBLIC_KEY.toLowerCase()
    ) {
      return {
        status: 'endpoint_unusable',
        url,
        reason:
          "DISCORD_PUBLIC_KEY is not this application's key — copy it from the developer portal, General Information → Public Key",
      }
    }

    endpointLive = true
    return { status: 'live', url }
  } catch {
    return { status: 'unavailable', reason: 'unparseable application response' }
  }
}

/**
 * Answer an interaction that arrived over the gateway.
 *
 * The HTTP route replies in its own response body; a press delivered down the
 * socket has none, so the answer goes back as a REST call against the interaction's
 * id and token. Three seconds, same as the other road.
 *
 * No Authorization header, deliberately: an interaction token is its own credential
 * and sending the bot token alongside it is what makes Discord answer 401.
 */
export async function respondToInteraction(
  interactionId: string,
  token: string,
  response: { type: number; data?: unknown },
): Promise<void> {
  try {
    const sent = await fetch(
      `${API}/interactions/${interactionId}/${token}/callback`,
      {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify(response),
        signal: AbortSignal.timeout(5_000),
      },
    )

    if (!sent.ok) {
      console.error(
        `discord: interaction callback refused: ${sent.status} ${sent.statusText}`,
      )
    }
  } catch (error) {
    console.error('discord: interaction callback failed', error)
  }
}

/** Work out every change, write none of them, and say so. */
export const roleSyncDryRun = env.DISCORD_ROLE_SYNC_DRY_RUN

/**
 * Discord usernames under the current scheme: 2-32 characters of lowercase letters,
 * digits, underscore and full stop. The old `Name#1234` discriminator is gone, and
 * so are capitals — Discord lowercases on the way in, which is why
 * `normaliseHandle` can too.
 */
const HANDLE = /^[a-z0-9._]{2,32}$/

/**
 * What somebody types is not what Discord stores.
 *
 * The `@` comes from the UI showing handles as `@someone`, the capitals from people
 * typing their name the way they think of it. Both are removed rather than
 * rejected: refusing `@PhiBiscool` when `phibiscool` is right would be a validation
 * error about punctuation, and the person has no way to know that's what it meant.
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
   * The role snowflakes this member carries. Optional because this is somebody
   * else's JSON, not because it's ever legitimately absent.
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
 * Somebody else's service on the request path of a form. Five seconds is already
 * longer than anyone will sit still for, and without a deadline a hung connection
 * holds the request open until the proxy gives up.
 *
 * `reason` becomes `X-Audit-Log-Reason`, which is what an officer reading the
 * guild's audit log sees beside the change — a bot that removes somebody's role and
 * gives no reason is a bot the club turns off. Discord caps it at 512 characters
 * and it must be URI-encoded, since a project title can carry anything.
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
 * name, so it narrows the guild down rather than answering. The answer is the exact
 * comparison below.
 */
export async function checkDiscordHandle(
  handle: string,
): Promise<DiscordCheck> {
  if (!bot) return { status: 'unchecked' }

  const query = normaliseHandle(handle)
  if (!isHandleShaped(query)) return { status: 'not_found' }

  const search = new URLSearchParams({
    query,
    // A prefix search on a 32-character exact string can't sensibly return more
    // than a handful, and only an exact match counts anyway.
    limit: '10',
  })

  const response = await call(
    `/guilds/${bot.guildId}/members/search?${search.toString()}`,
  )

  if (!response) return { status: 'unavailable' }

  if (!response.ok) {
    // 401 is a bad token, 403 is the Server Members Intent off or the bot not being
    // in the guild, 429 is the rate limit. None is a statement about the handle, so
    // none may come back as `not_found` — that tells somebody their correct
    // username is wrong.
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
 * `ok` with an empty set and `unavailable` are different answers and the caller must
 * tell them apart: one means the board resigned, the other means we couldn't ask.
 * Acting on the second would stand the club's officers down over a bad minute.
 *
 * There's no "list members with role X" endpoint, so this is the whole guild,
 * paginated. Any page that comes back wrong aborts the walk — half a member list is
 * indistinguishable from half the board losing its role.
 */
export type RoleRoster =
  | {
      status: 'ok'
      /** Snowflakes of everyone carrying the role. */
      ids: Set<string>
      /** Their handles, lowercased, mapped to the same snowflake — so a member
          matched by handle can have `discordId` backfilled. */
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
 * Ten full pages is ten thousand members. A guild that large isn't this club's, so
 * reaching the cap means the cursor isn't advancing — and a silently truncated list
 * is exactly the input that would demote people. An outage is the safer answer.
 */
const MAX_PAGES = 10

/**
 * The whole guild, once: who is in it and what each of them carries.
 *
 * `membersWithRole` used to do this walk and throw away everything but one role.
 * Pushing roles out needs every matched member's full set, and both syncs run on the
 * same ten-minute tick, so the walk happens once here and is filtered by whoever asked.
 */
export interface GuildRoster {
  /** Snowflake → the role snowflakes they carry. */
  byId: Map<string, string[]>
  /** Lowercased handle -> snowflake, so a row with only a handle can be matched and
      have `discordId` backfilled from it. */
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
      // 403 is the Server Members Intent off — the same one the handle search needs,
      // so this adds no setup step. 429 is the rate limit. Neither is a statement
      // about who holds the role.
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
      // The cursor is the highest id seen; Discord sorts members by id ascending and
      // offers no other end-of-list signal.
      //
      // Compared as a number, and it has to be. Snowflakes are 17 to 19 digits, so a
      // string comparison ranks a 17-digit id beginning `9` above an 18-digit one
      // beginning `7` — which sends the cursor backwards, re-fetches a page already
      // seen, and walks until it reports itself unavailable. This guild is 2,600
      // members and three pages; with the string compare it never finished a walk.
      // `BigInt` rather than `Number` because a snowflake is past `MAX_SAFE_INTEGER`
      // and the loss lands in the low bits, which is what distinguishes two accounts
      // made the same second.
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

    // Discord's per-route budget is generous, and a burst of full-guild reads is the
    // shape it throttles.
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
 * `guildRoster` is three pages and two seconds, which is the right cost every ten
 * minutes and the wrong one when a single person has just paid their dues — and
 * deleting a project would pay it once per member. This is the one-call version.
 *
 * `not_found` is its own answer rather than an empty role list: somebody who has
 * left the guild carries no roles and neither does somebody who has none, and only
 * one of those is a reason to stop.
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
 * Every role in the guild, id -> name.
 *
 * One cheap call, and the only thing here that can catch a mistyped role snowflake.
 * A wrong id is not an error at Discord's API — it appears in nobody's `roles` array
 * for ever — so a typo, a deleted role and a genuinely empty role are identical
 * everywhere else. The project form checks a pasted id against this, and the sweep
 * warns about any configured id missing from it.
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
 * `refused` and `unavailable` split the way `DiscordDelivery` splits them, and here
 * the distinction decides whether anything retries. A member who has left is a 404
 * for ever; the bot's role sitting below the target is a 403 no waiting fixes. Both
 * are `refused`, and the reconciler retries either on the next sweep anyway — what
 * `refused` buys is a log line saying which, because the second needs a person.
 */
export type RoleWrite =
  | { status: 'done' }
  | { status: 'refused'; reason: string }
  | { status: 'unavailable'; reason: string }
  | { status: 'unchecked' }

/**
 * Discord throttles role writes per guild, and this is the first thing here that
 * makes a burst of them. One retry rather than a loop: the reconciler runs again in
 * ten minutes, so giving up costs a delay, while a loop turns one bad minute into a
 * stuck sweep.
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

  // 204 is the documented success. Discord answers 204 for a role somebody already
  // has and for one they never had, so both directions are idempotent and the sync
  // can be safely wrong about what is held.
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

  // 404 is a member not in the guild — ordinary, and permanent until they rejoin.
  // 403 is the bot's own role sitting at or below the target, or Manage Roles
  // missing, and it needs a person.
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
 * `refused` and `unavailable` split for the reason `not_found` and `unavailable` do
 * above: one is Discord answering, the other is Discord not answering. A member
 * whose privacy settings decline messages refuses for ever; a 500 or a timeout says
 * nothing. Neither sweep retries either — both claim before they send — but the log
 * has to tell an officer which happened.
 */
export type DiscordDelivery =
  | { status: 'sent' }
  | { status: 'refused'; reason: string }
  | { status: 'unavailable'; reason: string }
  | { status: 'unchecked' }

/**
 * Send somebody a direct message.
 *
 * Two calls, because a bot has no standing channel with anyone: the first opens (or
 * re-opens) the DM channel, the second posts into it. Opening is idempotent, so this
 * is safe for somebody messaged before.
 *
 * It can only work for a member of a guild the bot is in, which is exactly who this
 * is used for. Someone who has switched off DMs from server members is a 403 and
 * stays one; that's their setting, not a fault to work around.
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
    // 403 here is the recipient's privacy settings; 404 is an account that no longer
    // exists. Neither will ever start working.
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

/**
 * Posting into a channel, reading it back, editing what was posted, and renaming the
 * channel — the calls the lab sign is made of. See `src/lab/labStatus.ts`.
 *
 * These write into a channel rather than to a person, and the permissions differ:
 * posting and editing need Send Messages, looking the channel over needs Read
 * Message History, the name needs Manage Channels. Half-granted is the state worth
 * reading in a log, because it puts an OPEN message under a name that still says
 * closed — so each refusal says which permission it was.
 */

/**
 * A row of components under a message — the lab sign's one button.
 *
 * Typed this loosely on purpose. Discord's component tree is a tagged union eleven
 * variants deep and this file uses one shape of it; a faithful type would be forty
 * lines nothing here reads back. `labButtons` is the one place that knows what a lab
 * button is.
 */
export type MessageComponents = readonly Record<string, unknown>[]

/**
 * Which mentions in the body are allowed to be mentions.
 *
 * Always sent, always a closed list. Left off, Discord parses whatever it finds — so
 * a bot posting anything containing `@everyone`, from any source, eventually pings a
 * guild of two and a half thousand. `parse: []` refuses the lot; `roles` re-admits
 * exactly the ones the caller named.
 *
 * Mentioning a role the guild hasn't marked mentionable needs the bot to hold Mention
 * Everyone. Without it the mention still renders — as plain grey text, not a ping —
 * which is worth knowing in advance, because it looks like it worked.
 */
const allowedMentions = (roleIds: string[]) => ({
  parse: [] as string[],
  roles: roleIds,
})

export type ChannelPost =
  /** `messageId` so the next flip can edit this message instead of posting a second
      one. */
  | { status: 'sent'; messageId: string }
  | { status: 'refused'; reason: string }
  | { status: 'unavailable'; reason: string }
  | { status: 'unchecked' }

export async function postChannelMessage(
  channelId: string,
  content: string,
  options: {
    /** Roles this message may ping. Empty by default, the only safe default for a bot
        posting into a channel the whole club can see. */
    mentionRoles?: string[]
    /** Buttons to hang under it. See `MessageComponents`. */
    components?: MessageComponents
  } = {},
): Promise<ChannelPost> {
  if (!bot) return { status: 'unchecked' }

  const response = await call(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      content,
      allowed_mentions: allowedMentions(options.mentionRoles ?? []),
      components: options.components ?? [],
    }),
  })

  if (!response) return { status: 'unavailable', reason: 'network' }

  if (!response.ok) {
    const reason = `post to channel: ${response.status} ${response.statusText}`

    // 403 is Send Messages missing in that channel, 404 a channel id naming nothing
    // the bot can see. Both need a person and neither starts working on its own.
    if (response.status === 403 || response.status === 404) {
      console.error(
        `discord lab: refused ${reason} — check the bot can see channel ${channelId} and has Send Messages in it`,
      )
      return { status: 'refused', reason }
    }

    return { status: 'unavailable', reason }
  }

  try {
    const messageId = ((await response.json()) as { id?: string }).id
    return messageId
      ? { status: 'sent', messageId }
      : { status: 'unavailable', reason: 'post carried no message id' }
  } catch {
    return { status: 'unavailable', reason: 'unparseable post response' }
  }
}

export type ChannelEdit =
  | { status: 'sent' }
  /** The message isn't there any more — deleted, or left in a channel this is no
      longer pointed at. Its own answer rather than a `refused`, because it's the one
      failure with an obvious remedy: post a new one. */
  | { status: 'gone' }
  | { status: 'refused'; reason: string }
  | { status: 'unavailable'; reason: string }
  | { status: 'unchecked' }

/**
 * An edit never notifies anybody. Discord sends no push, no unread badge and no ping
 * for a message that changes, however it changes — which is the property the lab sign
 * is built around, and the reason `mentionRoles` isn't a parameter here. A role
 * mention edited into a message renders as a mention and reaches nobody, so offering
 * the option would only be a way to believe a ping had gone out.
 */
export async function editChannelMessage(
  channelId: string,
  messageId: string,
  content: string,
  options: {
    /** Buttons to hang under it. Sent every time, empty included — an edit that omits
        `components` leaves whatever was there, so a sign that has stopped offering
        buttons would keep the last pair it had. */
    components?: MessageComponents
  } = {},
): Promise<ChannelEdit> {
  if (!bot) return { status: 'unchecked' }

  const response = await call(`/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      content,
      // Suppressed, not omitted. Nothing the sign says is meant to ping — an edit
      // reaches nobody however it reads — so anything that looks like a mention
      // renders as flat text.
      allowed_mentions: allowedMentions([]),
      components: options.components ?? [],
    }),
  })

  if (!response) return { status: 'unavailable', reason: 'network' }
  if (response.ok) return { status: 'sent' }
  if (response.status === 404) return { status: 'gone' }

  const reason = `edit message: ${response.status} ${response.statusText}`

  // 403 on an edit isn't the same 403 as the post above: a bot may only edit its own
  // messages, so this is usually a message id belonging to somebody else rather than
  // a missing permission. Posting a new one is the way out, which is what `gone`
  // means — but say so first, because a stored id pointing at another account's
  // message does this on every attempt.
  if (response.status === 403) {
    console.error(
      `discord lab: refused ${reason} — a bot can only edit its own messages, so ${messageId} is not one of ours`,
    )
    return { status: 'gone' }
  }

  return { status: 'unavailable', reason }
}

export type ChannelRename =
  | { status: 'done' }
  /**
   * Discord said no, come back later — and for a channel name that's minutes, not
   * seconds.
   *
   * Two renames per ten minutes, per channel. The tightest limit anything here
   * touches, and it isn't documented in the response; you learn it from the
   * `retry_after`. Nothing retries inline — five minutes isn't a wait to hold a
   * request open for. The caller records that the push didn't land and the
   * ten-minute sweep tries again, which is the window the limit is measured over.
   */
  | { status: 'throttled'; retryAfterMs: number }
  | { status: 'refused'; reason: string }
  | { status: 'unavailable'; reason: string }
  | { status: 'unchecked' }

export async function renameChannel(
  channelId: string,
  name: string,
  reason: string,
): Promise<ChannelRename> {
  if (!bot) return { status: 'unchecked' }

  const response = await call(
    `/channels/${channelId}`,
    { method: 'PATCH', body: JSON.stringify({ name }) },
    reason,
  )

  if (!response) return { status: 'unavailable', reason: 'network' }
  if (response.ok) return { status: 'done' }

  if (response.status === 429) {
    let retryAfterMs = 60_000

    try {
      const body = (await response.json()) as { retry_after?: number }
      if (typeof body.retry_after === 'number') {
        retryAfterMs = body.retry_after * 1_000
      }
    } catch {
      // A 429 whose body we can't read is still a 429, and the default above is only
      // used for the log line.
    }

    return { status: 'throttled', retryAfterMs }
  }

  const detail = `rename channel: ${response.status} ${response.statusText}`

  // 403 is Manage Channels missing — the common half-setup, since the bot can already
  // post. 404 is an id naming nothing it can see.
  if (response.status === 403 || response.status === 404) {
    console.error(
      `discord lab: refused ${detail} — check the bot has Manage Channels on channel ${channelId}`,
    )
    return { status: 'refused', reason: detail }
  }

  return { status: 'unavailable', reason: detail }
}

/**
 * Who this bot is, as a snowflake.
 *
 * Needed for the question the whole "only one message" rule rests on: is the message
 * already in that channel one of ours? A bot can only edit its own, so a sign put
 * there by a person is a 403 for ever, and posting a second beside it is exactly the
 * channel-full-of-signs this prevents.
 *
 * Cached as the promise rather than the value, so a hundred concurrent pushes make
 * one call — and dropped on failure, because a cached `null` would mean one flap at
 * startup left the sign unable to recognise itself until a restart.
 */
let botUser: Promise<string | null> | null = null

export function botUserId(): Promise<string | null> {
  botUser ??= (async () => {
    const response = await call('/users/@me')

    if (!response?.ok) {
      if (response) {
        console.error(
          `discord: could not read the bot's own account: ${response.status} ${response.statusText}`,
        )
      }
      // Not kept. See above.
      botUser = null
      return null
    }

    try {
      const id = ((await response.json()) as { id?: string }).id ?? null
      if (!id) botUser = null
      return id
    } catch {
      botUser = null
      return null
    }
  })()

  return botUser
}

/** For the suites, which stub the network at the module boundary and would otherwise
    inherit whichever answer the previous file got. */
export function forgetBotUser(): void {
  botUser = null
}

/**
 * One message this bot posted.
 *
 * `content` is what the sign is read back out of — see `reconcileLabStatus`.
 *
 * `hasComponents` is for one gap: a club that fills in `DISCORD_PUBLIC_KEY` and
 * restarts has a sign whose content is already correct, so nothing would push and no
 * buttons would appear until somebody flipped the lab, which reads as the key not
 * working. It arrives in the same response and costs nothing.
 */
export interface BotMessage {
  messageId: string
  content: string
  hasComponents: boolean
}

export type ChannelMessages =
  /** Newest first, and never empty — an empty channel is `none`, because "nothing of
      ours here" and "I couldn't look" is the one difference a caller must not have to
      infer. */
  | { status: 'found'; messages: BotMessage[] }
  | { status: 'none' }
  | { status: 'refused'; reason: string }
  | { status: 'unavailable'; reason: string }
  | { status: 'unchecked' }

/**
 * Every message in a channel that this bot posted, newest first.
 *
 * Two jobs, both about the same invariant — the lab channel holds exactly one sign.
 * Finding the sign, because a stored id going missing is ordinary: a database
 * restored from a dump, a row reset by hand, a message somebody deleted. And finding
 * the strays, because opening the lab posts a new message, so the old one has to go
 * and so does anything left by a failed delete. `tidyChannel` acts on the rest.
 *
 * Messages by anyone else are filtered out: a bot can only edit or delete its own, so
 * for every purpose here they aren't there.
 *
 * Fifty is Discord's own page size. A channel that holds one message never needs a
 * second page, and one that does has a bigger problem than this function.
 */
export async function findBotMessages(
  channelId: string,
): Promise<ChannelMessages> {
  if (!bot) return { status: 'unchecked' }

  const response = await call(`/channels/${channelId}/messages?limit=50`)

  if (!response) return { status: 'unavailable', reason: 'network' }

  if (!response.ok) {
    const reason = `list channel: ${response.status} ${response.statusText}`

    if (response.status === 403 || response.status === 404) {
      console.error(
        `discord lab: refused ${reason} — check the bot has Read Message History in channel ${channelId}`,
      )
      return { status: 'refused', reason }
    }

    return { status: 'unavailable', reason }
  }

  const self = await botUserId()
  // Unknowable rather than empty when `/users/@me` didn't answer. An empty answer
  // reads as "nothing of ours in the channel", which is what gives a caller
  // permission to post.
  if (!self) return { status: 'unavailable', reason: 'bot identity unknown' }

  try {
    const listing = (await response.json()) as {
      id?: string
      content?: string
      author?: { id?: string }
      components?: unknown[]
    }[]

    // Discord answers newest first and that order is kept: if a channel somehow holds
    // two of ours, the sign is the most recent and the rest are strays.
    const messages = listing
      .filter((message) => message.author?.id === self && message.id)
      .map((message) => ({
        messageId: message.id as string,
        content: message.content ?? '',
        hasComponents: (message.components?.length ?? 0) > 0,
      }))

    return messages.length > 0 ? { status: 'found', messages } : { status: 'none' }
  } catch {
    return { status: 'unavailable', reason: 'unparseable channel listing' }
  }
}

export type ChannelDelete =
  | { status: 'done' }
  /** Already not there, which is the outcome this was asking for. Its own answer
      rather than an error, because a delete that races another must not mark the push
      as failed. */
  | { status: 'gone' }
  /** Deleting is rate limited per channel, far more gently than a rename but not
      infinitely. Nothing retries inline; the sweep tidies again. */
  | { status: 'throttled' }
  | { status: 'refused'; reason: string }
  | { status: 'unavailable'; reason: string }
  | { status: 'unchecked' }

/**
 * Remove one message.
 *
 * The half of "post new, delete old" that keeps the channel from filling up, and the
 * only destructive call in this file. Two things bound it, both at the call site in
 * `src/lab/labStatus.ts`: it's only ever aimed at a message `findBotMessages` said
 * this bot posted, and only ever at one in the lab channel.
 *
 * Deleting somebody else's message needs Manage Messages; deleting the bot's own
 * needs nothing beyond seeing the channel. Since only our own are passed in, a 403
 * means the bot has lost sight of the channel rather than a missing permission.
 */
export async function deleteChannelMessage(
  channelId: string,
  messageId: string,
): Promise<ChannelDelete> {
  if (!bot) return { status: 'unchecked' }

  const response = await call(`/channels/${channelId}/messages/${messageId}`, {
    method: 'DELETE',
  })

  if (!response) return { status: 'unavailable', reason: 'network' }
  if (response.ok) return { status: 'done' }
  if (response.status === 404) return { status: 'gone' }
  if (response.status === 429) return { status: 'throttled' }

  const reason = `delete message: ${response.status} ${response.statusText}`

  if (response.status === 403) {
    console.error(`discord lab: refused ${reason} in channel ${channelId}`)
    return { status: 'refused', reason }
  }

  return { status: 'unavailable', reason }
}

export type ChannelName =
  | { status: 'found'; name: string }
  | { status: 'unavailable' }
  | { status: 'unchecked' }

/**
 * Reading the channel's own name back.
 *
 * The name is half the sign — what somebody sees in the sidebar without opening
 * anything — and the half that quietly drifts, because a rename is what Discord
 * throttles hardest. Asked on the sweep so a name left behind by a throttled push is
 * noticed rather than waited on.
 */
export async function readChannelName(channelId: string): Promise<ChannelName> {
  if (!bot) return { status: 'unchecked' }

  const response = await call(`/channels/${channelId}`)
  if (!response?.ok) return { status: 'unavailable' }

  try {
    const name = ((await response.json()) as { name?: string }).name
    return name ? { status: 'found', name } : { status: 'unavailable' }
  } catch {
    return { status: 'unavailable' }
  }
}

/**
 * Whether a delivery to `/api/discord/interactions` really came from Discord.
 *
 * The endpoint is unauthenticated — Discord has no session to present — so this
 * signature is the only thing between the internet and a POST that opens a real
 * room. Same shape as the Stripe webhook next door.
 *
 * Ed25519 over the ASCII concatenation of the timestamp header and the raw body, so
 * the body must reach here as the exact bytes Discord sent: parsing and
 * re-serialising reorders a key or changes an escape and the signature stops matching.
 *
 * A bad signature and a missing key are the same answer on purpose — telling them
 * apart would tell whoever is probing which of the two they'd found.
 */
export function verifyInteraction(
  rawBody: string,
  signature: string | undefined,
  timestamp: string | undefined,
): boolean {
  if (!interactionKey || !signature || !timestamp) return false

  // Discord sends hex. `Buffer.from(…, 'hex')` truncates at the first character it
  // can't read rather than throwing, so a signature that isn't 128 hex characters is
  // refused on its shape instead of being quietly shortened.
  if (!/^[0-9a-fA-F]{128}$/.test(signature)) return false

  try {
    return verify(
      null,
      Buffer.from(timestamp + rawBody, 'utf8'),
      interactionKey,
      Buffer.from(signature, 'hex'),
    )
  } catch (error) {
    console.error('discord: interaction signature check threw', error)
    return false
  }
}

/**
 * A private note to whoever pressed a button, after the fact.
 *
 * Discord gives an interaction three seconds to answer, nowhere near long enough to
 * rename a channel and edit a message behind it. So a press is acknowledged
 * immediately and anything worth saying — a cooldown, a refusal, Discord being
 * unreachable — comes back through here.
 *
 * `flags: 64` is ephemeral: only the presser sees it, and it goes when they dismiss
 * it. That's what makes a warning safe to send in a channel the whole club is in.
 *
 * No Authorization header, deliberately: an interaction token is its own credential
 * and stands for fifteen minutes; sending the bot token alongside makes Discord
 * answer 401.
 */
export async function followUpInteraction(
  applicationId: string,
  token: string,
  content: string,
): Promise<void> {
  try {
    const response = await fetch(`${API}/webhooks/${applicationId}/${token}`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        flags: 64,
        allowed_mentions: allowedMentions([]),
      }),
      signal: AbortSignal.timeout(5_000),
    })

    if (!response.ok) {
      console.error(
        `discord: could not send the follow-up: ${response.status} ${response.statusText}`,
      )
    }
  } catch (error) {
    // Nothing to retry and nobody to tell. Whether the press landed is decided
    // elsewhere; this is only the sentence explaining it.
    console.error('discord: follow-up failed', error)
  }
}
