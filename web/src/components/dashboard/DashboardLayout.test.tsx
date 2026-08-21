import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DashboardLayout } from './DashboardLayout'
import { SessionProvider } from '../../lib/auth'
import type { ApiMembership, ApiMyProject, ApiTerm, ApiUser } from '../../lib/api'
import { stubFetch, stubFetchNetworkError } from '../../test/stubFetch'

/**
 * The layout is the dashboard's one session gate, so what is worth testing is
 * exactly the gate: nobody signed out sees a child page, an unreachable API is
 * named rather than treated as signed-out, and the officer-only `/ MANAGE` group
 * follows the role. The children themselves are not under test — the outlet renders a
 * plain marker instead.
 */

const user = (over: Partial<ApiUser> = {}): ApiUser => ({
  id: 'u1',
  fullName: 'Rowan Test',
  email: 'rowan@ucf.edu',
  slug: null,
  role: 'MEMBER',
  discordUsername: null,
  ...over,
})

const term: ApiTerm = {
  year: 2035,
  season: 'FALL',
  startsAt: '2035-08-24T04:00:00.000Z',
  endsAt: '2035-12-14T04:59:59.999Z',
  fromCalendar: true,
}

/** `/dues/status`, cut to the block the layout actually reads. */
const duesStatus = (over: Partial<ApiMembership> = {}) => ({
  membership: {
    status: 'ACTIVE',
    hasAccess: true,
    duesRequired: false,
    paidThrough: term.endsAt,
    freeThrough: null,
    term,
    billable: term,
    freeActive: false,
    canActivate: false,
    ...over,
  },
  plans: [],
  paymentsEnabled: false,
  history: [],
})

/**
 * `paidThrough` is deliberately a date that has genuinely gone by, unlike the
 * 2035 term above. It is what tells a member the sweep demoted apart from
 * somebody who never joined, and that reading compares against the wall clock —
 * so a "lapsed" fixture dated in the future would read as a newcomer instead.
 * Any past date stays past for ever, which is what makes this one stable.
 */
const lapsed = duesStatus({
  status: 'EXPIRED',
  hasAccess: false,
  duesRequired: true,
  paidThrough: '2024-01-15T00:00:00.000Z',
})

const myProject = (over: Partial<ApiMyProject> = {}): ApiMyProject => ({
  rank: 'MEMBER',
  title: null,
  team: null,
  // The dashboard splits MY PROJECTS on this, so every fixture has to say
  // which side it is on.
  current: true,
  project: {
    id: 'p1',
    slug: 'rover',
    title: 'Rover',
    summary: null,
    season: null,
    // Every project carries the term it is built for, and the dashboard
    // splits on it. Pinned rather than left to today's date.
    termYear: 2035,
    termSeason: 'FALL',
    competition: null,
    status: 'IN_PROGRESS',
    coverUrl: null,
    repoUrl: null,
    featured: false,
    startedAt: null,
    completedAt: null,
    meetingWeekday: null,
    meetingTime: null,
    meetingLocation: null,
  discordRoleId: null,
  },
  ...over,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const renderDashboard = () =>
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <SessionProvider>
        <Routes>
          <Route path="/login" element={<p>the login page</p>} />
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<p>overview marker</p>} />
          </Route>
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  )

