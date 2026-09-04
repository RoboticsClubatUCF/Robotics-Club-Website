import { generateKeyPairSync, sign } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isHandleShaped, normaliseHandle } from './discord.js'

/**
 * The Discord client, with `fetch` stubbed.
 *
 * `signup.test.ts` stubs this module out entirely, so this is where the thing it stubs is
 * actually checked. Both halves matter: matching the username rather than the display name is
 * the entire reason this file exists, and a failure to reach Discord must never come back
 * looking like a verdict on the handle.
 *
 * `checkDiscordHandle` is imported inside each test, after the environment is set: the module
 * reads its token once at import time, which is what makes the unconfigured case a real state
 * rather than a flag.
 */

const RESULTS = {
  /** A member whose display name is nothing like their username — the case the instructions
      image on the join page is about. */
  phibi: [
    {
      user: {
        id: '246813579246813579',
        username: 'phibiscool',
        global_name: 'PhiBi',
      },
      roles: ['111111111111111111'],
    },
  ],
  none: [],
}

/** The role that makes somebody an officer, for the roster tests below. */
const OFFICER_ROLE = '267371948953042945'

const guildMember = (n: number, roles: string[] = []) => ({
  user: { id: `9${String(n).padStart(17, '0')}`, username: `member_${n}` },
  roles,
})

// Parameters are declared even though the stub ignores them, so `mock.calls` types as a real
// pair and the assertions on the URL need no cast.
function stubDiscord(body: unknown, status = 200) {
  const stub = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )

  vi.stubGlobal('fetch', stub)
  return stub
}

/**
 * Import fresh, so the module picks up whatever the environment now says. The token is read
 * once at import time — that's what makes "no bot configured" a state of the module rather
 * than a flag it checks per call.
 *
 * `undefined` rather than an empty string: `env.ts` requires a non-empty value when the key is
 * present at all. Unsetting is what "no bot" actually looks like.
 */
/**
 * `configured: false` means nothing Discord is set, not just the token.
 *
 * The role ids have to come off with it. `env.ts` refuses to parse a role id with no bot behind
 * it, so leaving one in place while clearing the token exits the process rather than producing
 * the unconfigured client this wants. It only bit here because a developer with the role sync
 * switched on in their own `.env` runs a different test than one without.
 */
const ROLE_KEYS = [
  'DISCORD_OFFICER_ROLE_ID',
  'DISCORD_OFFICER_ALUMNI_ROLE_ID',
  'DISCORD_MEMBER_ROLE_ID',
  'DISCORD_PROJECT_LEAD_ROLE_ID',
  'DISCORD_TEAM_LEAD_ROLE_ID',
  // Not a role, and cleared for the same two reasons: `env.ts` refuses it without a bot behind
  // it, and the club's own channel id in a developer's `.env` would otherwise decide what
  // `labChannelConfigured` says here. Every id under the bot belongs on this list — adding one
  // to `env.ts` and not to this is a suite that exits the process instead of failing.
  'DISCORD_LAB_CHANNEL_ID',
  'DISCORD_LAB_MESSAGE_ID',
  // Not a snowflake either — the application public key — and on this list for the same reason:
  // `env.ts` refuses it without a bot, and a developer's real one left in place would decide
  // what `interactionsConfigured` says here.
  'DISCORD_PUBLIC_KEY',
] as const

