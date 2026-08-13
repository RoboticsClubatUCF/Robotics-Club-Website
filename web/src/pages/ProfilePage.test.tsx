import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProfilePage } from './ProfilePage'
import type { DashboardContext } from '../components/dashboard/DashboardLayout'
import { SessionProvider } from '../lib/auth'
import type { ApiUser } from '../lib/api'
import { urlOf } from '../test/stubFetch'

/**
 * The account page exists for one button. Signing out used to sit at the bottom
 * of the overview, and what this suite pins is the part that was easy to get
 * wrong when it moved: the dashboard layout bounces anyone signed out to the
 * login page, so signing out *from inside the dashboard* has to leave the
 * section first or it answers "sign out" with a sign-in form.
 */

const user: ApiUser = {
  id: 'u1',
  fullName: 'Rowan Test',
  email: 'rowan@ucf.edu',
  slug: null,
  role: 'MEMBER',
  discordUsername: 'rowan',
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

function stubApi() {
  let signedIn = true

  const stub = vi.fn((input: string | URL | Request, _init?: RequestInit) => {
    const url = urlOf(input)

    if (url.includes('/auth/logout')) signedIn = false

    return Promise.resolve(
      new Response(
        JSON.stringify(url.includes('/auth/me') ? { user: signedIn ? user : null } : {}),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
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
  it('shows what the session already knows about the account', async () => {
    stubApi()
    renderProfile()

    expect(await screen.findByText('rowan@ucf.edu')).toBeInTheDocument()
    expect(screen.getByText('rowan')).toBeInTheDocument()
    // A promoted account is not a published one — the roster still wants a slug
    // an officer sets, and the page says so rather than leaving the row blank.
    expect(screen.getByText(/not on the public roster/i)).toBeInTheDocument()
  })

  /** Disabled inputs would imply a save button is one release away. It isn't. */
  it('says editing is not built rather than pretending', async () => {
    stubApi()
    renderProfile()

    expect(await screen.findByText(/not built yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('signs out and leaves the dashboard rather than the login page', async () => {
    const stub = stubApi()
    renderProfile()

    fireEvent.click(await screen.findByRole('button', { name: /sign out/i }))

    expect(await screen.findByText('the front page')).toBeInTheDocument()
    expect(screen.queryByText('the login page')).not.toBeInTheDocument()

    const [logout] = stub.mock.calls.filter(([input]) =>
      urlOf(input).includes('/auth/logout'),
    )
    expect(logout?.[1]?.method).toBe('POST')
  })
})