describe('DashboardLayout', () => {
  it('sends a signed-out visitor to the login page', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/auth/me': { user: null } }))

    renderDashboard()

    expect(await screen.findByText('the login page')).toBeInTheDocument()
    expect(screen.queryByText('overview marker')).not.toBeInTheDocument()
  })

  it('names an unreachable API rather than treating it as signed out', async () => {
    vi.stubGlobal('fetch', stubFetchNetworkError())
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderDashboard()

    expect(
      await screen.findByText(/can't reach the server/i),
    ).toBeInTheDocument()
    expect(screen.queryByText('the login page')).not.toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('renders the child page and the base navigation for a member', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/auth/me': { user: user() },
        '/me/projects': [],
        '/dues/status': duesStatus(),
      }),
    )

    renderDashboard()

    expect(await screen.findByText('overview marker')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'OVERVIEW' })).toBeInTheDocument()
    // The `/ MANAGE` group is the officer desks, and it follows the global role
    // — cosmetics here, enforcement on the server, but the cosmetics shouldn't
    // advertise a locked door.
    expect(screen.queryByText('/ MANAGE')).not.toBeInTheDocument()
  })

  it('shows the manage group to officers', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/auth/me': { user: user({ role: 'OFFICER' }) },
        '/me/projects': [],
        '/dues/status': duesStatus(),
      }),
    )

    renderDashboard()

    expect(await screen.findByText('/ MANAGE')).toBeInTheDocument()
  })

  /**
   * Everything the rail offers has to stay inside the section. Dues was the one
   * exception and it was the wrong shape — clicking a rail link and losing the
   * rail makes the dashboard feel like a set of separate pages.
   */
  it('keeps every rail link inside the dashboard', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/auth/me': { user: user() },
        '/me/projects': [],
        '/dues/status': duesStatus(),
      }),
    )

    renderDashboard()

    for (const link of await screen.findAllByRole('link')) {
      expect(link.getAttribute('href')).toMatch(/^\/dashboard/)
    }

    expect(
      screen.getByRole('link', { name: 'DUES & PAYMENTS' }),
    ).toHaveAttribute('href', '/dashboard/dues')
  })

  /**
   * The rail's top is who you are and the way to the account page — which is
   * where signing out went when it came off the bottom of the overview.
   */
  it('heads the rail with the signed-in person', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/auth/me': { user: user({ fullName: 'Rowan Quill Test' }) },
        '/me/projects': [],
        '/dues/status': duesStatus(),
      }),
    )

    renderDashboard()

    const profile = await screen.findByRole('link', { name: /Rowan Quill Test/ })
    expect(profile).toHaveAttribute('href', '/dashboard/profile')
    // First and last, not the middle name.
    expect(profile).toHaveTextContent('RT')
  })

  it('lists my projects, with the manage link only for a lead', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/auth/me': { user: user() },
        '/dues/status': duesStatus(),
        '/me/projects': [
          myProject({ rank: 'PROJECT_LEAD' }),
          myProject({
            rank: 'MEMBER',
            project: { ...myProject().project, id: 'p2', slug: 'sub', title: 'Sub' },
          }),
        ],
      }),
    )

    renderDashboard()

    expect(await screen.findByRole('link', { name: 'ROVER' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'SUB' })).toBeInTheDocument()
    // One manage link, not two: the second membership is a plain member's.
    expect(screen.getAllByRole('link', { name: 'MANAGE' })).toHaveLength(1)
  })

  /**
   * The rail is this term only. A member three years in wants this Thursday's
   * meeting, not a history — and without the split MY PROJECTS grows for ever,
   * because a build that runs across semesters is one row per semester now.
   */
  it('lists this term only, and offers the rest as a page', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/auth/me': { user: user() },
        '/dues/status': duesStatus(),
        '/me/projects': [
          myProject(),
          myProject({
            current: false,
            project: {
              ...myProject().project,
              id: 'p2',
              slug: 'rover-old',
              title: 'Rover Old',
              termYear: 2034,
            },
          }),
        ],
      }),
    )

    renderDashboard()

    expect(await screen.findByRole('link', { name: 'ROVER' })).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'ROVER OLD' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'PAST PROJECTS' }),
    ).toHaveAttribute('href', '/dashboard/projects/past')
  })

  /**
   * A group with nothing under it reads as a list that failed to load, so the
   * gap between terms says what it is.
   */
  it('says so when nothing is running this term', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/auth/me': { user: user() },
        '/dues/status': duesStatus(),
        '/me/projects': [myProject({ current: false })],
      }),
    )

    renderDashboard()

    expect(await screen.findByText('Nothing this semester yet.')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'PAST PROJECTS' }),
    ).toBeInTheDocument()
  })

  /**
   * And no PAST PROJECTS row for somebody who has nothing behind them — the
   * group is hidden entirely, the way it always has been for a newcomer, and
   * the overview carries the prompt to join one.
   */
  it('offers no past-projects row to somebody with no past', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/auth/me': { user: user() },
        '/dues/status': duesStatus(),
        '/me/projects': [myProject()],
      }),
    )

    renderDashboard()

    await screen.findByRole('link', { name: 'ROVER' })
    expect(
      screen.queryByRole('link', { name: 'PAST PROJECTS' }),
    ).not.toBeInTheDocument()
  })
})