async function load(configured = true) {
  vi.resetModules()
  vi.stubEnv('DISCORD_BOT_TOKEN', configured ? 'test-bot-token' : undefined)
  vi.stubEnv('DISCORD_GUILD_ID', configured ? '123456789012345678' : undefined)

  // Every role id is cleared, both ways round, and the suite is hermetic because of it. A
  // cleared bot with a role id left in place exits the process, which is `env.ts`'s refine
  // doing its job. And a set role id in a developer's own `.env` leaks the other way — the
  // module constants are read at import, so `officerRoleId` would be the club's real snowflake
  // for anybody who has switched the sync on locally and null for everybody else.
  for (const key of ROLE_KEYS) vi.stubEnv(key, undefined)

  return import('./discord.js')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('normaliseHandle', () => {
  /**
   * Both of these are what people actually type — the `@` because that's how Discord displays a
   * handle, the capitals because that's how they think of their own name. Neither is an error
   * worth showing anyone.
   */
  it.each([
    ['@phibiscool', 'phibiscool'],
    ['  PhiBiscool ', 'phibiscool'],
    ['@@phibiscool', 'phibiscool'],
  ])('turns %s into what Discord stores', (input, expected) => {
    expect(normaliseHandle(input)).toBe(expected)
  })
})

describe('isHandleShaped', () => {
  it.each(['phibiscool', 'a_b.c', 'ab'])('accepts %s', (handle) => {
    expect(isHandleShaped(handle)).toBe(true)
  })

  /** A display name fails all of these, which is the point. */
  it.each(['phi bi', 'phibi!', 'p', 'x'.repeat(33)])('rejects %s', (handle) => {
    expect(isHandleShaped(handle)).toBe(false)
  })
})

describe('checkDiscordHandle', () => {
  it('connects a handle that is in the guild', async () => {
    const fetchStub = stubDiscord(RESULTS.phibi)
    const { checkDiscordHandle } = await load()

    // The snowflake comes back beside the handle: it's what survives somebody renaming
    // themselves, and what the bot addresses a direct message to.
    expect(await checkDiscordHandle('phibiscool')).toEqual({
      status: 'connected',
      username: 'phibiscool',
      id: '246813579246813579',
      roles: ['111111111111111111'],
    })

    const [url, init] = fetchStub.mock.calls[0]!
    expect(String(url)).toContain('/guilds/123456789012345678/members/search')
    expect(new URL(String(url)).searchParams.get('query')).toBe('phibiscool')

    const headers = init?.headers as Record<string, string> | undefined
    expect(headers?.Authorization).toBe('Bot test-bot-token')
  })

  /**
   * The one that matters. Discord's search matches display names too, so it will happily hand
   * back PhiBi's row for a query of "phibi" — and taking that as a match is exactly the mistake
   * the whole check exists to prevent.
   */
  it('refuses to match a display name', async () => {
    stubDiscord(RESULTS.phibi)
    const { checkDiscordHandle } = await load()

    expect(await checkDiscordHandle('phibi')).toEqual({ status: 'not_found' })
  })

  it('reports a handle nobody in the guild holds', async () => {
    stubDiscord(RESULTS.none)
    const { checkDiscordHandle } = await load()

    expect(await checkDiscordHandle('nobody_here')).toEqual({
      status: 'not_found',
    })
  })

  /**
   * 403 is the Server Members Intent switched off, 401 a bad token, 429 the rate limit. None is
   * a statement about the handle, so none may come back as `not_found` — that would tell
   * somebody their correct username is wrong, and they have no way to argue.
   */
  it.each([401, 403, 429, 500])(
    'treats a %i from Discord as unavailable, not as an answer',
    async (status) => {
      stubDiscord({ message: 'nope' }, status)
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { checkDiscordHandle } = await load()

      expect(await checkDiscordHandle('phibiscool')).toEqual({
        status: 'unavailable',
      })

      consoleError.mockRestore()
    },
  )

  it('treats an unreachable Discord as unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { checkDiscordHandle } = await load()

    expect(await checkDiscordHandle('phibiscool')).toEqual({
      status: 'unavailable',
    })

    consoleError.mockRestore()
  })

  /** No bot: nothing is asked, and nothing is claimed either way. */
  it('asks nobody when there is no bot configured', async () => {
    const fetchStub = stubDiscord(RESULTS.phibi)
    const { checkDiscordHandle, discordConfigured } = await load(false)

    expect(discordConfigured).toBe(false)
    expect(await checkDiscordHandle('phibiscool')).toEqual({
      status: 'unchecked',
    })
    expect(fetchStub).not.toHaveBeenCalled()
  })
})

/**
 * The guild roster the officer sync runs on.
 *
 * Every test here is the same assertion from a different angle: an `ok` with nothing in it and
 * an `unavailable` are different answers. One means the board resigned and the other means
 * Discord couldn't be reached, and the caller stands the whole club's officers down if it
 * confuses them.
 */
