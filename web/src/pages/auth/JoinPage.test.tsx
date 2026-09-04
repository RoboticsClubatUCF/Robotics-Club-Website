import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JoinPage } from './JoinPage'
import { stubFetch, stubFetchPending, stubFetchStatus } from '../../test/stubFetch'

/**
 * Which of the four screens a visitor gets, and why.
 *
 * The token in the URL is what decides it, and that is the part worth testing: the link is opened
 * from an email, frequently on a different device from the one the form was started on, so nothing
 * may depend on state left in a tab. A page that showed the finish form to somebody whose link had
 * expired would take a full set of details and then throw them away.
 */

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <JoinPage />
    </MemoryRouter>,
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('JoinPage', () => {
  it('asks for an address when there is no link to check', () => {
    vi.stubGlobal('fetch', stubFetch({}))
    renderAt('/join')

    expect(screen.getByLabelText(/UCF STUDENT EMAIL/i)).toBeInTheDocument()
  })

  /** Nothing is verified until the token has been checked with the server. */
  it('waits on the server rather than trusting the token in the URL', () => {
    vi.stubGlobal('fetch', stubFetchPending())
    renderAt('/join?token=a-good-token')

    expect(screen.getByText(/checking your link/i)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /create my account/i }),
    ).not.toBeInTheDocument()
  })

  it('opens the rest of the form once the link checks out', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/signup/verify': { email: 'knightro@ucf.edu' } }),
    )
    renderAt('/join?token=a-good-token')

    expect(
      await screen.findByText(/finish setting up your account/i),
    ).toBeInTheDocument()
    // Named, for somebody with several UCF addresses in one inbox.
    expect(screen.getByText('knightro@ucf.edu')).toBeInTheDocument()
  })

  /**
   * The server says the same thing about an expired link, an unknown one and
   * one already spent — they are one situation from here, and the only useful
   * answer is a fresh one.
   */
  it('offers a fresh link rather than a form nobody could submit', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetchStatus(410, {
        error: 'That link has expired or has already been used.',
      }),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderAt('/join?token=a-stale-token')

    expect(await screen.findByText(/has expired/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /start again/i })).toHaveAttribute(
      'href',
      '/join',
    )
    expect(
      screen.queryByRole('button', { name: /create my account/i }),
    ).not.toBeInTheDocument()

    consoleError.mockRestore()
  })

  /** An unreachable API is not a bad link, and must not be reported as one. */
  it('does not call a link bad when it could not check it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderAt('/join?token=a-good-token')

    expect(
      await screen.findByText(/couldn't reach the server to check that link/i),
    ).toBeInTheDocument()
    consoleError.mockRestore()
  })

  /**
   * An account is not membership, and the club's next two steps happen
   * somewhere else entirely. A page that says "you're in" and stops leaves
   * somebody waiting to be told what to do.
   */
  it('says what happens next once the account exists', async () => {
    const fetchStub = vi.fn(
      (input: string | URL | Request, _init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString()

        const body = url.includes('/signup/verify')
          ? { email: 'knightro@ucf.edu' }
          : url.includes('/signup/discord-check')
            ? { status: 'connected', username: 'phibiscool' }
            : { id: 'u1', status: 'created' }

        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      },
    )
    vi.stubGlobal('fetch', fetchStub)

    renderAt('/join?token=a-good-token')

    await screen.findByText(/finish setting up your account/i)

    fireEvent.change(screen.getByLabelText(/FIRST NAME/i), {
      target: { value: 'Test' },
    })
    fireEvent.change(screen.getByLabelText(/LAST NAME/i), {
      target: { value: 'Knight' },
    })
    fireEvent.change(screen.getByLabelText(/^PASSWORD/i), {
      target: { value: 'a-long-enough-password' },
    })
    fireEvent.change(screen.getByLabelText(/CONFIRM PASSWORD/i), {
      target: { value: 'a-long-enough-password' },
    })
    fireEvent.change(screen.getByLabelText(/DISCORD USERNAME/i), {
      target: { value: 'phibiscool' },
    })
    fireEvent.click(
      screen.getByRole('checkbox', { name: /member acknowledgement/i }),
    )

    fireEvent.submit(screen.getByRole('button', { name: /create my account/i }))

    expect(await screen.findByText(/welcome to rccf/i)).toBeInTheDocument()
    expect(screen.getByText(/pay your dues/i)).toBeInTheDocument()
    expect(screen.getByText(/general body meeting/i)).toBeInTheDocument()

    // Somewhere to go next, and both of them are real destinations rather than
    // a button back to where they started.
    expect(
      screen.getByRole('link', { name: /go to my dashboard/i }),
    ).toHaveAttribute('href', '/dashboard')
    expect(
      screen.getByRole('link', { name: /see the projects/i }),
    ).toHaveAttribute('href', '/projects')
  })
})
