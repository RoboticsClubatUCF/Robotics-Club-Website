import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResetPasswordPage } from './ResetPasswordPage'
import { SessionProvider } from '../../lib/auth/auth'
import { bodyOf, urlOf } from '../../test/stubFetch'

/**
 * Getting back in without a password.
 *
 * One route, two halves, keyed on `?token`. What this pins is the pair of
 * properties that are easy to lose and impossible to see from the page: the
 * answer for an address with no account is the *same* answer, and a token is
 * posted rather than spent by the GET that opened the link.
 */

const SENT =
  'If there is an account for that address, a link to set a new password is on its way.'

function stubApi(answers: Record<string, { status?: number; body?: unknown }> = {}) {
  const stub = vi.fn((input: string | URL | Request, _init?: RequestInit) => {
    const url = urlOf(input)

    const override = Object.keys(answers).find((path) => url.includes(path))
    const { status = 200, body = {} } = override ? (answers[override] ?? {}) : {}

    if (url.includes('/auth/me')) {
      return Promise.resolve(
        new Response(JSON.stringify({ user: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }

    if (!override && url.includes('/auth/password/forgot')) {
      return Promise.resolve(
        new Response(JSON.stringify({ status: 'sent', message: SENT }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }

    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  vi.stubGlobal('fetch', stub)
  return stub
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>
        <Routes>
          <Route path="/login" element={<p>the login page</p>} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('asking for a link', () => {
  it('sends the address and shows the server’s own answer', async () => {
    const stub = stubApi()
    renderAt('/reset-password')

    const email = screen.getByLabelText('EMAIL')
    fireEvent.change(email, { target: { value: 'rowan@ucf.edu' } })

    await act(async () => {
      fireEvent.submit(email.closest('form')!)
    })

    const [, init] = stub.mock.calls.find(([input]) =>
      urlOf(input).includes('/auth/password/forgot'),
    )!

    expect(init?.method).toBe('POST')
    expect(bodyOf(init)).toEqual({ email: 'rowan@ucf.edu' })

    // The server's sentence, not a paraphrase: it is deliberately phrased about
    // what *would* happen, and rewording it here is how the page starts telling
    // people whether an address has an account.
    expect(await screen.findByText(SENT)).toBeInTheDocument()
  })

  /**
   * The whole security property of this page. An answer that differed for an
   * address with no account would make the form a membership lookup, one
   * address at a time — which is exactly what the sign-in form next door is
   * careful not to be.
   */
  it('says the same thing for an address that has no account', async () => {
    stubApi()
    renderAt('/reset-password')

    fireEvent.change(screen.getByLabelText('EMAIL'), {
      target: { value: 'nobody-at-all@ucf.edu' },
    })

    await act(async () => {
      fireEvent.submit(screen.getByLabelText('EMAIL').closest('form')!)
    })

    expect(await screen.findByText(SENT)).toBeInTheDocument()
  })

  it('explains a refusal rather than going quiet', async () => {
    stubApi({
      '/auth/password/forgot': {
        status: 429,
        body: { error: 'A link has already been sent to that address.' },
      },
    })
    renderAt('/reset-password')

    fireEvent.change(screen.getByLabelText('EMAIL'), {
      target: { value: 'rowan@ucf.edu' },
    })

    await act(async () => {
      fireEvent.submit(screen.getByLabelText('EMAIL').closest('form')!)
    })

    expect(await screen.findByText(/already been sent/i)).toBeInTheDocument()
  })
})

describe('setting the new one', () => {
  /**
   * Opening the link must not spend it — that is the entire reason the email
   * points at the frontend rather than at the API. Mail scanners follow every
   * URL in an incoming message.
   */
  it('does not post the token merely because the page opened', () => {
    const stub = stubApi()
    renderAt('/reset-password?token=abc123')

    expect(
      stub.mock.calls.some(([input]) =>
        urlOf(input).includes('/auth/password/reset'),
      ),
    ).toBe(false)
    expect(screen.getByLabelText('NEW PASSWORD')).toBeInTheDocument()
  })

  it('sends the token with the password, and says what happened', async () => {
    const stub = stubApi()
    renderAt('/reset-password?token=abc123')

    const next = screen.getByLabelText('NEW PASSWORD')
    fireEvent.change(next, { target: { value: 'a-long-new-password' } })
    fireEvent.change(screen.getByLabelText('NEW PASSWORD AGAIN'), {
      target: { value: 'a-long-new-password' },
    })

    await act(async () => {
      fireEvent.submit(next.closest('form')!)
    })

    const [, init] = stub.mock.calls.find(([input]) =>
      urlOf(input).includes('/auth/password/reset'),
    )!

    expect(bodyOf(init)).toEqual({
      token: 'abc123',
      password: 'a-long-new-password',
    })
    // Saying that every device was signed out is the difference between the
    // page working and somebody wondering why their phone is asking again.
    expect(await screen.findByText(/signed out/i)).toBeInTheDocument()
  })

  it('catches a mistyped confirmation before sending anything', async () => {
    const stub = stubApi()
    renderAt('/reset-password?token=abc123')

    const next = screen.getByLabelText('NEW PASSWORD')
    fireEvent.change(next, { target: { value: 'a-long-new-password' } })
    fireEvent.change(screen.getByLabelText('NEW PASSWORD AGAIN'), {
      target: { value: 'a-long-new-passwerd' },
    })

    await act(async () => {
      fireEvent.submit(next.closest('form')!)
    })

    expect(screen.getByText(/do not match/i)).toBeInTheDocument()
    expect(
      stub.mock.calls.some(([input]) =>
        urlOf(input).includes('/auth/password/reset'),
      ),
    ).toBe(false)
  })

  /** Expired, unknown and already-spent are one 410 with one sentence, and the
      page has to offer the way out rather than leaving somebody at a dead end. */
  it('shows an expired link’s refusal, and offers another', async () => {
    stubApi({
      '/auth/password/reset': {
        status: 410,
        body: {
          error:
            'That link has expired or has already been used. Ask for a new one from the sign-in page.',
        },
      },
    })
    renderAt('/reset-password?token=stale')

    const next = screen.getByLabelText('NEW PASSWORD')
    fireEvent.change(next, { target: { value: 'a-long-new-password' } })
    fireEvent.change(screen.getByLabelText('NEW PASSWORD AGAIN'), {
      target: { value: 'a-long-new-password' },
    })

    await act(async () => {
      fireEvent.submit(next.closest('form')!)
    })

    expect(await screen.findByText(/has expired/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ask for another/i })).toBeInTheDocument()
  })
})