describe('membersWithRole', () => {
  /** Answers each call from a queue, so pagination can be driven page by page. */
  function stubPages(...pages: { body: unknown; status?: number }[]) {
    const stub = vi.fn((_input: string | URL | Request, _init?: RequestInit) => {
      const page = pages.shift() ?? { body: [], status: 200 }
      return Promise.resolve(
        new Response(JSON.stringify(page.body), {
          status: page.status ?? 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    vi.stubGlobal('fetch', stub)
    return stub
  }

  it('returns only the members carrying the role, handles lowercased', async () => {
    stubPages({
      body: [
        guildMember(1, [OFFICER_ROLE]),
        guildMember(2, ['999999999999999999']),
        guildMember(3, [OFFICER_ROLE, '999999999999999999']),
      ],
    })
    const { membersWithRole } = await load()

    const roster = await membersWithRole(OFFICER_ROLE)

    expect(roster.status).toBe('ok')
    if (roster.status !== 'ok') return

    expect([...roster.ids].sort()).toEqual([
      '900000000000000001',
      '900000000000000003',
    ])
    expect(roster.byHandle.get('member_1')).toBe('900000000000000001')
    expect(roster.byHandle.has('member_2')).toBe(false)
  })

  /**
   * A guild with nobody on the board is a real answer and must come back as one. It's the caller
   * that refuses to act on it, and it can only do that if this reports it honestly rather than
   * as a failure.
   */
  it('reports an empty roster as ok, not as a failure', async () => {
    stubPages({ body: [guildMember(1, []), guildMember(2, [])] })
    const { membersWithRole } = await load()

    const roster = await membersWithRole(OFFICER_ROLE)

    expect(roster.status).toBe('ok')
    if (roster.status !== 'ok') return
    expect(roster.ids.size).toBe(0)
  })

  /**
   * A full page means there may be more, and the cursor is the highest id seen — Discord sorts
   * by id ascending and offers no other end-of-list signal.
   */
  it('pages until a short page, walking the cursor forward', async () => {
    const { MEMBER_PAGE_LIMIT } = await import('./discord.js')
    const full = Array.from({ length: MEMBER_PAGE_LIMIT }, (_, i) =>
      guildMember(i + 1, i === 0 ? [OFFICER_ROLE] : []),
    )

    const fetchStub = stubPages(
      { body: full },
      { body: [guildMember(9001, [OFFICER_ROLE])] },
    )
    const { membersWithRole } = await load()

    const roster = await membersWithRole(OFFICER_ROLE)

    expect(roster.status).toBe('ok')
    if (roster.status !== 'ok') return
    expect(roster.ids.has('900000000000000001')).toBe(true)
    expect(roster.ids.has('900000000000009001')).toBe(true)

    expect(fetchStub).toHaveBeenCalledTimes(2)
    const first = new URL(String(fetchStub.mock.calls[0]![0]))
    const second = new URL(String(fetchStub.mock.calls[1]![0]))
    expect(first.searchParams.get('after')).toBe('0')
    // The last id of the first page, not a page number.
    expect(second.searchParams.get('after')).toBe(
      `9${String(MEMBER_PAGE_LIMIT).padStart(17, '0')}`,
    )
  })

  /**
   * The cursor is a number, and every fixture above hides it.
   *
   * Snowflakes run 17 to 19 digits, and `guildMember` mints them all the same length starting
   * with the same digit — so string order and numeric order agree and a string comparison
   * passes. On the club's real guild they don't: a 2015 account's 17-digit id beginning `9`
   * sorts above a 2016 account's 18-digit id beginning `7`, the cursor goes backwards, and the
   * walk burns all ten pages and reports itself unavailable. Because `unavailable` means "write
   * nothing", the symptom was a sync that silently did nothing for ever.
   */
  it('advances the cursor by number, not by string order', async () => {
    const mixed = [
      // Deliberately the shape that breaks it: the lexicographically largest id here is the
      // numerically smallest.
      { user: { id: '99688747573981184', username: 'old_account' }, roles: [] },
      { user: { id: '744253302585294968', username: 'newer' }, roles: [] },
      { user: { id: '1242121555605979206', username: 'newest' }, roles: [] },
    ]
    const { MEMBER_PAGE_LIMIT } = await import('./discord.js')
    const full = [
      ...mixed,
      ...Array.from({ length: MEMBER_PAGE_LIMIT - mixed.length }, (_, i) =>
        guildMember(i + 1),
      ),
    ]

    const fetchStub = stubPages({ body: full }, { body: [] })
    const { guildRoster } = await load()

    await guildRoster()

    const second = new URL(String(fetchStub.mock.calls[1]![0]))
    // The largest by value. `900000000000000997` from the filler is bigger than the mixed three,
    // and both orderings agree on it — so the assertion that carries the weight is below.
    expect(BigInt(second.searchParams.get('after')!)).toBe(
      full.reduce(
        (highest, member) =>
          BigInt(member.user.id) > highest ? BigInt(member.user.id) : highest,
        0n,
      ),
    )
    // And the id that would have won a string comparison is not it.
    expect(second.searchParams.get('after')).not.toBe('99688747573981184')
  })

  /**
   * The failure that matters most. Half a member list is indistinguishable from a guild in which
   * half the board lost its role, and the caller would act on the second — so one bad page
   * abandons the entire walk rather than returning what it managed to read.
   */
  it('abandons the whole walk when a later page fails', async () => {
    const { MEMBER_PAGE_LIMIT } = await import('./discord.js')
    const full = Array.from({ length: MEMBER_PAGE_LIMIT }, (_, i) =>
      guildMember(i + 1, [OFFICER_ROLE]),
    )

    stubPages({ body: full }, { body: { message: 'nope' }, status: 500 })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { membersWithRole } = await load()

    expect((await membersWithRole(OFFICER_ROLE)).status).toBe('unavailable')

    consoleError.mockRestore()
  })

  it.each([401, 403, 429, 500])(
    'treats a %i as unavailable rather than an empty board',
    async (status) => {
      stubPages({ body: { message: 'nope' }, status })
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { membersWithRole } = await load()

      expect((await membersWithRole(OFFICER_ROLE)).status).toBe('unavailable')

      consoleError.mockRestore()
    },
  )

  it('treats unparseable JSON as unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('not json', { status: 200 }))),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { membersWithRole } = await load()

    expect((await membersWithRole(OFFICER_ROLE)).status).toBe('unavailable')

    consoleError.mockRestore()
  })

  it('asks nobody when there is no bot configured', async () => {
    const fetchStub = stubPages({ body: [] })
    const { membersWithRole } = await load(false)

    expect((await membersWithRole(OFFICER_ROLE)).status).toBe('unchecked')
    expect(fetchStub).not.toHaveBeenCalled()
  })

  /**
   * Off is the default, and the whole safety story of this feature rests on it: until somebody
   * sets a role id, nothing can stand anybody down.
   */
  it('is off until a role id is configured', async () => {
    const { officerRoleId, officerSyncConfigured } = await load()

    expect(officerRoleId).toBeNull()
    expect(officerSyncConfigured).toBe(false)
  })
})

/**
 * Writing a role, the first thing this client has ever done to the guild rather than to a DM
 * channel. What matters is the split between a refusal that will never work and an outage that
 * might clear: the reconciler retries either way, and the log tells an officer which they're
 * looking at.
 */
describe('adding and removing a role', () => {
  const USER = '246813579246813579'
  const ROLE = '267373066290593794'

  const stubStatus = (status: number, body: unknown = null) => {
    const stub = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        body === null
          ? new Response(null, { status })
          : new Response(JSON.stringify(body), {
              status,
              headers: { 'Content-Type': 'application/json' },
            }),
      ),
    )

    vi.stubGlobal('fetch', stub)
    return stub
  }

  it('PUTs to the member-role path and reports 204 as done', async () => {
    const stub = stubStatus(204)
    const { addGuildRole } = await load()

    expect(await addGuildRole(USER, ROLE, 'dues paid')).toEqual({
      status: 'done',
    })

    const [url, init] = stub.mock.calls[0]
    expect(url.toString()).toBe(
      `https://discord.com/api/v10/guilds/123456789012345678/members/${USER}/roles/${ROLE}`,
    )
    expect(init?.method).toBe('PUT')
  })

  it('DELETEs the same path to take one away', async () => {
    const stub = stubStatus(204)
    const { removeGuildRole } = await load()

    expect(await removeGuildRole(USER, ROLE, 'dues expired')).toEqual({
      status: 'done',
    })
    expect(stub.mock.calls[0][1]?.method).toBe('DELETE')
  })

  /**
   * The reason reaches the guild's audit log, which is the difference between a bot people trust
   * and one they switch off. Encoded because a project title is whatever a lead typed and the
   * header isn't 8-bit clean.
   */
  it('sends the reason as an encoded audit-log header', async () => {
    const stub = stubStatus(204)
    const { addGuildRole } = await load()

    await addGuildRole(USER, ROLE, 'joined Project S.T.O.R.M. — spring')

    const headers = stub.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers['X-Audit-Log-Reason']).toBe(
      encodeURIComponent('joined Project S.T.O.R.M. — spring'),
    )
  })

  /**
   * The bot's own role sitting at or below the target. No amount of retrying fixes it and
   * somebody has to go and move a role, so it's `refused` and logged loudly.
   */
  it('treats 403 as refused rather than as an outage', async () => {
    stubStatus(403)
    const { addGuildRole } = await load()

    expect((await addGuildRole(USER, ROLE, 'why')).status).toBe('refused')
  })

  /** Somebody who has left the guild. Ordinary, and permanent until they return. */
  it('treats 404 as refused', async () => {
    stubStatus(404)
    const { removeGuildRole } = await load()

    expect((await removeGuildRole(USER, ROLE, 'why')).status).toBe('refused')
  })

  it('treats a 500 as unavailable, because that one may clear', async () => {
    stubStatus(500)
    const { addGuildRole } = await load()

    expect((await addGuildRole(USER, ROLE, 'why')).status).toBe('unavailable')
  })

  it('waits out one 429 and then succeeds', async () => {
    let call = 0
    const stub = vi.fn((_input: string | URL | Request, _init?: RequestInit) => {
      call += 1
      return Promise.resolve(
        call === 1
          ? new Response(JSON.stringify({ retry_after: 0.01 }), {
              status: 429,
              headers: { 'Content-Type': 'application/json' },
            })
          : new Response(null, { status: 204 }),
      )
    })
    vi.stubGlobal('fetch', stub)

    const { addGuildRole } = await load()

    expect(await addGuildRole(USER, ROLE, 'why')).toEqual({ status: 'done' })
    expect(stub).toHaveBeenCalledTimes(2)
  })

  /**
   * One retry, not a loop. Giving up costs a ten-minute delay; a loop costs a
   * sweep that never finishes.
   */
  it('gives up after a second 429', async () => {
    const stub = stubStatus(429, { retry_after: 0.01 })
    const { addGuildRole } = await load()

    expect((await addGuildRole(USER, ROLE, 'why')).status).toBe('unavailable')
    expect(stub).toHaveBeenCalledTimes(2)
  })

  it('writes nothing when there is no bot configured', async () => {
    const stub = stubStatus(204)
    const { addGuildRole } = await load(false)

    expect((await addGuildRole(USER, ROLE, 'why')).status).toBe('unchecked')
    expect(stub).not.toHaveBeenCalled()
  })
})

/**
 * The whole guild in one walk, which both syncs now share. `membersWithRole` is a filter over
 * this, so the pagination rules are tested there and only the shape is tested here.
 */
describe('guildRoster', () => {
  it('carries every member and their full role set', async () => {
    const stub = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            guildMember(1, [OFFICER_ROLE, '999999999999999999']),
            guildMember(2, []),
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )
    vi.stubGlobal('fetch', stub)
    const { guildRoster } = await load()

    const result = await guildRoster()

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return

    expect(result.roster.byId.get('900000000000000001')).toEqual([
      OFFICER_ROLE,
      '999999999999999999',
    ])
    // Present with no roles, which is a different answer from absent.
    expect(result.roster.byId.get('900000000000000002')).toEqual([])
    expect(result.roster.idByHandle.get('member_1')).toBe('900000000000000001')
  })
})

