import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfficerRolesPage } from './OfficerRolesPage'
import type { DashboardContext } from '../components/dashboard/DashboardLayout'
import type { ApiTerm, UserRole } from '../lib/api'
import { urlOf } from '../test/stubFetch'

/**
 * The roles desk: who is what, and who runs what.
 *
 * Three panels, three questions of the same shape, and the tests split along
 * the same line. Granting a term is the one that spends the club's money and is
 * the only one behind a confirmation. Appointing a project lead refuses rather
 * than swaps — the server answers 409 and the page prints its sentence, so the
 * test worth having is that the sentence survives rather than being flattened
 * into an apology. Appointing a team lead needs a project *and* a team, and its
 * member list comes from the project's roster rather than from a search.
 *
 * The picker's own behaviour — debounce, minimum length, abort — is tested here
 * because this is the page that carries it now. Fake timers for the debounce,
 * and `advanceTimersByTimeAsync` inside `act` to flush it; never `findBy*` or
 * `waitFor` under fake timers, which would sit there advancing nothing until
 * the test times out.
 */

const term: ApiTerm = {
  year: 2035,
  season: 'FALL',
  startsAt: '2035-08-24T04:00:00.000Z',
  endsAt: '2035-12-14T04:59:59.999Z',
  fromCalendar: true,
}

const context = (role: UserRole = 'OFFICER'): DashboardContext => ({
  user: {
    id: 'u1',
    fullName: 'Officer Test',
    email: null,
    slug: null,
    role,
    discordUsername: null,
  },
  projects: { status: 'ready', data: [] },
  reloadProjects: () => Promise.resolve(),
  membership: {
    status: 'ready',
    data: {
      status: 'ACTIVE',
      hasAccess: true,
      duesRequired: false,
      paidThrough: term.endsAt,
      freeThrough: null,
      term,
      billable: term,
      freeActive: false,
      canActivate: false,
    },
  },
  reloadMembership: () => Promise.resolve(),
})

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

const renderPage = (dashboard = context()) =>
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={dashboard} />}>
          <Route path="/" element={<OfficerRolesPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

const ROWAN = {
  id: 'u2',
  fullName: 'Rowan Chen',
  email: 'rowan@ucf.edu',
  discordUsername: null,
  role: 'MEMBER' as const,
  duesPaidThrough: null,
}

const TEAM_VIEW = {
  project: { id: 'p1', slug: 'rover', title: 'Rover' },
  teams: [
    { id: 't1', name: 'Software', description: null },
    { id: 't2', name: 'Mechanical', description: null },
  ],
  members: [
    {
      userId: 'u2',
      fullName: 'Rowan Chen',
      photoUrl: null,
      title: null,
      rank: 'MEMBER' as const,
      teamId: null,
    },
    {
      userId: 'u3',
      fullName: 'Sam Patel',
      photoUrl: null,
      title: null,
      rank: 'PROJECT_LEAD' as const,
      teamId: null,
    },
  ],
}

/** Every panel's dependencies, answered the way the real desk would. */
function stubDesk(over: Record<string, unknown> = {}) {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input)

    if (url.includes('/officer/members?')) return json([over.member ?? ROWAN])
    if (url.includes('/membership') && init?.method === 'POST') {
      return (
        (over.grant as Promise<Response> | undefined) ??
        json({
          member: { id: 'u2', fullName: 'Rowan Chen' },
          paidThrough: '2035-12-14T04:59:59.999Z',
          status: 'ACTIVE',
        })
      )
    }
    if (url.endsWith('/rank')) {
      return (over.rank as Promise<Response> | undefined) ?? json({})
    }
    if (url.endsWith('/team')) return json(TEAM_VIEW)
    if (url.includes('/projects?')) {
      return json([
        {
          id: 'p1',
          slug: 'rover',
          title: 'Rover',
          summary: null,
          season: null,
          termYear: 2035,
          termSeason: 'FALL',
          competition: null,
          status: 'IN_PROGRESS',
          coverUrl: null,
          repoUrl: null,
          featured: false,
          startedAt: null,
          completedAt: null,
        },
      ])
    }
    return json({})
  })
}

const grantPanel = () =>
  within(screen.getByText('GRANT A MEMBERSHIP').closest('div')!)

const leadPanel = () =>
  within(
    screen.getByText('APPOINT OR STAND DOWN A PROJECT LEAD').closest('div')!,
  )

const teamPanel = () =>
  within(screen.getByText('APPOINT OR STAND DOWN A TEAM LEAD').closest('div')!)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('who may open it', () => {
  it('turns a member away', () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage(context('MEMBER'))

    expect(
      screen.getByText('This desk belongs to the officers.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('GRANT A MEMBERSHIP')).not.toBeInTheDocument()
  })

  it('lets an admin in', () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage(context('ADMIN'))

    expect(screen.getByText('GRANT A MEMBERSHIP')).toBeInTheDocument()
  })

  /**
   * Club role is not on this page and there is no panel missing: the board is
   * appointed in Discord and the site follows the role, so a control here would
   * be a second answer the sweep overwrites within ten minutes.
   */
  it('offers no way to make somebody an officer', () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage(context('ADMIN'))

    expect(screen.queryByText(/MAKE.*OFFICER/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/CLUB ROLE/i)).not.toBeInTheDocument()
  })
})

