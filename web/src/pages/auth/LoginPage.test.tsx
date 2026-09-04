import {
  fireEvent,
  render as renderBare,
  screen,
  waitFor,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage'
import { SessionProvider } from '../../lib/auth/auth'
import { bodyOf, urlOf } from '../../test/stubFetch'

/**
 * Signing in.
 *
 * Real timers throughout, so `findBy*` and `waitFor` behave — see the note in
 * `.claude/docs/testing.md` about what happens under fake ones. Nothing on this page is debounced,
 * so there is no reason for fake timers here.
 *
 * The page shares a `fetch` with the session provider wrapped around it, which asks `/auth/me` on
 * mount. Every stub below has to answer both.
 */

/**
 * `fetch`, routed by path. Not `stubFetch` from `test/stubFetch.ts`: that one
 * always answers 200, and half of what this page does is turn a status into a
 * sentence.
 */
function stubAuth(login: { status: number; body: unknown }) {
  const stub = vi.fn((input: string | URL | Request, _init?: RequestInit) => {
    const url = urlOf(input)

    if (url.includes('/auth/me')) {
      return Promise.resolve(
        new Response(JSON.stringify({ user: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }

    return Promise.resolve(
      new Response(JSON.stringify(login.body), {
        status: login.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  vi.stubGlobal('fetch', stub)
  return stub
}

const render = () =>
  renderBare(<LoginPage />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={['/login']}>
        <SessionProvider>{children}</SessionProvider>
      </MemoryRouter>
    ),
  })

/**
 * `fireEvent` rather than `user-event`, which is not a dependency of this
 * package — the other suites here drive forms the same way, and nothing on this
 * page depends on the keystroke-by-keystroke behaviour the heavier library
 * exists to reproduce.
 */
function signIn(email = 'knightro@ucf.edu', password = 'a-long-password') {
  fireEvent.change(screen.getByLabelText(/^email$/i), {
    target: { value: email },
  })
  fireEvent.change(screen.getByLabelText(/^password$/i), {
    target: { value: password },
  })
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LoginPage', () => {
  it('sends the address and password to the login endpoint', async () => {
    const stub = stubAuth({
      status: 200,
      body: { user: { id: 'u1', fullName: 'Knightro', email: 'knightro@ucf.edu' } },
    })

    render()
    signIn()

    await waitFor(() => {
      const call = stub.mock.calls.find(([input]) =>
        urlOf(input).includes('/auth/login'),
      )
      expect(call).toBeDefined()
      expect(bodyOf(call![1])).toEqual({
        email: 'knightro@ucf.edu',
        password: 'a-long-password',
      })
    })
  })

  /**
   * The server says one thing for a wrong password, an unknown address and an account with no
   * password set, and the page shows exactly that rather than paraphrasing — paraphrasing is how
   * the three grow apart again, and this form must not answer "is this person a member".
   */
  it('shows the server refusal as written, without inventing a reason', async () => {
    stubAuth({
      status: 401,
      body: { error: 'That email and password do not match an account.' },
    })

    render()
    signIn()

    expect(
      await screen.findByText('That email and password do not match an account.'),
    ).toBeInTheDocument()
  })

  it('says something different about being rate limited', async () => {
    stubAuth({ status: 429, body: { error: 'Too many sign-in attempts.' } })

    render()
    signIn()

    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument()
  })

  /** An unreachable API is not a wrong password, and must not read as one. */
  it('says the server could not be reached when it could not', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) =>
        urlOf(input).includes('/auth/me')
          ? Promise.resolve(
              new Response(JSON.stringify({ user: null }), { status: 200 }),
            )
          : Promise.reject(new TypeError('Failed to fetch')),
      ),
    )

    render()
    signIn()

    expect(await screen.findByText(/couldn't reach the server/i)).toBeInTheDocument()
  })

  /**
   * `current-password`, not `new-password`. It is what tells a password manager
   * to offer what it has rather than propose a fresh one, which is the
   * difference between signing in with one click and being locked out by a
   * manager that saved something else.
   */
  it('asks a password manager for the saved password, not a new one', () => {
    stubAuth({ status: 200, body: { user: null } })

    render()

    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute(
      'autocomplete',
      'current-password',
    )
  })

  /** Joining is creating an account, so the page has to point at signup. */
  it('sends somebody without an account to the join page', () => {
    stubAuth({ status: 200, body: { user: null } })

    render()

    expect(screen.getByRole('link', { name: /create an account/i })).toHaveAttribute(
      'href',
      '/join',
    )
  })
})
