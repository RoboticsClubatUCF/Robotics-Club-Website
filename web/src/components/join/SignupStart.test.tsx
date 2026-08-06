import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  '/signup/start': { status: 'sent', email: 'knightro@ucf.edu', expiresInMinutes: 120 },
}

const fill = (email = 'knightro@ucf.edu', { acknowledge = true } = {}) => {
  fireEvent.change(screen.getByLabelText(/UCF STUDENT EMAIL/i), {
    target: { value: email },
  })

  if (acknowledge) fireEvent.click(screen.getByRole('checkbox'))
}

const submit = () =>
  fireEvent.submit(screen.getByRole('button', { name: /continue/i }))

afterEach(() => {
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
    fill()
    submit()

    await screen.findByText(/check your spam folder/i)

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
    fill()
    submit()

    expect(await screen.findByText(/check your spam folder/i)).toBeInTheDocument()
    expect(screen.getByText(/junk or spam/i)).toBeInTheDocument()
  })

  /** Someone with several UCF addresses needs to know which one it went to. */
  it('names the address it sent to, as the server spelled it', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/signup/start': {
          status: 'sent',
          email: 'knightro@ucf.edu',
          expiresInMinutes: 120,
        },
      }),
    )

    render(<SignupStart />)
    fill('  KNIGHTRO@UCF.edu ')
    submit()

    expect(await screen.findByText('knightro@ucf.edu')).toBeInTheDocument()
  })

  /** The TTL is server configuration, so the page must not invent a number. */
  it('reports the expiry the server gave it, in hours', async () => {
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
    fill()
    submit()

    expect(await screen.findByText(/30 minutes/i)).toBeInTheDocument()
  })

  it('offers a way back for an address typed wrong', async () => {
    vi.stubGlobal('fetch', stubFetch(SENT))

    render(<SignupStart />)
    fill()
    submit()

    fireEvent.click(await screen.findByRole('button', { name: /wrong address/i }))

    expect(screen.getByLabelText(/UCF STUDENT EMAIL/i)).toBeInTheDocument()
  })

  it('says the server is unreachable rather than blaming the sender', async () => {
    vi.stubGlobal('fetch', stubFetchNetworkError())
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<SignupStart />)
    fill()
    submit()

    expect(await screen.findByText(/couldn't reach the server/i)).toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('tells a rate-limited sender to wait rather than to retry', async () => {
    vi.stubGlobal('fetch', stubFetchStatus(429))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<SignupStart />)
    fill()
    submit()

    expect(await screen.findByText(/too many tries/i)).toBeInTheDocument()
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
      stubFetchStatus(409, { error: 'There is already an account for that email.' }),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<SignupStart />)
    fill()
    submit()

    expect(
      await screen.findByText(/already an account for that email/i),
    ).toBeInTheDocument()
    consoleError.mockRestore()
  })

  /** A 400 here is one thing in practice: an address that is not `@ucf.edu`. */
  it('explains a rejected address in terms of the rule it broke', async () => {
    vi.stubGlobal('fetch', stubFetchStatus(400))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<SignupStart />)
    fill('someone@gmail.com')
    submit()

    expect(await screen.findByText(/ending in @ucf\.edu/i)).toBeInTheDocument()
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
    await waitFor(() => {
      expect(button).toBeDisabled()
    })

    fireEvent.submit(button)
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })
})