/**
 * Dues lapsing locks the tools and leaves everything else alone.
 *
 * Presentation only — `requireCurrentDues` on the server is what actually
 * refuses — but the rail is where somebody finds out, so what it does in this
 * state is worth pinning: the management rows stay *visible* and stop being
 * links, because a menu that quietly loses three items reads as broken rather
 * than as owed, and MY PROJECTS is untouched because they have not stopped
 * being on their projects.
 */
describe('when dues lapse', () => {
  const withDues = (role: ApiUser['role'], dues: unknown) =>
    stubFetch({
      '/auth/me': { user: user({ role }) },
      '/dues/status': dues,
      '/me/projects': [myProject({ rank: 'PROJECT_LEAD' })],
    })

  it('locks the officer desks in place rather than hiding them', async () => {
    vi.stubGlobal('fetch', withDues('OFFICER', lapsed))

    renderDashboard()

    // Waited on the padlock, not on the label: the rail renders as soon as
    // `/auth/me` lands and only locks once `/dues/status` does, so anything
    // that is true of both states resolves too early to prove either.
    expect((await screen.findAllByText('LOCKED')).length).toBeGreaterThan(0)

    // Still listed, so the group does not appear to have vanished...
    expect(screen.getByText('PRINT QUEUE')).toBeInTheDocument()
    // ...and no longer a way in.
    expect(
      screen.queryByRole('link', { name: 'PRINT QUEUE' }),
    ).not.toBeInTheDocument()
  })

  /**
   * The club's line, and the whole of it: dues owed leaves the dues page and
   * the projects you are already on, and nothing else.
   */
  it('locks printing and borrowing too, not just management', async () => {
    vi.stubGlobal('fetch', withDues('MEMBER', lapsed))

    renderDashboard()

    await screen.findAllByText('LOCKED')

    for (const label of ['3D PRINTING', 'EQUIPMENT']) {
      expect(screen.getByText(label)).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument()
    }

    // The two that stay open.
    expect(screen.getByRole('link', { name: 'DUES & PAYMENTS' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ROVER' })).toBeInTheDocument()
  })

  it("locks a lead's per-project MANAGE link", async () => {
    vi.stubGlobal('fetch', withDues('MEMBER', lapsed))

    renderDashboard()

    await screen.findAllByText('LOCKED')

    expect(screen.getByRole('link', { name: 'ROVER' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'MANAGE' })).not.toBeInTheDocument()
  })

  /** Their projects are not a management feature. */
  it('leaves MY PROJECTS alone', async () => {
    vi.stubGlobal('fetch', withDues('MEMBER', lapsed))

    renderDashboard()

    await screen.findAllByText('LOCKED')

    expect(screen.getByRole('link', { name: 'ROVER' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'OVERVIEW' })).toBeInTheDocument()
  })

  /**
   * The padlocks are the whole message here, deliberately.
   *
   * The rail used to carry a paragraph explaining the lapse as well. It was the
   * fourth place saying it — the badges show the state, the overview carries the
   * prompt to pay, and every locked page explains itself when opened — and it
   * said it on every screen, permanently, to somebody who already knew.
   */
  it('locks without a lecture about it', async () => {
    vi.stubGlobal('fetch', withDues('OFFICER', lapsed))

    renderDashboard()

    await screen.findAllByText('LOCKED')

    expect(screen.queryByText(/dues have lapsed/i)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'PAY YOUR DUES' }),
    ).not.toBeInTheDocument()
    // Still one press from the way out.
    expect(screen.getByRole('link', { name: 'DUES & PAYMENTS' })).toBeInTheDocument()
  })

  /**
   * The exception that must never regress. Whoever can fix a membership must
   * not be lockable out by one.
   */
  it('never locks an admin out', async () => {
    vi.stubGlobal('fetch', withDues('ADMIN', lapsed))

    renderDashboard()

    // The overview link is the last thing the rail paints either way, so this
    // settles the render before the absence below is asserted.
    await screen.findByRole('link', { name: 'OVERVIEW' })
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'PRINT QUEUE' })).toBeInTheDocument()
    })
    expect(screen.queryByText('LOCKED')).not.toBeInTheDocument()
  })

  /**
   * The stricter gate, and the case it exists for.
   *
   * `hasAccess: true` here — over the summer, between terms and inside the
   * trial fortnight the server says everybody is covered, because that is what
   * makes those free. Standing alone would therefore hand the printers and the
   * loan shelf to an account made ten minutes ago, so the two rows that spend
   * club money ask for a member as well.
   */
  /**
   * An unclaimed free window locks the rail exactly like an unpaid term does.
   *
   * This test used to be about a *guest*, and the rail used to lock these two
   * rows on a stricter rule than the rest. Both went: access is the dues date,
   * so a free window nobody has claimed is no access, and every locked row in
   * the rail is locked by the one condition.
   */
  it('locks printing and borrowing inside an unclaimed free window', async () => {
    vi.stubGlobal(
      'fetch',
      withDues(
        'MEMBER',
        duesStatus({
          status: 'FREE',
          hasAccess: false,
          paidThrough: null,
          canActivate: true,
        }),
      ),
    )

    renderDashboard()

    await screen.findAllByText('LOCKED')

    for (const label of ['3D PRINTING', 'EQUIPMENT']) {
      expect(screen.getByText(label)).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: label })).not.toBeInTheDocument()
    }

    // Dues stays open — it is the way out of this state, not a casualty of it.
    expect(screen.getByRole('link', { name: 'DUES & PAYMENTS' })).toBeInTheDocument()
  })

  /**
   * And the note names the way out, which differs by reason. The claim state is
   * the one that would otherwise read as a bug — the club is charging nothing
   * and the rail is still shut — so it has to say the fix is free.
   */
  it('tells somebody in a free window that the fix is one press', async () => {
    vi.stubGlobal(
      'fetch',
      withDues(
        'MEMBER',
        duesStatus({
          status: 'FREE',
          hasAccess: false,
          paidThrough: null,
          canActivate: true,
        }),
      ),
    )

    renderDashboard()

    expect(await screen.findByText(/free right now/i)).toBeInTheDocument()
    expect(screen.queryByText(/dues have lapsed/i)).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'CLAIM MY MEMBERSHIP' }),
    ).toHaveAttribute('href', '/dashboard/dues')
  })

  /** Nothing free running, and no date ever: the newcomer's wording. */
  it('tells a newcomer what membership is rather than that their dues lapsed', async () => {
    vi.stubGlobal(
      'fetch',
      withDues(
        'GUEST',
        duesStatus({
          status: 'EXPIRED',
          hasAccess: false,
          duesRequired: true,
          paidThrough: null,
          canActivate: false,
        }),
      ),
    )

    renderDashboard()

    expect(await screen.findByText(/are for members/i)).toBeInTheDocument()
    expect(screen.queryByText(/dues have lapsed/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'BECOME A MEMBER' })).toHaveAttribute(
      'href',
      '/dashboard/dues',
    )
  })

  /**
   * A demoted member is a guest, and must not be told they never joined — so
   * the newcomer's note is the one thing that stays off their rail. They get
   * the same silent padlocks a lapsed member gets, because that is what they
   * are.
   */
  it('does not offer a demoted member the newcomer’s note', async () => {
    vi.stubGlobal('fetch', withDues('GUEST', lapsed))

    renderDashboard()

    await screen.findAllByText('LOCKED')

    expect(screen.queryByText(/are for members/i)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'BECOME A MEMBER' }),
    ).not.toBeInTheDocument()
  })

  /** And nothing flashes a padlock while the standing is still on the wire. */
  it('locks nothing until the standing has actually arrived', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/auth/me': { user: user({ role: 'OFFICER' }) },
        '/me/projects': [],
        // No `/dues/status` route: the stub rejects it, so the layout's read
        // fails and the state lands on `error` rather than `ready`.
      }),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderDashboard()

    await screen.findByRole('link', { name: 'OVERVIEW' })
    await waitFor(() => {
      expect(consoleError).toHaveBeenCalled()
    })

    expect(screen.getByRole('link', { name: 'PRINT QUEUE' })).toBeInTheDocument()
    expect(screen.queryByText('LOCKED')).not.toBeInTheDocument()
    consoleError.mockRestore()
  })
})