describe('granting a membership', () => {
  const pick = async () => {
    fireEvent.change(grantPanel().getByLabelText('WHO IS BEING COVERED'), {
      target: { value: 'rowan' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    fireEvent.click(grantPanel().getByRole('button', { name: /Rowan Chen/ }))
  }

  it('says where somebody stands before granting them anything', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', stubDesk())
    renderPage()

    await pick()

    // The whole reason `duesPaidThrough` is in the picker's answer: granting to
    // somebody already covered is harmless but blind.
    expect(
      screen.getByText('No dues on record. This is their first term.'),
    ).toBeInTheDocument()
  })

  it('says it extends when they are already covered', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      stubDesk({
        member: { ...ROWAN, duesPaidThrough: '2035-12-14T04:59:59.999Z' },
      }),
    )
    renderPage()

    await pick()

    expect(screen.getByText(/this extends it/)).toBeInTheDocument()
  })

  /** The club's money, and the only way back is another officer's database edit. */
  it('confirms before it grants anything', async () => {
    vi.useFakeTimers()
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await pick()
    fireEvent.click(grantPanel().getByRole('button', { name: 'GRANT IT' }))

    expect(
      screen.getByText('Grant Rowan Chen a semester?'),
    ).toBeInTheDocument()
    // Nothing has gone yet.
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        urlOf(input).includes('/membership'),
      ),
    ).toHaveLength(0)
  })

  it('sends the plan and prints the date it landed on', async () => {
    vi.useFakeTimers()
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await pick()
    fireEvent.change(grantPanel().getByLabelText('HOW LONG'), {
      target: { value: 'YEAR' },
    })
    fireEvent.click(grantPanel().getByRole('button', { name: 'GRANT IT' }))

    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: 'GRANT IT',
        }),
      )
      await vi.advanceTimersByTimeAsync(0)
    })

    const call = fetchMock.mock.calls.find(([input]) =>
      urlOf(input).includes('/membership'),
    )
    expect(urlOf(call![0])).toContain('/officer/members/u2/membership')
    expect(JSON.parse(call![1]!.body as string)).toEqual({ plan: 'YEAR' })

    // The date the grant *landed on*, which is the result of meeting whatever
    // they already held rather than the plan they were given.
    expect(
      screen.getByText(/Rowan Chen is covered through December 13, 2035/),
    ).toBeInTheDocument()
  })
})

