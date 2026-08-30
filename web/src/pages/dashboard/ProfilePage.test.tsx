import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProfilePage } from './ProfilePage'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { SessionProvider } from '../../lib/auth/auth'
import type {
  ApiAccount,
  ApiSurvey,
  ApiSurveyQuestion,
  ApiUser,
} from '../../lib/api/api'
import { bodyOf, urlOf } from '../../test/stubFetch'

/**
 * The account page.
 *
 * It was a placeholder with one button on it and is now six independent writes,
 * so this suite is about the handful of things that are easy to get wrong and
 * invisible from the page itself:
 *
 *   - signing out leaves the dashboard first, or the layout answers "sign out"
 *     with a sign-in form;
 *   - the delete warning names what is actually destroyed, and the button is
 *     behind a confirmation that wants the password;
 *   - a refusal shows the server's own sentence, because only it knows which
 *     thing has to come back first;
 *   - and all three states of the one read render.
 */

const user: ApiUser = {
  id: 'u1',
  fullName: 'Rowan Test',
  email: 'rowan@ucf.edu',
  slug: null,
  role: 'MEMBER',
  discordUsername: 'rowan',
  photoUrl: null,
  photoFocalX: 50,
  photoFocalY: 50,
  photoZoom: 1,
}

const account: ApiAccount = {
  ...user,
  bio: 'Builds things.',
  gradYear: 2027,
  acknowledgementAcceptedAt: '2026-08-01T12:00:00.000Z',
  passwordSet: true,
  pendingEmail: null,
}

/** One question and one answer: enough for the panel to draw a summary. */
const questions: ApiSurveyQuestion[] = [
  {
    id: 'q-shirt',
    prompt: 'Shirt size',
    help: null,
    kind: 'SINGLE_CHOICE',
    required: true,
    allowNone: false,
    maxLength: 200,
    options: [
      { id: 'o-l', label: 'L', wantsText: false, retired: false },
      { id: 'o-xl', label: 'XL', wantsText: false, retired: false },
    ],
  },
]

const survey: ApiSurvey = {
  submittedAt: '2026-08-02T12:00:00.000Z',
  updatedAt: '2026-08-02T12:00:00.000Z',
  answers: [{ questionId: 'q-shirt', optionIds: ['o-l'], text: null }],
}

/** Stands in for `DashboardLayout`: the context, and nothing else. */
function Shell() {
  return (
    <Outlet
      context={
        {
          user,
          projects: { status: 'ready', data: [] },
          reloadProjects: () => Promise.resolve(),
          membership: { status: 'loading' },
          reloadMembership: () => Promise.resolve(),
        } satisfies DashboardContext
      }
    />
  )
}

/**
 * One stub for the whole page, because it makes two reads on mount — the
 * session and the account — and every panel writes to a different path.
 *
 * `answers` overrides a path; anything unmatched comes back `{}` with a 200,
 * which is what a write with nothing to say looks like.
 */
function stubApi(
  answers: Record<string, { status?: number; body?: unknown }> = {},
) {
  let signedIn = true

  const json = (body: unknown, status = 200) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

  const stub = vi.fn((input: string | URL | Request, _init?: RequestInit) => {
    const url = urlOf(input)

    if (url.includes('/auth/logout')) signedIn = false

    const override = Object.keys(answers).find((path) => url.includes(path))
    if (override) {
      const { status = 200, body = {} } = answers[override] ?? {}
      return json(body, status)
    }

    if (url.includes('/auth/me')) return json({ user: signedIn ? user : null })
    if (url.includes('/api/account')) return json(account)
    // The survey panel's own read. Answered, so it draws its summary — the
    // states it has of its own are covered in its own suite; here it only has
    // to be a shape the page can render.
    if (url.includes('/survey')) {
      return json({ questions, survey, gradYear: account.gradYear })
    }

    return json({})
  })

  vi.stubGlobal('fetch', stub)
  return stub
}

