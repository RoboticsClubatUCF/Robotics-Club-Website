import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiscordUsernameField } from './DiscordUsernameField'
import { bodyOf, stubFetch, stubFetchStatus } from '../../test/stubFetch'

/**
 * The Discord handle field.
 *
 * Everything the club builds on an account joins on this string, so the two
 * answers it gives have to be the right way round every time: a handle that is
 * in the club's server says so, and anything else — a display name, a typo,
 * somebody who has not joined the server yet — says it cannot be found. What
 * must never happen is the field implying a connection nobody confirmed, which
 * is why the states where nothing was actually checked have their own words.
 *
 * The field checks on a debounce, so every test here drives the clock rather
 * than waiting on it. `shouldAdvanceTime` is what keeps Testing Library's own
 * polling alive under fake timers.
 */

/**
 * Type into the field and let the debounce elapse.
 *
 * Inside `act`, because the answer lands in two steps the test has to wait out:
 * the timer fires, and then a promise resolves. Advancing the clock on its own
 * runs the first and leaves React with the second still pending, so the status
 * line is read before it has been written.
 */
async function type(value: string) {
  fireEvent.change(screen.getByLabelText(/DISCORD USERNAME/i), {
    target: { value },
  })

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000)
  })
}

function renderField(value = '') {
  // A controlled field in a test needs someone to hold the value, the same way
  // the form does.
  function Harness() {
    const [handle, setHandle] = useState(value)
    return <DiscordUsernameField value={handle} onChange={setHandle} />
  }

  return render(<Harness />)
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('DiscordUsernameField', () => {
  it('says nothing until there is something to say', () => {
    vi.stubGlobal('fetch', stubFetch({}))
    renderField()

    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  it('reports a handle that is in the club server', async () => {
    const fetchStub = stubFetch({
      '/signup/discord-check': { status: 'connected', username: 'phibiscool' },
    })
    vi.stubGlobal('fetch', fetchStub)

    renderField()
    await type('phibiscool')

    expect(screen.getByRole('status')).toHaveTextContent(
      /successfully connected/i,
    )
    expect(bodyOf(fetchStub.mock.calls[0]![1])).toEqual({
      discordUsername: 'phibiscool',
    })
  })

  it('reports a handle Discord cannot find', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/signup/discord-check': { status: 'not_found' } }),
    )

    renderField()
    await type('nobody_here')

    expect(screen.getByRole('status')).toHaveTextContent('Cannot find that user.')
  })

  /**
   * The mistake the whole field exists to catch. A display name has capitals
   * and spaces, which Discord does not allow in a handle, so it is answered
   * without troubling the server at all.
   */
  it('answers a display name without asking the server', async () => {
    const fetchStub = stubFetch({ '/signup/discord-check': { status: 'connected' } })
    vi.stubGlobal('fetch', fetchStub)

    renderField()
    await type('PhiBi Rodriguez')

    expect(screen.getByRole('status')).toHaveTextContent('Cannot find that user.')
    expect(fetchStub).not.toHaveBeenCalled()
  })

  /** An `@` and capitals are how people type it, not a mistake worth reporting. */
  it('tidies the handle up before asking, the way the server does', async () => {
    const fetchStub = stubFetch({
      '/signup/discord-check': { status: 'connected', username: 'phibiscool' },
    })
    vi.stubGlobal('fetch', fetchStub)

    renderField()
    await type('  @PhiBiscool ')

    expect(bodyOf(fetchStub.mock.calls[0]![1])).toEqual({
      discordUsername: 'phibiscool',
    })
    expect(screen.getByRole('status')).toHaveTextContent(
      /successfully connected/i,
    )
  })

  it('says when the handle belongs to somebody else already', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/signup/discord-check': { status: 'taken' } }),
    )

    renderField()
    await type('phibiscool')

    expect(screen.getByRole('status')).toHaveTextContent(
      /already connected to another account/i,
    )
  })

  /**
   * The two states where nothing was actually checked. Neither may read as a
   * confirmation — an unconfirmed handle in the database looks exactly like a
   * confirmed one, and this line is the only place the difference is visible.
   */
  it.each([
    ['no bot is configured', 'unchecked', /cannot confirm it automatically/i],
    ['Discord did not answer', 'unavailable', /couldn't reach discord/i],
  ])('does not claim a connection when %s', async (_case, status, expected) => {
    vi.stubGlobal('fetch', stubFetch({ '/signup/discord-check': { status } }))

    renderField()
    await type('phibiscool')

    const note = screen.getByRole('status')
    expect(note).toHaveTextContent(expected)
    expect(note).not.toHaveTextContent(/successfully connected/i)
  })

  it('does not turn a failed check into a verdict on the handle', async () => {
    vi.stubGlobal('fetch', stubFetchStatus(429))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderField()
    await type('phibiscool')

    const note = screen.getByRole('status')
    expect(note).toHaveTextContent(/couldn't check that just now/i)
    expect(note).not.toHaveTextContent('Cannot find that user.')
    consoleError.mockRestore()
  })

  /** A correction is one answer, not one per keystroke. */
  it('asks once for a handle that was typed in pieces', async () => {
    const fetchStub = stubFetch({
      '/signup/discord-check': { status: 'connected', username: 'phibiscool' },
    })
    vi.stubGlobal('fetch', fetchStub)

    renderField()

    for (const partial of ['phibi', 'phibisc', 'phibiscool']) {
      fireEvent.change(screen.getByLabelText(/DISCORD USERNAME/i), {
        target: { value: partial },
      })
      // Well inside the debounce, so each keystroke resets it rather than
      // firing a check of its own.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
    }

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(bodyOf(fetchStub.mock.calls[0]![1])).toEqual({
      discordUsername: 'phibiscool',
    })
  })

  /**
   * Hover is not available to a thumb or to a keyboard, so the screenshot has
   * to be reachable by clicking the icon as well.
   */
  it('opens the instructions on the info icon', async () => {
    vi.stubGlobal('fetch', stubFetch({}))
    renderField()

    const info = screen.getByRole('button', {
      name: /where to find my discord username/i,
    })
    expect(info).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(info)
    expect(info).toHaveAttribute('aria-expanded', 'true')

    // The picture is the point: it is what distinguishes the display name from
    // the username, so it carries that in its alt text rather than "screenshot".
    expect(
      screen.getByRole('img', { name: /username underneath it/i }),
    ).toBeInTheDocument()
  })
})
