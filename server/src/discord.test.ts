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
    },
  ],
  none: [],
}

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
async function load(configured = true) {
  vi.resetModules()
  vi.stubEnv('DISCORD_BOT_TOKEN', configured ? 'test-bot-token' : undefined)
  vi.stubEnv('DISCORD_GUILD_ID', configured ? '123456789012345678' : undefined)

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
