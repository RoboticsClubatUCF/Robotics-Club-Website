import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignupFinish } from './SignupFinish'
import {
  bodyOf,
  stubFetch,
  stubFetchPending,
  stubFetchStatus,
  urlOf,
} from '../../test/stubFetch'

/**
 * The second step: everything except the address, which came from the link.
 *
 * The parts worth pinning down are the ones that would otherwise fail quietly.
 * The address must come from the token rather than from a field, or the whole
 * verification was theatre. The password must not reach the server unless it
 * was typed the same way twice. And a spent link has to be recoverable —
 * telling somebody their link expired without a way to get another one strands
 * them on a form they have just filled in.
 */

const CREATED = { '/signup/complete': { id: 'u1', status: 'created' } }

const renderFinish = (onCreated = vi.fn()) => {
  render(
    <SignupFinish
      email="knightro@ucf.edu"
      token="a-good-token"
      onCreated={onCreated}
    />,
    { wrapper: MemoryRouter },
  )

  return onCreated
}

/**
 * The defaults are annotated rather than inferred: `confirm` defaults to
 * `password`, and TypeScript will not infer a binding from a sibling in the
 * same pattern.
 */
async function fill({
  password = 'a-long-enough-password',
  confirm = password,
  handle = 'phibiscool',
}: { password?: string; confirm?: string; handle?: string } = {}) {
  fireEvent.change(screen.getByLabelText(/FIRST NAME/i), {
    target: { value: 'Test' },
  })
  fireEvent.change(screen.getByLabelText(/LAST NAME/i), {
    target: { value: 'Knight' },
  })
  fireEvent.change(screen.getByLabelText(/^PASSWORD/i), {
    target: { value: password },
  })
  fireEvent.change(screen.getByLabelText(/CONFIRM PASSWORD/i), {
    target: { value: confirm },
  })
  fireEvent.change(screen.getByLabelText(/DISCORD USERNAME/i), {
    target: { value: handle },
  })

  // Let the handle field's debounced check run, so it is not still in flight
  // when the form is submitted.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000)
  })
}

const submit = () =>
  fireEvent.submit(screen.getByRole('button', { name: /create my account/i }))

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('SignupFinish', () => {
  it('shows which address the account is being made for', () => {
    vi.stubGlobal('fetch', stubFetch({}))
    renderFinish()

    expect(screen.getByText('knightro@ucf.edu')).toBeInTheDocument()
    // And does not offer it as something to change: it came from the link.
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
  })

  it('puts the invite in front of the field that needs it', () => {
    vi.stubGlobal('fetch', stubFetch({}))
    renderFinish()

    expect(
      screen.getByText(/make sure you are in the club discord/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: /qr code linking to .* discord invite/i }),
    ).toBeInTheDocument()
  })

  it('sends the token and the fields, and never an address', async () => {
    const fetchStub = stubFetch({
      '/signup/discord-check': { status: 'connected', username: 'phibiscool' },
      ...CREATED,
    })
    vi.stubGlobal('fetch', fetchStub)

    const onCreated = renderFinish()
    await fill()
    submit()

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled()
    })

    const complete = fetchStub.mock.calls.find(([url]) =>
      urlOf(url).includes('/signup/complete'),
    )!
    expect(bodyOf(complete[1])).toEqual({
      token: 'a-good-token',
      firstName: 'Test',
      lastName: 'Knight',
      password: 'a-long-enough-password',
      discordUsername: 'phibiscool',
    })
  })

  /**
   * Caught here rather than by the server, which has no way to know: it only
   * ever receives one of the two. A mistyped password on an account nobody can
   * sign into yet is a mistake that surfaces months later.
   */
  it('will not send a password that was typed differently twice', async () => {
    const fetchStub = stubFetch(CREATED)
    vi.stubGlobal('fetch', fetchStub)

    renderFinish()
    await fill({ password: 'a-long-enough-password', confirm: 'something-else' })
    submit()

    expect(await screen.findByText(/do not match/i)).toBeInTheDocument()
    expect(
      fetchStub.mock.calls.filter(([url]) =>
        urlOf(url).includes('/signup/complete'),
      ),
    ).toHaveLength(0)
  })

  /**
   * A spent link cannot be fixed by correcting a field, so this is the one
   * failure that has to offer a way out rather than an explanation.
   */
  it('offers a way to start again when the link has expired', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetchStatus(410, {
        error: 'That link has expired or has already been used.',
      }),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderFinish()
    await fill()
    submit()

    expect(await screen.findByText(/has expired/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /start again/i })).toHaveAttribute(
      'href',
      '/join',
    )
    consoleError.mockRestore()
  })

  /** Which of two unique fields was taken is something only the server knows. */
  it('passes a conflict on in the server’s own words', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetchStatus(409, {
        error: 'That Discord username is already connected to another account.',
      }),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderFinish()
    await fill()
    submit()

    expect(
      await screen.findByText(/already connected to another account/i),
    ).toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('says the server is unreachable rather than blaming the form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderFinish()
    await fill()
    submit()

    expect(await screen.findByText(/couldn't reach the server/i)).toBeInTheDocument()
    // The names are still there, so a failure costs nobody the form.
    expect(screen.getByLabelText(/FIRST NAME/i)).toHaveValue('Test')
    consoleError.mockRestore()
  })

  /** One account, however many times the button is pressed. */
  it('refuses to submit twice while the first is in flight', async () => {
    const fetchStub = stubFetchPending()
    vi.stubGlobal('fetch', fetchStub)

    renderFinish()
    await fill()
    submit()

    const button = screen.getByRole('button', { name: /creating/i })
    await waitFor(() => {
      expect(button).toBeDisabled()
    })

    fireEvent.submit(button)
    expect(
      fetchStub.mock.calls.filter(([url]) =>
        urlOf(url).includes('/signup/complete'),
      ),
    ).toHaveLength(1)
  })
})
