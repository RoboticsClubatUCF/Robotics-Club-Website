import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignupStart } from './SignupStart'
import {
  bodyOf,
  stubFetch,
  stubFetchNetworkError,
  stubFetchPending,
  stubFetchStatus,
  urlOf,
} from '../../test/stubFetch'

/**
 * The first step of signing up.
 *
 * Two things here cost the club members rather than pixels, and both are what
 * these tests are for. The eligibility requirement has to be read before the
 * form can be used, because someone who signs up with a Gmail address has
 * wasted their time and ours. And the confirmation has to say that the email
 * lands in spam — that is the single most common reason a signup is started and
 * never finished, and nobody comes back to a page to find out why.
 */

const SENT = {
  '/signup/start': {
    status: 'sent',
    email: 'knightro@ucf.edu',
    expiresInMinutes: 120,
  },
}

const fill = (email = 'knightro@ucf.edu') => {
  fireEvent.change(screen.getByLabelText(/UCF STUDENT EMAIL/i), {
    target: { value: email },
  })
  fireEvent.click(screen.getByRole('checkbox'))
}

const submit = () =>
  fireEvent.submit(screen.getByRole('button', { name: /continue/i }))

const restart = () => screen.getByRole('button', { name: /start again/i })

/**
 * Let a stubbed fetch settle and React commit the result.
 *
 * `findBy*` is not safe in this file. Under fake timers Testing Library polls
 * by advancing the fake clock, so its one-second budget is spent in a few real
 * milliseconds — routinely before a promise chain has flushed, which made
 * whichever test happened to lose the race fail about one run in three.
 * Advancing inside `act` flushes the microtasks and the render together, and is
 * the same thing being asserted with none of the racing.
 */
const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

/** Fill the form, send it, and wait for the confirmation to be on screen. */
const send = async (email?: string) => {
  fill(email)
  submit()
  await settle()
}

/** Let the restart cooldown elapse. */
const waitOutCooldown = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(31_000)
  })
}