describe('guildRoles', () => {
  it('answers with id to name, which is what catches a mistyped snowflake', async () => {
    stubDiscord([
      { id: '267373066290593794', name: 'Members' },
      { id: '267371948953042945', name: 'Officers' },
    ])
    const { guildRoles } = await load()

    const result = await guildRoles()

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return

    expect(result.roles.get('267373066290593794')).toBe('Members')
    expect(result.roles.has('000000000000000000')).toBe(false)
  })

  it('is unavailable rather than empty when Discord refuses', async () => {
    stubDiscord({ message: 'Missing Access' }, 403)
    const { guildRoles } = await load()

    // Empty and unreadable must not be the same answer: an empty map would make every configured
    // role look like a typo.
    expect((await guildRoles()).status).toBe('unavailable')
  })
})

/**
 * The signature on a button press, against a real Ed25519 keypair.
 *
 * The one thing in this file worth generating a key for. `/api/discord/interactions` is
 * unauthenticated and a press opens a real room, so this check is the whole of its security —
 * and it's verified against a key Discord publishes as raw hex, which Node can't import
 * directly. The conversion into a JWK is the part that can be wrong in a way that still parses.
 *
 * `discordInteractions.test.ts` mocks this function outright: that suite is about what happens
 * once a delivery is believed; this is the only place that decides whether one should be.
 */