describe('appointing a project lead', () => {
  const setUp = async () => {
    fireEvent.change(leadPanel().getByLabelText('PROJECT'), {
      target: { value: 'p1' },
    })
    fireEvent.change(leadPanel().getByLabelText('FIND A MEMBER'), {
      target: { value: 'rowan' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    fireEvent.click(leadPanel().getByRole('button', { name: /Rowan Chen/ }))
  }

  it('appoints, and says so', async () => {
    vi.useFakeTimers()
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    await setUp()
    await act(async () => {
      fireEvent.click(
        leadPanel().getByRole('button', { name: 'MAKE PROJECT LEAD' }),
      )
      await vi.advanceTimersByTimeAsync(0)
    })

    const call = fetchMock.mock.calls.find(([input]) =>
      urlOf(input).endsWith('/rank'),
    )
    expect(urlOf(call![0])).toContain('/officer/projects/p1/members/u2/rank')
    expect(JSON.parse(call![1]!.body as string)).toEqual({
      rank: 'PROJECT_LEAD',
    })
    expect(
      screen.getByText('Rowan Chen now leads this project.'),
    ).toBeInTheDocument()
  })

  /**
   * A project has one lead and the server refuses rather than swapping. It
   * answers 409 naming whoever is sitting there, and no code here handles that
   * case — the officer reads who it is and presses DEMOTE, the button beside
   * this one. What this asserts is that the server's sentence reaches them
   * intact rather than as a generic failure.
   */
  it('prints the server sentence naming the sitting lead', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      stubDesk({
        rank: json(
          { error: 'Sam Patel already leads this project. Stand them down first.' },
          409,
        ),
      }),
    )
    renderPage()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    await setUp()
    await act(async () => {
      fireEvent.click(
        leadPanel().getByRole('button', { name: 'MAKE PROJECT LEAD' }),
      )
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(
      screen.getByText(/Sam Patel already leads this project/),
    ).toBeInTheDocument()
  })

  it('refuses to send with nothing picked', async () => {
    vi.useFakeTimers()
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    fireEvent.click(
      leadPanel().getByRole('button', { name: 'MAKE PROJECT LEAD' }),
    )

    expect(
      leadPanel().getByText('Pick a project and a member first.'),
    ).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.filter(([input]) => urlOf(input).endsWith('/rank')),
    ).toHaveLength(0)
  })
})

describe('appointing a team lead', () => {
  const pickProject = async () => {
    fireEvent.change(teamPanel().getByLabelText('PROJECT'), {
      target: { value: 'p1' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }

  /**
   * The member list is the project's roster, not a search, and that is what
   * makes the route's own rules reachable: it 404s for somebody not on the
   * project and refuses outright if the target is the project lead.
   */
  it('offers the project roster once a project is picked', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', stubDesk())
    renderPage()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // Both selects say it, because both are empty until a project is named.
    expect(teamPanel().getAllByText('Pick a project first')).toHaveLength(2)

    await pickProject()

    expect(
      teamPanel().getByRole('option', { name: 'Rowan Chen' }),
    ).toBeInTheDocument()
    // Ranks are printed, so an officer can see they are about to pick the lead.
    expect(
      teamPanel().getByRole('option', { name: 'Sam Patel — project lead' }),
    ).toBeInTheDocument()
    expect(
      teamPanel().getByRole('option', { name: 'Software' }),
    ).toBeInTheDocument()
  })

  it('sends the rank and the team together', async () => {
    vi.useFakeTimers()
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    await pickProject()
    fireEvent.change(teamPanel().getByLabelText('TEAM'), {
      target: { value: 't1' },
    })
    fireEvent.change(teamPanel().getByLabelText('MEMBER'), {
      target: { value: 'u2' },
    })

    await act(async () => {
      fireEvent.click(
        teamPanel().getByRole('button', { name: 'MAKE TEAM LEAD' }),
      )
      await vi.advanceTimersByTimeAsync(0)
    })

    const call = fetchMock.mock.calls.find(
      ([input, init]) =>
        init?.method === 'PATCH' && urlOf(input).includes('/members/u2'),
    )
    expect(urlOf(call![0])).toContain('/projects/p1/members/u2')
    // A team lead is pinned to a team, so the rank alone would be refused.
    expect(JSON.parse(call![1]!.body as string)).toEqual({
      rank: 'TEAM_LEAD',
      teamId: 't1',
    })
    expect(screen.getByText('Rowan Chen now leads Software.')).toBeInTheDocument()
  })

  /** Demoting needs no team — the rank is the whole answer. */
  it('demotes without naming a team', async () => {
    vi.useFakeTimers()
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    await pickProject()
    fireEvent.change(teamPanel().getByLabelText('MEMBER'), {
      target: { value: 'u2' },
    })

    await act(async () => {
      fireEvent.click(
        teamPanel().getByRole('button', { name: 'DEMOTE TO MEMBER' }),
      )
      await vi.advanceTimersByTimeAsync(0)
    })

    const call = fetchMock.mock.calls.find(
      ([input, init]) =>
        init?.method === 'PATCH' && urlOf(input).includes('/members/u2'),
    )
    expect(JSON.parse(call![1]!.body as string)).toEqual({ rank: 'MEMBER' })
  })

  it('asks for a team before making anybody a team lead', async () => {
    vi.useFakeTimers()
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    await pickProject()
    fireEvent.change(teamPanel().getByLabelText('MEMBER'), {
      target: { value: 'u2' },
    })

    fireEvent.click(teamPanel().getByRole('button', { name: 'MAKE TEAM LEAD' }))

    expect(
      teamPanel().getByText('Pick a project, a team and a member first.'),
    ).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH'),
    ).toHaveLength(0)
  })
})

/**
 * The people picker, which answers as it is typed rather than on a button.
 *
 * These moved here with it from the projects desk. Scoped to the grant panel,
 * because the appointment panel below carries a second copy.
 */
describe('the member picker', () => {
  const type = async (value: string) => {
    fireEvent.change(grantPanel().getByLabelText('WHO IS BEING COVERED'), {
      target: { value },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
  }

  it('searches without being asked to, and picks from what it finds', async () => {
    vi.useFakeTimers()
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await type('rowan')

    expect(fetchMock.mock.calls.map(([input]) => urlOf(input))).toContainEqual(
      expect.stringContaining('/officer/members?query=rowan'),
    )
    fireEvent.click(grantPanel().getByRole('button', { name: /Rowan Chen/ }))
    expect(grantPanel().getByText('Rowan Chen')).toBeInTheDocument()
  })

  /** The route's own validator refuses one letter, so asking is a 400 a keystroke. */
  it('asks nothing until there are two letters', async () => {
    vi.useFakeTimers()
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await type('r')

    expect(
      fetchMock.mock.calls.filter(([input]) =>
        urlOf(input).includes('/officer/members'),
      ),
    ).toHaveLength(0)
    expect(grantPanel().getByText('Two letters or more.')).toBeInTheDocument()
  })

  /** Five keystrokes are one request, not five. */
  it('waits for the typing to stop', async () => {
    vi.useFakeTimers()
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    const field = grantPanel().getByLabelText('WHO IS BEING COVERED')
    for (const value of ['ro', 'row', 'rowa', 'rowan']) {
      fireEvent.change(field, { target: { value } })
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    expect(
      fetchMock.mock.calls.filter(([input]) =>
        urlOf(input).includes('/officer/members'),
      ),
    ).toHaveLength(1)
  })
})
