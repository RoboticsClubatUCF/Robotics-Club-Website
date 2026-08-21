import { afterEach, describe, expect, it, vi } from 'vitest'
import { isHandleShaped, normaliseHandle } from './discord.js'

/**
 * The Discord client, with `fetch` stubbed.
 *
 * `signup.test.ts` stubs this module out entirely, so this is where the thing
 * it stubs is actually checked. Both halves matter and neither is obvious:
 * matching the username rather than the display name is the entire reason this
 * file exists, and a failure to reach Discord must never come back looking like
 * a verdict on the handle.
 *
 * `checkDiscordHandle` is imported inside each test, after the environment is
 * set: the module reads its token once at import time, which is what makes the
 * unconfigured case a real state rather than a flag.
 */

const RESULTS = {
  /** A member whose display name is nothing like their username — the case the
      instructions image on the join page is about. */
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

// Parameters are declared even though the stub ignores them, so `mock.calls`
// types as a real pair and the assertions on the URL need no cast.
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
 * Import fresh, so the module picks up whatever the environment now says. The
 * token is read once at import time — that is what makes "no bot configured" a
 * state of the module rather than a flag it checks per call.
 *
 * `undefined` rather than an empty string: `env.ts` requires a non-empty value
 * when the key is present at all, and refuses to start otherwise. Unsetting is
 * what "no bot" actually looks like.
 */
/**
 * `configured: false` means *nothing* Discord is set, not just the token.
 *
 * The role ids have to come off with it. `env.ts` refuses to parse a role id
 * with no bot behind it — a setting that reads exactly like it is running the
 * board and cannot ask Discord anything — so leaving one in place while
 * clearing the token exits the process rather than producing the unconfigured
 * client this wants. That is the refine working; it only bit here because a
 * developer with the role sync switched on in their own `.env` runs a different
 * test than one without, which is the kind of difference a suite should not
 * have.
 */
const ROLE_KEYS = [
  'DISCORD_OFFICER_ROLE_ID',
  'DISCORD_MEMBER_ROLE_ID',
  'DISCORD_PROJECT_LEAD_ROLE_ID',
  'DISCORD_TEAM_LEAD_ROLE_ID',
] as const

async function load(configured = true) {
  vi.resetModules()
  vi.stubEnv('DISCORD_BOT_TOKEN', configured ? 'test-bot-token' : undefined)
  vi.stubEnv('DISCORD_GUILD_ID', configured ? '123456789012345678' : undefined)

  // **Every role id is cleared, both ways round**, and the suite is hermetic
  // because of it. Two things go wrong otherwise. Cleared bot with a role id
  // left in place exits the process: `env.ts` refuses a role id with no bot
  // behind it, which is that refine doing its job. And a *set* role id in a
  // developer's own `.env` leaks in the other direction — the module constants
  // are read at import, so `officerRoleId` would be the club's real snowflake
  // for anybody who has switched the sync on locally and null for everybody
  // else. A suite that tests something different depending on whose machine it
  // runs on is worse than one that tests the wrong thing consistently.
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
   * Both of these are what people actually type — the `@` because that is how
   * Discord displays a handle, the capitals because that is how they think of
   * their own name. Neither is an error worth showing anyone.
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

    // The snowflake comes back beside the handle: it is what survives somebody
    // renaming themselves, and what the bot addresses a direct message to.
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
   * The one that matters. Discord's search matches display names too, so it
   * will happily hand back PhiBi's row for a query of "phibi" — and taking that
   * as a match is exactly the mistake the whole check exists to prevent.
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
   * 403 is the Server Members Intent switched off, 401 a bad token, 429 the
   * rate limit. None of them is a statement about the handle, so none of them
   * may come back as `not_found` — that would tell somebody their correct
   * username is wrong, and they have no way to argue.
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
 * Every test here is really the same assertion from a different angle: **an
 * `ok` with nothing in it and an `unavailable` are different answers.** One of
 * them means the board resigned and the other means Discord could not be
 * reached, and the caller stands the whole club's officers down if it confuses
 * them. Nothing below may ever return an empty `ok` for a failure.
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
   * A guild with nobody on the board is a real answer and must come back as
   * one. It is the *caller* that refuses to act on it — see the standing-down
   * rules in `discordOfficers.ts` — and it can only do that if this reports it
   * honestly rather than as a failure.
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
   * A full page means there may be more, and the cursor is the highest id seen
   * — Discord sorts by id ascending and offers no other end-of-list signal.
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
   * Snowflakes run 17 to 19 digits, and `guildMember` mints them all the same
   * length starting with the same digit — so string order and numeric order
   * agree and a string comparison passes. On the club's real guild they do not
   * agree: a 2015 account's 17-digit id beginning `9` sorts above a 2016
   * account's 18-digit id beginning `7`, the cursor goes *backwards*, the next
   * page repeats members already seen, and the walk burns all ten pages and
   * reports itself unavailable. A 1,600-member guild that takes three pages
   * never finished one walk, and because `unavailable` means "write nothing"
   * the symptom was a sync that silently did nothing for ever.
   */
  it('advances the cursor by number, not by string order', async () => {
    const mixed = [
      // Deliberately the shape that breaks it: the lexicographically largest
      // id here is the numerically smallest.
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
    // The largest by value. `900000000000000997` from the filler is bigger than
    // the mixed three, and both orderings agree on it — so the assertion that
    // carries the weight is the one below.
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
   * The failure that matters most. Half a member list is indistinguishable from
   * a guild in which half the board lost its role, and the caller would act on
   * the second — so one bad page abandons the entire walk rather than returning
   * what it managed to read.
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
   * Off is the default, and the whole safety story of this feature rests on it:
   * until somebody sets a role id, nothing can stand anybody down.
   */
  it('is off until a role id is configured', async () => {
    const { officerRoleId, officerSyncConfigured } = await load()

    expect(officerRoleId).toBeNull()
    expect(officerSyncConfigured).toBe(false)
  })
})

/**
 * Writing a role, which is the first thing this client has ever done to the
 * guild rather than to a DM channel. What matters is the split between a
 * refusal that will never work and an outage that might clear: the reconciler
 * behind this retries either way, and the log is what tells an officer which of
 * the two they are looking at.
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
   * The reason reaches the guild's audit log, which is the difference between
   * a bot people trust and one they switch off. Encoded because a project
   * title is whatever a lead typed and the header is not 8-bit clean.
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
   * The bot's own role sitting at or below the target. No amount of retrying
   * fixes it and somebody has to go and move a role, so it is `refused` and it
   * is logged loudly.
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
 * The whole guild in one walk, which both syncs now share. `membersWithRole`
 * is a filter over this, so the pagination rules are tested there and only the
 * shape is tested here.
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

    // Empty and unreadable must not be the same answer: an empty map would
    // make every configured role look like a typo.
    expect((await guildRoles()).status).toBe('unavailable')
  })
})