describe('verifyInteraction', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')

  /** Discord publishes the raw 32 bytes as hex. The 12-byte SPKI header is what
      `createPublicKey` wraps them in, and what has to come back off. */
  const publicHex = publicKey
    .export({ format: 'der', type: 'spki' })
    .subarray(12)
    .toString('hex')

  const signed = (body: string, timestamp: string) =>
    sign(null, Buffer.from(timestamp + body, 'utf8'), privateKey).toString('hex')

  async function loadWithKey(key: string | undefined) {
    vi.resetModules()
    vi.stubEnv('DISCORD_BOT_TOKEN', 'test-bot-token')
    vi.stubEnv('DISCORD_GUILD_ID', '123456789012345678')
    for (const roleKey of ROLE_KEYS) vi.stubEnv(roleKey, '')
    // A channel too, invented like every other id here. Without one `env.ts` warns that there's
    // no sign for the buttons to sit on, which is correct and is a paragraph of stderr on every
    // case below.
    vi.stubEnv('DISCORD_LAB_CHANNEL_ID', '111111111111111111')
    // `''` and not `undefined`. Deleting a variable lets `dotenv` put the developer's real one
    // back on the next `vi.resetModules()`; an empty string is present, so it survives.
    vi.stubEnv('DISCORD_PUBLIC_KEY', key ?? '')

    return import('./discord.js')
  }

  it('accepts a body Discord actually signed', async () => {
    const { verifyInteraction, interactionsConfigured } =
      await loadWithKey(publicHex)

    expect(interactionsConfigured).toBe(true)

    const body = '{"type":1}'
    const timestamp = '1780000000'

    expect(verifyInteraction(body, signed(body, timestamp), timestamp)).toBe(true)
  })

  /**
   * The reason the raw body has to reach the handler untouched. Parsing and re-serialising the
   * JSON reorders a key or changes an escape, and this is what that looks like from the other
   * side.
   */
  it('refuses a body that has been through JSON and back', async () => {
    const { verifyInteraction } = await loadWithKey(publicHex)

    // One space, which is all it takes. Discord's own bodies carry whitespace and escapes that
    // `JSON.stringify` doesn't reproduce.
    const body = '{"type":1, "id":"1"}'
    const timestamp = '1780000000'
    const signature = signed(body, timestamp)

    const rebuilt = JSON.stringify(JSON.parse(body) as unknown)
    expect(rebuilt).not.toBe(body)
    expect(verifyInteraction(rebuilt, signature, timestamp)).toBe(false)
  })

  /** The timestamp is signed with the body, so a delivery replayed under a different one doesn't
      verify — which is what makes the age check in the route worth anything. */
  it('refuses a signature lifted onto a different timestamp', async () => {
    const { verifyInteraction } = await loadWithKey(publicHex)

    const body = '{"type":3}'
    const signature = signed(body, '1780000000')

    expect(verifyInteraction(body, signature, '1780000001')).toBe(false)
  })

  it('refuses a signature that is not 128 hex characters', async () => {
    const { verifyInteraction } = await loadWithKey(publicHex)

    // `Buffer.from(…, 'hex')` truncates at the first character it can't read rather than
    // throwing, so without the shape check this would be verified as a shorter signature and
    // fail for the wrong reason.
    expect(verifyInteraction('{}', 'not hex', '1780000000')).toBe(false)
    expect(verifyInteraction('{}', 'ab', '1780000000')).toBe(false)
  })

  it('refuses everything when no key is configured', async () => {
    const { verifyInteraction, interactionsConfigured } =
      await loadWithKey(undefined)

    expect(interactionsConfigured).toBe(false)

    const body = '{"type":1}'
    const timestamp = '1780000000'

    // Correctly signed and still refused: an endpoint that can't check a signature has nothing
    // to check one against.
    expect(verifyInteraction(body, signed(body, timestamp), timestamp)).toBe(false)
  })

  /**
   * The mistake that has no symptom until somebody presses a button: pasting an application's
   * public key rather than this one. It's 64 hex characters, it imports perfectly, and every
   * delivery is silently refused.
   *
   * Which is the right refusal — the endpoint is a POST that opens a room — but it's worth a
   * case that says so, because from the channel it looks exactly like an endpoint URL that was
   * never saved.
   */
  it('refuses a delivery signed by a different application', async () => {
    const other = generateKeyPairSync('ed25519')
    const otherHex = other.publicKey
      .export({ format: 'der', type: 'spki' })
      .subarray(12)
      .toString('hex')

    const { verifyInteraction } = await loadWithKey(otherHex)

    const body = '{"type":1}'
    const timestamp = '1780000000'

    expect(verifyInteraction(body, signed(body, timestamp), timestamp)).toBe(false)
  })
})

