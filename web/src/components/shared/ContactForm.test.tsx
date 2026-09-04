import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContactForm } from './ContactForm'
import type { ApiContactAvailability } from '../../lib/api/api'
import {
  bodyOf,
  stubFetch,
  stubFetchNetworkError,
  stubFetchPending,
  stubFetchStatus,
  urlOf,
} from '../../test/stubFetch'

/**
 * The only write path on the site, so this is the only component whose failure states cost someone
 * a message rather than a number on a page. What is worth pinning is that each way it can fail says
 * something different — an unreachable server, a rate limit and a rejected field want three
 * sentences, because only one of them is worth retrying immediately.
 *
 * It now asks `GET /api/contact` whether it may write before drawing the box, which puts two calls
 * on one path in one component — the only place on the site that happens. `stubFetch` keys on the
 * path alone, so the suite routes by method itself rather than teaching the shared helper about
 * verbs for one caller. Keeping the POST in its own `vi.fn` is what lets the assertions below still
 * read `mock.calls[0]` and mean the submission.
 */
const AVAILABLE: ApiContactAvailability = {
  allowed: true,
  remaining: 2,
  retryAfter: 0,
  message: null,
}

type FetchStub = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

/** Answer the availability check, and hand everything else to `post`. */
function withCheck(post: FetchStub, availability: Partial<ApiContactAvailability> = {}) {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    if ((init?.method ?? 'GET').toUpperCase() !== 'GET') return post(input, init)

    return Promise.resolve(
      new Response(JSON.stringify({ ...AVAILABLE, ...availability }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
}

const received = (remaining = 1) =>
  stubFetch({ '/contact': { id: 'c1', status: 'received', remaining } })

/**
 * Fill the form the way a person would, then submit it.
 *
 * Awaits the fields first, because there are none until the check comes back —
 * a synchronous `getByLabelText` here would only ever see the skeleton.
 */
async function submit(over: Partial<Record<string, string>> = {}) {
  const values: Record<string, string> = {
    NAME: 'Jordan Ellis',
    EMAIL: 'jordan@example.com',
    MESSAGE: 'Can I visit the lab before joining?',
    ...over,
  }

  await screen.findByRole('button', { name: /send message/i })

  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), {
      target: { value },
    })
  }

  fireEvent.submit(screen.getByRole('button', { name: /send message/i }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ContactForm', () => {
  it('sends what the server asks for, and nothing it does not', async () => {
    const post = received()
    vi.stubGlobal('fetch', withCheck(post))

    render(<ContactForm />)
    await submit({ SUBJECT: 'Lab visit' })

    await screen.findByText(/that reached us/i)

    const [url, init] = post.mock.calls[0]!
    expect(urlOf(url)).toContain('/api/contact')
    expect(init?.method).toBe('POST')
    expect(bodyOf(init)).toEqual({
      name: 'Jordan Ellis',
      email: 'jordan@example.com',
      subject: 'Lab visit',
      message: 'Can I visit the lab before joining?',
    })
  })

  /**
   * `subject` is optional on the server, and an empty string is not a subject —
   * sending one would put a blank row in front of whoever reads these.
   */
  it('leaves an empty subject out of the payload entirely', async () => {
    const post = received()
    vi.stubGlobal('fetch', withCheck(post))

    render(<ContactForm />)
    await submit()

    await screen.findByText(/that reached us/i)

    expect(bodyOf(post.mock.calls[0]![1])).not.toHaveProperty('subject')
  })

  it('confirms the send and clears the form for the next one', async () => {
    vi.stubGlobal('fetch', withCheck(received()))

    render(<ContactForm />)
    await submit()

    expect(await screen.findByText(/that reached us/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^NAME/)).toHaveValue('')
    expect(screen.getByLabelText(/^MESSAGE/)).toHaveValue('')
  })

  it('says the server is unreachable rather than blaming the sender', async () => {
    vi.stubGlobal('fetch', withCheck(stubFetchNetworkError()))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<ContactForm />)
    await submit()

    expect(await screen.findByText(/couldn't reach the server/i)).toBeInTheDocument()
    // The message is still in the box, so it isn't lost with the failure.
    expect(screen.getByLabelText(/^MESSAGE/)).toHaveValue(
      'Can I visit the lab before joining?',
    )
    consoleError.mockRestore()
  })

  it('tells a rate-limited sender to wait rather than to retry', async () => {
    vi.stubGlobal('fetch', withCheck(stubFetchStatus(429)))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<ContactForm />)
    await submit()

    expect(await screen.findByText(/too many messages/i)).toBeInTheDocument()
    consoleError.mockRestore()
  })

  /**
   * Two limits answer 429 on this endpoint — the ten-minute burst and the daily
   * ceiling — and they ask for opposite things. Only the server knows which one
   * bit, so its sentence has to survive rather than being flattened into the
   * generic one above.
   */
  it('prefers the server’s own sentence when a 429 carries one', async () => {
    vi.stubGlobal(
      'fetch',
      withCheck(
        stubFetchStatus(429, { error: "You've already sent us two messages today." }),
      ),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<ContactForm />)
    await submit()

    expect(
      await screen.findByText(/already sent us two messages today/i),
    ).toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('distinguishes a rejected field from a broken server', async () => {
    vi.stubGlobal('fetch', withCheck(stubFetchStatus(400)))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<ContactForm />)
    await submit()

    expect(await screen.findByText(/check the fields/i)).toBeInTheDocument()
    consoleError.mockRestore()
  })

  /**
   * The endpoint is rate limited and every submission is a row, so a double
   * click must not be two messages.
   */
  it('refuses to send twice while the first is in flight', async () => {
    const post = stubFetchPending()
    vi.stubGlobal('fetch', withCheck(post))

    render(<ContactForm />)
    await submit()

    const button = screen.getByRole('button', { name: /sending/i })
    await waitFor(() => {
      expect(button).toBeDisabled()
    })

    fireEvent.submit(button)
    expect(post).toHaveBeenCalledTimes(1)
  })

  // ------------------------------------------------ the daily ceiling

  /**
   * The reason the check exists. A bot reloading the page is refused by the
   * POST either way; a person who has already written twice today should not be
   * handed a box that is going to throw away what they type into it.
   */
  it('shows the refusal instead of the box when the day is used up', async () => {
    vi.stubGlobal(
      'fetch',
      withCheck(received(), {
        allowed: false,
        remaining: 0,
        retryAfter: 3600,
        message: 'Come back tomorrow.',
      }),
    )

    render(<ContactForm />)

    expect(await screen.findByText('Come back tomorrow.')).toBeInTheDocument()
    expect(screen.queryByLabelText(/^MESSAGE/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /send message/i }),
    ).not.toBeInTheDocument()
  })

  /**
   * The count comes back from the write, so the form takes itself down on the
   * last one rather than waiting for a reload to find out.
   */
  it('takes the box away after the last message, keeping the confirmation', async () => {
    vi.stubGlobal('fetch', withCheck(received(0), { remaining: 1 }))

    render(<ContactForm />)
    await submit()

    expect(await screen.findByText(/that reached us/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByLabelText(/^MESSAGE/)).not.toBeInTheDocument()
    })
  })

  /** Warned before it matters, because the box is about to disappear. */
  it('says when one message is left', async () => {
    vi.stubGlobal('fetch', withCheck(received(), { remaining: 1 }))

    render(<ContactForm />)

    expect(await screen.findByText(/one message left today/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^MESSAGE/)).toBeInTheDocument()
  })

  it('says nothing about a limit to somebody who has sent nothing', async () => {
    vi.stubGlobal('fetch', withCheck(received()))

    render(<ContactForm />)
    await screen.findByRole('button', { name: /send message/i })

    expect(screen.queryByText(/message left today/i)).not.toBeInTheDocument()
  })

  /**
   * The check is politeness, not the gate — the POST spends the same window
   * server-side. So a check that fails must open the form: hiding the club's
   * contact form because an advisory read came back 500 is the site breaking
   * itself over a request nothing depends on.
   */
  it('opens the form anyway when the check itself fails', async () => {
    vi.stubGlobal('fetch', stubFetchStatus(500))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<ContactForm />)

    expect(
      await screen.findByRole('button', { name: /send message/i }),
    ).toBeInTheDocument()
    consoleError.mockRestore()
  })

  /** Nothing to type into until the answer lands, or the box is a lie. */
  it('holds a skeleton rather than a form while the check is in flight', () => {
    vi.stubGlobal('fetch', stubFetchPending())

    const { container } = render(<ContactForm />)

    expect(screen.queryByLabelText(/^MESSAGE/)).not.toBeInTheDocument()
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })
})