beforeEach(() => {
  // The sent screen runs an interval for the cooldown, and the cooldown is
  // half a minute — neither is something to sit through at real speed.
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('SignupStart', () => {
  it('leads with who is allowed to join, before asking for anything', () => {
    render(<SignupStart />)

    // The requirement is stated twice on purpose — once as the thing to read,
    // once as the thing to agree to — so this names the heading exactly.
    expect(
      screen.getByText(/You need to be a current UCF student/i),
    ).toBeInTheDocument()
    // Exact, or the paragraph wrapping it matches as well as the domain itself.
    expect(screen.getByText('@ucf.edu')).toBeInTheDocument()
  })

  /**
   * The server refuses a signup whose `acknowledged` is anything but `true`, so
   * the form has no business sending one — and the checkbox being `required` is
   * what stops the browser submitting without it.
   */
  it('will not submit until the requirement is acknowledged', () => {
    render(<SignupStart />)

    expect(screen.getByRole('checkbox')).toBeRequired()
  })

  it('sends the address and the acknowledgement, and nothing else', async () => {
    const fetchStub = stubFetch(SENT)
    vi.stubGlobal('fetch', fetchStub)

    render(<SignupStart />)
    await send()

    const [url, init] = fetchStub.mock.calls[0]!
    expect(urlOf(url)).toContain('/api/signup/start')
    expect(init?.method).toBe('POST')
    expect(bodyOf(init)).toEqual({
      email: 'knightro@ucf.edu',
      acknowledged: true,
    })
  })

  /**
   * The one piece of advice on this screen that changes whether somebody
   * finishes signing up. University filters treat a first message from an
   * unfamiliar sender harshly, and the page is the last chance to say so.
   */
  it('warns about the spam folder once the link is on its way', async () => {
    vi.stubGlobal('fetch', stubFetch(SENT))

    render(<SignupStart />)
    await send()

    expect(screen.getByText(/check your spam folder/i)).toBeInTheDocument()
    expect(screen.getByText(/files our first email as junk/i)).toBeInTheDocument()
  })

  /**
   * Nothing else happens on this screen — signup continues from the link, on
   * whatever device opens it. Somebody who doesn't know that sits here waiting
   * for a page that is never going to advance.
   */
  it('says the tab can be closed and the email carries on', async () => {
    vi.stubGlobal('fetch', stubFetch(SENT))

    render(<SignupStart />)
    await send()

    expect(screen.getByText(/you can close this tab/i)).toBeInTheDocument()
    expect(screen.getByText(/carry on from the link/i)).toBeInTheDocument()
  })

  /** Someone with several UCF addresses needs to know which one it went to. */
  it('names the address it sent to, as the server spelled it', async () => {
    vi.stubGlobal('fetch', stubFetch(SENT))

    render(<SignupStart />)
    await send('  KNIGHTRO@UCF.edu ')

    expect(screen.getByText('knightro@ucf.edu')).toBeInTheDocument()
  })

  /** The TTL is server configuration, so the page must not invent a number. */
  it('reports the expiry the server gave it', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/signup/start': {
          status: 'sent',
          email: 'knightro@ucf.edu',
          expiresInMinutes: 30,
        },
      }),
    )

    render(<SignupStart />)
    await send()

    expect(screen.getByText(/30 minutes/i)).toBeInTheDocument()
  })

  it('offers a way back for an address typed wrong', async () => {
    vi.stubGlobal('fetch', stubFetch(SENT))

    render(<SignupStart />)
    await send()
    await waitOutCooldown()

    fireEvent.click(restart())

    expect(screen.getByLabelText(/UCF STUDENT EMAIL/i)).toBeInTheDocument()
  })

  /**
   * Starting again is one click from asking for a second email, and the usual
   * reason to reach for it is that the first hasn't arrived in four seconds.
   * Mail is slower than that, and every new link invalidates the last one.
   */
  it('holds the restart shut for half a minute after sending', async () => {
    vi.stubGlobal('fetch', stubFetch(SENT))

    render(<SignupStart />)
    await send()

    expect(restart()).toBeDisabled()
    expect(restart()).toHaveTextContent(/start again in \d+s/i)

    // Still shut most of the way through.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_000)
    })
    expect(restart()).toBeDisabled()

    await waitOutCooldown()
    expect(restart()).toBeEnabled()
    expect(restart()).toHaveTextContent(/start again$/i)
  })

  it('will not go back while the cooldown is running', async () => {
    vi.stubGlobal('fetch', stubFetch(SENT))

    render(<SignupStart />)
    await send()

    fireEvent.click(restart())

    // Still on the confirmation, not back at the form.
    expect(screen.getByText(/check your spam folder/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/UCF STUDENT EMAIL/i)).not.toBeInTheDocument()
  })

  /**
   * The question is not the link. Painting both gold made the whole line read
   * as one long button.
   */
  it('highlights only the part that is the link', async () => {
    vi.stubGlobal('fetch', stubFetch(SENT))

    render(<SignupStart />)
    await send()
    await waitOutCooldown()

    expect(screen.getByText(/WRONG ADDRESS\?/)).toHaveClass('text-faint')
    expect(screen.getByText('START AGAIN')).toHaveClass('text-primary')
  })

  it('says the server is unreachable rather than blaming the sender', async () => {
    vi.stubGlobal('fetch', stubFetchNetworkError())
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<SignupStart />)
    await send()

    expect(screen.getByText(/couldn't reach the server/i)).toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('tells a rate-limited sender to wait rather than to retry', async () => {
    vi.stubGlobal('fetch', stubFetchStatus(429))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<SignupStart />)
    await send()

    expect(screen.getByText(/too many tries/i)).toBeInTheDocument()
    consoleError.mockRestore()
  })

  /**
   * "That email already has an account" is a sentence only the server can
   * write — it is the one that knows — so it has to reach the page rather than
   * being flattened into "something went wrong".
   */
  it('passes the server its own words when it refuses', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetchStatus(409, {
        error: 'There is already an account for that email.',
      }),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<SignupStart />)
    await send()

    expect(
      screen.getByText(/already an account for that email/i),
    ).toBeInTheDocument()
    consoleError.mockRestore()
  })

  /** A 400 here is one thing in practice: an address that is not `@ucf.edu`. */
  it('explains a rejected address in terms of the rule it broke', async () => {
    vi.stubGlobal('fetch', stubFetchStatus(400))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<SignupStart />)
    await send('someone@gmail.com')

    expect(screen.getByText(/ending in @ucf\.edu/i)).toBeInTheDocument()
    consoleError.mockRestore()
  })

  /** The endpoint is rate limited and sends real mail; a double click is one. */
  it('refuses to send twice while the first is in flight', async () => {
    const fetchStub = stubFetchPending()
    vi.stubGlobal('fetch', fetchStub)

    render(<SignupStart />)
    fill()
    submit()

    const button = screen.getByRole('button', { name: /sending/i })
    expect(button).toBeDisabled()

    fireEvent.submit(button)
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })
})
