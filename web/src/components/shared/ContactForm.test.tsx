import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContactForm } from './ContactForm'
import {
  bodyOf,
  stubFetch,
  stubFetchNetworkError,
  stubFetchPending,
  stubFetchStatus,
  urlOf,
} from '../test/stubFetch'

/**
 * The only write path on the site, so this is the only component whose failure
 * states cost someone a message rather than a number on a page. What is worth
 * pinning down is that each way it can fail says something different — an
 * unreachable server, a rate limit and a rejected field want three different
 * sentences, because only one of them is worth retrying immediately.
 */

/** Fill the form the way a person would, then submit it. */
function submit(over: Partial<Record<string, string>> = {}) {
  const values: Record<string, string> = {
    NAME: 'Jordan Ellis',
    EMAIL: 'jordan@example.com',
    MESSAGE: 'Can I visit the lab before joining?',
    ...over,
  }

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
    const fetchStub = stubFetch({ '/contact': { id: 'c1', status: 'received' } })
    vi.stubGlobal('fetch', fetchStub)

    render(<ContactForm />)
    submit({ SUBJECT: 'Lab visit' })

    await screen.findByText(/that reached us/i)

    const [url, init] = fetchStub.mock.calls[0]!
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
    const fetchStub = stubFetch({ '/contact': { id: 'c1', status: 'received' } })
    vi.stubGlobal('fetch', fetchStub)

    render(<ContactForm />)
    submit()

    await screen.findByText(/that reached us/i)

    expect(bodyOf(fetchStub.mock.calls[0]![1])).not.toHaveProperty('subject')
  })

  it('confirms the send and clears the form for the next one', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/contact': { id: 'c1', status: 'received' } }))

    render(<ContactForm />)
    submit()

    expect(await screen.findByText(/that reached us/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^NAME/)).toHaveValue('')
    expect(screen.getByLabelText(/^MESSAGE/)).toHaveValue('')
  })

  it('says the server is unreachable rather than blaming the sender', async () => {
    vi.stubGlobal('fetch', stubFetchNetworkError())
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<ContactForm />)
    submit()

    expect(await screen.findByText(/couldn't reach the server/i)).toBeInTheDocument()
    // The message is still in the box, so it isn't lost with the failure.
    expect(screen.getByLabelText(/^MESSAGE/)).toHaveValue(
      'Can I visit the lab before joining?',
    )
    consoleError.mockRestore()
  })

  it('tells a rate-limited sender to wait rather than to retry', async () => {
    vi.stubGlobal('fetch', stubFetchStatus(429))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<ContactForm />)
    submit()

    expect(await screen.findByText(/too many messages/i)).toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('distinguishes a rejected field from a broken server', async () => {
    vi.stubGlobal('fetch', stubFetchStatus(400))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<ContactForm />)
    submit()

    expect(await screen.findByText(/check the fields/i)).toBeInTheDocument()
    consoleError.mockRestore()
  })

  /**
   * The endpoint is rate limited and every submission is a row, so a double
   * click must not be two messages.
   */
  it('refuses to send twice while the first is in flight', async () => {
    const fetchStub = stubFetchPending()
    vi.stubGlobal('fetch', fetchStub)

    render(<ContactForm />)
    submit()

    const button = screen.getByRole('button', { name: /sending/i })
    await waitFor(() => {
      expect(button).toBeDisabled()
    })

    fireEvent.submit(button)
    expect(fetchStub).toHaveBeenCalledTimes(1)
  })
})