const renderProfile = () =>
  render(
    <MemoryRouter initialEntries={['/dashboard/profile']}>
      <SessionProvider>
        <Routes>
          <Route path="/" element={<p>the front page</p>} />
          <Route path="/login" element={<p>the login page</p>} />
          <Route path="/dashboard" element={<Shell />}>
            <Route path="profile" element={<ProfilePage />} />
          </Route>
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ProfilePage', () => {
  it('fills the panels from the account it reads', async () => {
    stubApi()
    renderProfile()

    expect(await screen.findByDisplayValue('Rowan Test')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Builds things.')).toBeInTheDocument()
    expect(screen.getByDisplayValue('2027')).toBeInTheDocument()
    expect(screen.getByDisplayValue('rowan')).toBeInTheDocument()
    // A promoted account is not a published one — the roster still wants a slug
    // an officer sets, and the page says so rather than leaving the row blank.
    expect(screen.getByText(/not on the public roster/i)).toBeInTheDocument()
  })

  /** Every remote read on this site renders all three of its states. */
  it('says so when the account cannot be read, without blanking the page', async () => {
    stubApi({ '/api/account': { status: 500 } })
    renderProfile()

    expect(
      await screen.findByText(/couldn.t load your account/i),
    ).toBeInTheDocument()
    // Still a page: the standing panel and sign-out are unaffected by it.
    expect(screen.getByRole('button', { name: /^sign out$/i })).toBeInTheDocument()
  })

  it('saves the name, bio and year in one write', async () => {
    const stub = stubApi({
      '/account/profile': {
        body: { user: { ...user, fullName: 'Rowan Renamed' } },
      },
    })
    renderProfile()

    const name = await screen.findByDisplayValue('Rowan Test')
    fireEvent.change(name, { target: { value: 'Rowan Renamed' } })

    await act(async () => {
      // Submit the form, not the button: jsdom does not carry a click on a
      // submit button through to the form's submit event.
      fireEvent.submit(name.closest('form')!)
    })

    const [, init] = stub.mock.calls.find(([input]) =>
      urlOf(input).includes('/account/profile'),
    )!

    expect(init?.method).toBe('PATCH')
    expect(bodyOf(init)).toEqual({
      fullName: 'Rowan Renamed',
      bio: 'Builds things.',
      gradYear: 2027,
    })
    expect(await screen.findByText('Saved.')).toBeInTheDocument()
  })

  /**
   * The third field is the point: nothing else can tell somebody they mistyped
   * a password they cannot see, and the cost of that typo is being locked out.
   */
  it('refuses a new password that does not match its confirmation', async () => {
    const stub = stubApi()
    renderProfile()

    const next = await screen.findByLabelText('NEW PASSWORD')
    fireEvent.change(screen.getByLabelText('CURRENT PASSWORD'), {
      target: { value: 'whatever-it-is' },
    })
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
        urlOf(input).includes('/account/password'),
      ),
    ).toBe(false)
  })

  it('says an email change is waiting rather than looking like nothing happened', async () => {
    stubApi({
      '/api/account': { body: { ...account, pendingEmail: 'new@ucf.edu' } },
    })
    renderProfile()

    expect(await screen.findByText(/waiting on/i)).toBeInTheDocument()
    expect(screen.getByText('new@ucf.edu')).toBeInTheDocument()
  })

  it('signs out and leaves the dashboard rather than the login page', async () => {
    const stub = stubApi()
    renderProfile()

    fireEvent.click(await screen.findByRole('button', { name: /^sign out$/i }))

    expect(await screen.findByText('the front page')).toBeInTheDocument()
    expect(screen.queryByText('the login page')).not.toBeInTheDocument()

    const [logout] = stub.mock.calls.filter(([input]) =>
      urlOf(input).includes('/auth/logout'),
    )
    expect(logout?.[1]?.method).toBe('POST')
  })
})

/**
 * Deleting is the one thing on this page that cannot be undone, so the warning
 * in front of it is part of the feature rather than decoration around it.
 */
describe('deleting the account', () => {
  it('names what is destroyed rather than summarising it', async () => {
    stubApi()
    renderProfile()

    expect(await screen.findByText(/cannot be undone/i)).toBeInTheDocument()
    expect(screen.getByText(/dues history/i)).toBeInTheDocument()
    expect(screen.getByText(/3D print request/i)).toBeInTheDocument()
    expect(screen.getByText(/equipment you have borrowed/i)).toBeInTheDocument()
    // And what survives it, because a term on the board is the club's record
    // rather than the member's.
    expect(screen.getByText(/stay in the club/i)).toBeInTheDocument()
  })

  it('asks again, and wants the password, before it sends anything', async () => {
    const stub = stubApi()
    renderProfile()

    fireEvent.click(
      await screen.findByRole('button', { name: 'DELETE MY ACCOUNT' }),
    )

    const dialog = screen.getByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'DELETE IT' })

    // Nothing typed yet, so the confirming button does nothing. Focus is on the
    // dismissing one, as it is everywhere `ConfirmDialog` is used.
    expect(confirm).toBeDisabled()

    fireEvent.change(within(dialog).getByLabelText(/type your password/i), {
      target: { value: 'my-password' },
    })

    await act(async () => {
      fireEvent.click(confirm)
    })

    // Found by method, not by path: the page's own read is a GET to the very
    // same URL, and matching on the path alone finds that one instead.
    const [, init] = stub.mock.calls.find(
      ([input, sent]) =>
        urlOf(input).endsWith('/api/account') && sent?.method === 'DELETE',
    )!

    expect(bodyOf(init)).toEqual({ password: 'my-password' })
  })

  /**
   * The refusals are the server's — equipment still out, a seat still held —
   * and only its sentence knows which. Paraphrasing would lose the name of the
   * thing that has to come back first.
   */
  it('shows the server’s own refusal', async () => {
    stubApi({
      'api/account': {
        status: 409,
        body: {
          error: 'You still have club equipment out — the good oscilloscope.',
        },
      },
    })
    renderProfile()

    fireEvent.click(
      await screen.findByRole('button', { name: 'DELETE MY ACCOUNT' }),
    )

    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/type your password/i), {
      target: { value: 'my-password' },
    })

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'DELETE IT' }))
    })

    expect(await screen.findByText(/the good oscilloscope/i)).toBeInTheDocument()
  })
})