/**
 * Whether a button press would actually land anywhere.
 *
 * `DISCORD_PUBLIC_KEY` and the portal's Interactions Endpoint URL are two settings in two
 * different places, and having only the first is the ordinary half-configured state. Attaching
 * buttons on the strength of the key alone puts a control in the club's channel that answers
 * "This interaction failed" in front of everybody, so the endpoint is confirmed at startup and
 * `buttonsLive` starts false.
 *
 * The `verify_key` comparison earns its keep on its own: another application's public key is 64
 * hex characters, imports cleanly, and refuses every delivery with no other symptom.
 */
describe('confirmInteractionEndpoint', () => {
  const KEY = 'ab'.repeat(32)

  /** `''` is how "no public key" is said — see the note in `loadWithKey`. A default parameter
      would fire on `undefined` and hand back the key. */
  async function loadConfigured(publicKey: string = KEY) {
    vi.resetModules()
    vi.stubEnv('DISCORD_BOT_TOKEN', 'test-bot-token')
    vi.stubEnv('DISCORD_GUILD_ID', '123456789012345678')
    for (const roleKey of ROLE_KEYS) vi.stubEnv(roleKey, '')
    vi.stubEnv('DISCORD_LAB_CHANNEL_ID', '111111111111111111')
    vi.stubEnv('DISCORD_PUBLIC_KEY', publicKey)

    return import('./discord.js')
  }

  it('turns the buttons on when the application has an endpoint URL', async () => {
    stubDiscord({
      verify_key: KEY,
      interactions_endpoint_url: 'https://rccf.example/api/discord/interactions',
    })
    const { confirmInteractionEndpoint, buttonsLive } = await loadConfigured()

    // False until Discord has been asked, which is the safe direction and the state a fresh
    // process starts in.
    expect(buttonsLive()).toBe(false)

    await expect(confirmInteractionEndpoint()).resolves.toEqual({
      status: 'live',
      url: 'https://rccf.example/api/discord/interactions',
    })
    expect(buttonsLive()).toBe(true)
  })

  /** The half-configured state this whole flag exists for: key in `.env`, no endpoint URL saved
      in the portal. */
  it('leaves them off when the portal has no endpoint URL', async () => {
    stubDiscord({ verify_key: KEY, interactions_endpoint_url: null })
    const { confirmInteractionEndpoint, buttonsLive } = await loadConfigured()

    await expect(confirmInteractionEndpoint()).resolves.toEqual({
      status: 'no_endpoint',
    })
    expect(buttonsLive()).toBe(false)
  })

  /**
   * The worst of the four states, and the reason it has its own answer rather than being folded
   * into "off": an endpoint URL is registered, so Discord POSTs every press to it and tells the
   * gateway nothing — and this server refuses every one of those deliveries because the key
   * isn't its own. From inside the channel it looks exactly like a button nobody wired up.
   */
  it('reports an endpoint it cannot verify, rather than calling it off', async () => {
    stubDiscord({
      verify_key: 'cd'.repeat(32),
      interactions_endpoint_url: 'https://rccf.example/api/discord/interactions',
    })
    const { confirmInteractionEndpoint, buttonsLive } = await loadConfigured()

    const check = await confirmInteractionEndpoint()

    expect(check.status).toBe('endpoint_unusable')
    expect(check.status === 'endpoint_unusable' && check.reason).toContain(
      "not this application's key",
    )
    expect(buttonsLive()).toBe(false)
  })

  /** The same state reached the other way: a URL registered with no key here at all. Presses
      still go there and are still refused. */
  it('reports an endpoint with no key behind it the same way', async () => {
    stubDiscord({
      verify_key: KEY,
      interactions_endpoint_url: 'https://rccf.example/api/discord/interactions',
    })
    const { confirmInteractionEndpoint } = await loadConfigured('')

    const check = await confirmInteractionEndpoint()

    expect(check.status).toBe('endpoint_unusable')
    expect(check.status === 'endpoint_unusable' && check.reason).toContain(
      'DISCORD_PUBLIC_KEY is not set',
    )
  })

  /**
   * A Discord that can't be reached at boot leaves the buttons off, and the asymmetry is
   * deliberate: the cost is churn — the next push strips them off the sign until a restart that
   * can ask — and the cost the other way is a live button that fails in front of the club.
   */
  it('leaves them off when Discord cannot be asked', async () => {
    stubDiscord({ message: '500: Internal Server Error' }, 500)
    const { confirmInteractionEndpoint, buttonsLive } = await loadConfigured()

    expect((await confirmInteractionEndpoint()).status).toBe('unavailable')
    expect(buttonsLive()).toBe(false)
  })

  /**
   * Asked even with no public key, which is the point of the reshape: the question isn't "can we
   * verify a delivery" but "which of the two roads will a press take", and that's a fact about
   * the application. No endpoint URL means the gateway, and the gateway needs no key.
   */
  it('still asks without a public key, because the answer picks the road', async () => {
    const stub = stubDiscord({ interactions_endpoint_url: null })
    const { confirmInteractionEndpoint, buttonsLive } = await loadConfigured('')

    await expect(confirmInteractionEndpoint()).resolves.toEqual({
      status: 'no_endpoint',
    })
    // Off until the gateway says otherwise — `setGatewayConnected` is what turns them on down
    // that road.
    expect(buttonsLive()).toBe(false)
    expect(stub).toHaveBeenCalled()
  })

  /** And that's how the gateway turns them on: no key, no endpoint URL, a connected socket. The
      road the club actually runs on. */
  it('turns the buttons on for a connected gateway with no key at all', async () => {
    stubDiscord({ interactions_endpoint_url: null })
    const { confirmInteractionEndpoint, buttonsLive, setGatewayConnected } =
      await loadConfigured('')

    await confirmInteractionEndpoint()
    expect(buttonsLive()).toBe(false)

    setGatewayConnected(true)
    expect(buttonsLive()).toBe(true)

    // And off again the moment the socket drops, so a sign pushed while Discord is unreachable
    // doesn't carry a button nothing is listening for.
    setGatewayConnected(false)
    expect(buttonsLive()).toBe(false)
  })

  it('reports nothing to ask when there is no bot', async () => {
    vi.resetModules()
    vi.stubEnv('DISCORD_BOT_TOKEN', '')
    vi.stubEnv('DISCORD_GUILD_ID', '')
    for (const roleKey of ROLE_KEYS) vi.stubEnv(roleKey, '')
    const { confirmInteractionEndpoint } = await import('./discord.js')

    await expect(confirmInteractionEndpoint()).resolves.toEqual({
      status: 'unchecked',
    })
  })
})
