import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfficerRolesPage } from './OfficerRolesPage'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import type { ApiTerm, UserRole } from '../../lib/api/api'
import { bodyOf, urlOf } from '../../test/stubFetch'

/**
 * The roles desk: who is what, and who runs what.
 *
 * Three panels, three questions of the same shape, and the tests split along
 * the same line. Granting a term is the one that spends the club's money and is
 * the only one behind a confirmation. Appointing a project lead refuses rather
 * than swaps — the server answers 409 and the page prints its sentence, so the
 * test worth having is that the sentence survives rather than being flattened
 * into an apology. Appointing a team lead needs a project *and* a team, and the
 * people it offers are the project's roster rather than every account.
 *
 * Neither project nor member is a drop-down any more, so a test that used to
 * set a select's value now types and clicks a row. That is the whole difference
 * — the ids on the wire are the same ones.
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
    photoUrl: null,
    photoFocalX: 50,
    photoFocalY: 50,
    photoZoom: 1,
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
      surveyRequired: false,
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
    if (url.endsWith('/terms/seat')) {
      return (over.seat as Promise<Response> | undefined) ?? json({})
    }
    if (url.includes('/officer/terms/') && init?.method === 'DELETE') {
      return (over.standDown as Promise<Response> | undefined) ?? json({ closed: 1 })
    }
    if (url.endsWith('/officer/terms')) {
      return json({
        seats: (over.seats as unknown) ?? SEATS,
        board: (over.board as unknown) ?? BOARD,
      })
    }
    if (url.endsWith('/team')) return json(TEAM_VIEW)
    if (url.includes('/projects?')) return json(PROJECTS)
    return json({})
  })
}

const project = (
  id: string,
  title: string,
  termYear: number,
  termSeason: 'SPRING' | 'SUMMER' | 'FALL',
) => ({
  id,
  slug: title.toLowerCase(),
  title,
  summary: null,
  season: null,
  termYear,
  termSeason,
  competition: null,
  status: 'IN_PROGRESS',
  coverUrl: null,
  repoUrl: null,
  featured: false,
  startedAt: null,
  completedAt: null,
})

/**
 * Two terms and three builds, sent in the order `/projects` really sends them
 * — which is the landing page's order, not the picker's. The list here is what
 * makes the search worth testing at all: one title that is a prefix of nothing,
 * one older term to find by year, and two rows to tell the sort from the wire
 * order.
 */
const PROJECTS = [
  project('p3', 'Combat Bot', 2034, 'SPRING'),
  project('p1', 'Rover', 2035, 'FALL'),
  project('p2', 'Rocketry', 2035, 'FALL'),
]

/**
 * The seats there are, as the route sends them — straight out of
 * `OfficerPosition`, in board order. The frontend no longer keeps this list,
 * which is the point: a ninth seat in the schema reaches the page without a
 * frontend edit, so the fixture is what stands in for the database here.
 */
const SEATS = [
  'PRESIDENT',
  'VICE_PRESIDENT',
  'TREASURER',
  'SECRETARY',
  'MARKETING',
  'OUTREACH',
  'LAB_MANAGER',
  'FACULTY_ADVISOR',
] as const

/**
 * Today's board as the seat panel lists it. One seated officer, one on the
 * board with no chair yet — which is what the Discord sync creates before
 * anybody has been given one — and the advisor, who holds a seat as a plain
 * member.
 */
const BOARD = [
  {
    id: 'ot1',
    position: 'PRESIDENT',
    startedAt: '2035-08-01T00:00:00.000Z',
    source: 'DISCORD',
    fullName: 'Rowan Chen',
    user: { id: 'u2', fullName: 'Rowan Chen', email: 'rowan@ucf.edu', role: 'OFFICER' },
  },
  {
    id: 'ot2',
    position: null,
    startedAt: '2035-09-01T00:00:00.000Z',
    source: 'DISCORD',
    fullName: 'Sam Patel',
    user: { id: 'u3', fullName: 'Sam Patel', email: null, role: 'OFFICER' },
  },
  {
    id: 'ot3',
    position: 'FACULTY_ADVISOR',
    startedAt: '2030-01-01T00:00:00.000Z',
    source: 'MANUAL',
    fullName: 'Dr Alina Petrov',
    user: { id: 'u4', fullName: 'Dr Alina Petrov', email: null, role: 'MEMBER' },
  },
]

const grantPanel = () =>
  within(screen.getByText('GRANT A MEMBERSHIP').closest('div')!)

const seatPanel = () =>
  within(screen.getByText('THE OFFICER BOARD').closest('div')!)

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
    fireEvent.click(leadPanel().getByRole('button', { name: /^Rover/ }))
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

/**
 * The project picker, which is a search box over the list rather than a
 * drop-down of every term the club has ever run.
 *
 * Scoped to the project-lead panel; the team-lead panel below carries a second
 * copy of the same component.
 */
describe('the project picker', () => {
  const openPage = async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', stubDesk())
    renderPage()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }

  /** The current term first, and the wire order is not it. */
  it('opens on the newest term', async () => {
    await openPage()

    const rows = leadPanel()
      .getAllByRole('button')
      .map((row) => row.textContent)
      .filter((text) => text?.includes('20'))

    expect(rows).toEqual([
      'Rocketry Fall 2035',
      'Rover Fall 2035',
      'Combat Bot Spring 2034',
    ])
  })

  it('narrows on the title, and on the term', async () => {
    await openPage()

    fireEvent.change(leadPanel().getByLabelText('PROJECT'), {
      target: { value: 'rove' },
    })

    expect(
      leadPanel().getByRole('button', { name: /^Rover/ }),
    ).toBeInTheDocument()
    expect(
      leadPanel().queryByRole('button', { name: /^Rocketry/ }),
    ).not.toBeInTheDocument()

    // The term is matched as well as printed, which is the point of it being
    // there: a build that runs for years is several rows with one name.
    fireEvent.change(leadPanel().getByLabelText('PROJECT'), {
      target: { value: '2034' },
    })

    expect(
      leadPanel().getByRole('button', { name: /^Combat Bot/ }),
    ).toBeInTheDocument()
    expect(
      leadPanel().queryByRole('button', { name: /^Rover/ }),
    ).not.toBeInTheDocument()
  })

  it('says so when nothing matches', async () => {
    await openPage()

    fireEvent.change(leadPanel().getByLabelText('PROJECT'), {
      target: { value: 'submarine' },
    })

    expect(leadPanel().getByText('Nothing matches that.')).toBeInTheDocument()
  })

  /** Picking collapses the list, and CHANGE puts it back. */
  it('collapses to the choice and reopens', async () => {
    await openPage()

    fireEvent.click(leadPanel().getByRole('button', { name: /^Rover/ }))

    expect(
      leadPanel().queryByRole('button', { name: /^Rocketry/ }),
    ).not.toBeInTheDocument()
    expect(leadPanel().getByText('Rover')).toBeInTheDocument()

    fireEvent.click(leadPanel().getByRole('button', { name: 'CHANGE' }))

    expect(
      leadPanel().getByRole('button', { name: /^Rocketry/ }),
    ).toBeInTheDocument()
  })
})

describe('appointing a team lead', () => {
  const pickProject = async () => {
    fireEvent.click(teamPanel().getByRole('button', { name: /^Rover/ }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }

  /** Rowan, `u2`, who is on the roster as a plain member. */
  const pickMember = () => {
    fireEvent.click(teamPanel().getByRole('button', { name: 'Rowan Chen' }))
  }

  /**
   * The member list is the project's roster rather than every account, and that
   * is what makes the route's own rules reachable: it 404s for somebody not on
   * the project and refuses outright if the target is the project lead. The
   * search box narrows that roster; it never reaches past it.
   */
  it('offers the project roster once a project is picked', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', stubDesk())
    renderPage()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // Both say it: the team select's placeholder option and the member
    // picker's status line. Neither has anything to offer until a project is.
    expect(teamPanel().getAllByText('Pick a project first')).toHaveLength(2)

    await pickProject()

    expect(
      teamPanel().getByRole('button', { name: 'Rowan Chen' }),
    ).toBeInTheDocument()
    // Ranks are printed, so an officer can see they are about to pick the lead.
    expect(
      teamPanel().getByRole('button', { name: 'Sam Patel project lead' }),
    ).toBeInTheDocument()
    expect(
      teamPanel().getByRole('option', { name: 'Software' }),
    ).toBeInTheDocument()
  })

  it('narrows the roster as it is typed', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', stubDesk())
    renderPage()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    await pickProject()
    fireEvent.change(teamPanel().getByLabelText('MEMBER'), {
      target: { value: 'sam' },
    })

    expect(
      teamPanel().queryByRole('button', { name: 'Rowan Chen' }),
    ).not.toBeInTheDocument()
    expect(
      teamPanel().getByRole('button', { name: 'Sam Patel project lead' }),
    ).toBeInTheDocument()

    // The rank is matched on as well as printed, which is how an officer finds
    // the lead they have to stand down without knowing the name.
    fireEvent.change(teamPanel().getByLabelText('MEMBER'), {
      target: { value: 'project lead' },
    })

    expect(
      teamPanel().getByRole('button', { name: 'Sam Patel project lead' }),
    ).toBeInTheDocument()
    expect(
      teamPanel().queryByRole('button', { name: 'Rowan Chen' }),
    ).not.toBeInTheDocument()
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
    pickMember()

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
    pickMember()

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
    pickMember()

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

/**
 * The seat panel.
 *
 * The thing worth protecting here is that a **seat** and a **club role** are
 * different facts. Discord decides who is an officer; this decides which chair
 * they sit in, and it must be able to seat somebody who is not an officer at
 * all — that is how the faculty advisor is on the board — and to seat an admin,
 * which `UserRole` could never express because it has one slot per person.
 */
describe('OfficerRolesPage — the officer board', () => {
  it('lists who is on the board, seat and all', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage()

    expect(await screen.findByText('Rowan Chen')).toBeInTheDocument()

    // Scoped to the row rather than the panel: the seat `<select>` below the
    // list carries every seat name as an option, so a page-wide query for
    // "President" is ambiguous by construction.
    const rowanRow = screen.getByText('Rowan Chen').closest('li')!
    expect(within(rowanRow).getByText(/^President/)).toBeInTheDocument()

    // On the board, no chair yet. Real, and a blank line would read as a bug.
    const samRow = screen.getByText('Sam Patel').closest('li')!
    expect(within(samRow).getByText(/No seat yet/)).toBeInTheDocument()
  })

  /**
   * A hand-given seat survives losing the Discord role and a synced one does
   * not. Saying which is which is the difference between "why is the advisor
   * still here" and a bug report.
   */
  it('marks a seat that was given by hand', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage()
    await screen.findByText('Dr Alina Petrov')

    expect(seatPanel().getByText(/by hand/)).toBeInTheDocument()
  })

  it('sends the person and the seat it was given', async () => {
    vi.useFakeTimers()
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    // Deliberate flush rather than `findBy*`: this case runs on the fake clock
    // for the picker's debounce, and Testing Library polls by advancing that
    // same clock — it would spend its whole budget without the board landing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    fireEvent.change(seatPanel().getByLabelText(/who is taking a seat/i), {
      target: { value: 'rowan' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    fireEvent.click(seatPanel().getByRole('button', { name: /Rowan Chen/ }))

    fireEvent.change(seatPanel().getByLabelText(/which seat/i), {
      target: { value: 'TREASURER' },
    })
    fireEvent.click(seatPanel().getByRole('button', { name: /set the seat/i }))

    const seat = fetchMock.mock.calls.find(([input]) =>
      urlOf(input).endsWith('/terms/seat'),
    )
    expect(bodyOf(seat![1])).toEqual({
      userId: 'u2',
      position: 'TREASURER',
      // Off unless the officer confirmed a hand-over. The server refuses one it
      // was not asked for, so this default is the protection.
      takeOver: false,
    })
  })

  /**
   * Empty is a real choice rather than a prompt: somebody can be on the board
   * without a named chair, and clearing one must not read as standing them
   * down.
   */
  it('sends a null seat when the empty option is chosen', async () => {
    vi.useFakeTimers()
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    // Deliberate flush rather than `findBy*`: this case runs on the fake clock
    // for the picker's debounce, and Testing Library polls by advancing that
    // same clock — it would spend its whole budget without the board landing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    fireEvent.change(seatPanel().getByLabelText(/who is taking a seat/i), {
      target: { value: 'rowan' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    fireEvent.click(seatPanel().getByRole('button', { name: /Rowan Chen/ }))
    fireEvent.click(seatPanel().getByRole('button', { name: /set the seat/i }))

    const seat = fetchMock.mock.calls.find(([input]) =>
      urlOf(input).endsWith('/terms/seat'),
    )
    expect(bodyOf(seat![1])).toEqual({
      userId: 'u2',
      position: null,
      takeOver: false,
    })
  })

  /**
   * One person per seat, refused by the server with a sentence naming the
   * incumbent. The page must print that rather than flattening it into an
   * apology — the next step is standing that particular person down.
   */
  it('prints the server sentence when a seat is taken', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      stubDesk({
        seat: json(
          { error: 'Dana Whitfield already holds that seat. Move or stand them down first.' },
          409,
        ),
      }),
    )
    renderPage()
    // Deliberate flush rather than `findBy*`: this case runs on the fake clock
    // for the picker's debounce, and Testing Library polls by advancing that
    // same clock — it would spend its whole budget without the board landing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    fireEvent.change(seatPanel().getByLabelText(/who is taking a seat/i), {
      target: { value: 'rowan' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    fireEvent.click(seatPanel().getByRole('button', { name: /Rowan Chen/ }))
    fireEvent.click(seatPanel().getByRole('button', { name: /set the seat/i }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText(/Dana Whitfield already holds/)).toBeInTheDocument()
  })

  /** Standing down is destructive — it closes a term and publishes somebody to
      the officers page — so it confirms, and says what happens. */
  it('confirms before standing somebody down', async () => {
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await screen.findByText('Rowan Chen')

    fireEvent.click(seatPanel().getAllByRole('button', { name: /stand down/i })[0]!)

    expect(screen.getByText(/Stand Rowan Chen down\?/)).toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE'),
    ).toBe(false)
  })

  /**
   * The one thing that would make the button look broken if left unsaid: the
   * Discord role is the club's answer about who is an officer, and this does
   * not overrule it.
   */
  it('warns that a synced officer will come straight back', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage()
    await screen.findByText('Rowan Chen')

    fireEvent.click(seatPanel().getAllByRole('button', { name: /stand down/i })[0]!)

    expect(screen.getByText(/still carry the officer role in Discord/i)).toBeInTheDocument()
  })

  /** And not for one given by hand, which nothing will put back. */
  it('does not warn about a hand-appointed seat', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage()
    await screen.findByText('Dr Alina Petrov')

    const rows = seatPanel().getAllByRole('button', { name: /stand down/i })
    fireEvent.click(rows[rows.length - 1]!)

    expect(screen.getByText(/Stand Dr Alina Petrov down\?/)).toBeInTheDocument()
    expect(
      screen.queryByText(/still carry the officer role in Discord/i),
    ).not.toBeInTheDocument()
  })
})

/**
 * Rotation day.
 *
 * Flipping the Discord roles leaves the club with officers who have no chairs
 * and a front page reading "Seat open" eight times, and nothing says so. These
 * two — the work list and the one-press hand-over — are what make the handover
 * a task rather than an archaeology exercise.
 */
describe('OfficerRolesPage — handing the board over', () => {
  it('counts what is left to do, and names it while the list is short', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage()
    await screen.findByText('Rowan Chen')

    const todo = screen.getByText('STILL TO DO').closest('div')!

    // One seatless officer in the fixture board, and six of the eight seats
    // empty — only President and Faculty Advisor are held.
    expect(within(todo).getByText('1')).toBeInTheDocument()
    expect(within(todo).getByText(/Sam Patel/)).toBeInTheDocument()
    expect(within(todo).getByText('6')).toBeInTheDocument()
  })

  /** Silence when there is nothing to do. A line reading "0 officers with no
      seat" every other day is a line nobody reads on the day it matters. */
  it('says nothing when every seat is filled', async () => {
    const full = SEATS.map((seat, index) => ({
      id: `ot${String(index)}`,
      position: seat,
      startedAt: '2035-08-01T00:00:00.000Z',
      source: 'DISCORD',
      fullName: `Officer ${String(index)}`,
      user: {
        id: `u${String(index)}`,
        fullName: `Officer ${String(index)}`,
        email: null,
        role: 'OFFICER',
      },
    }))

    vi.stubGlobal('fetch', stubDesk({ board: full }))
    renderPage()
    await screen.findByText('Officer 0')

    expect(screen.queryByText('STILL TO DO')).not.toBeInTheDocument()
  })

  /**
   * The chair being handed out is occupied, so the button says so before it is
   * pressed rather than the officer discovering it through a 409.
   */
  it('offers to take a seat that somebody holds', async () => {
    vi.useFakeTimers()
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    fireEvent.change(seatPanel().getByLabelText(/who is taking a seat/i), {
      target: { value: 'rowan' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    fireEvent.click(seatPanel().getByRole('button', { name: /Rowan Chen/ }))

    // FACULTY_ADVISOR is held by Dr Alina Petrov in the fixture board.
    fireEvent.change(seatPanel().getByLabelText(/which seat/i), {
      target: { value: 'FACULTY_ADVISOR' },
    })

    expect(
      seatPanel().getByRole('button', { name: 'TAKE THE SEAT' }),
    ).toBeInTheDocument()
  })

  /** And asks first. Displacing somebody is not something to do by pressing the
      same button as an ordinary appointment. */
  it('confirms before displacing the incumbent, naming both', async () => {
    vi.useFakeTimers()
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    fireEvent.change(seatPanel().getByLabelText(/who is taking a seat/i), {
      target: { value: 'rowan' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    fireEvent.click(seatPanel().getByRole('button', { name: /Rowan Chen/ }))
    fireEvent.change(seatPanel().getByLabelText(/which seat/i), {
      target: { value: 'FACULTY_ADVISOR' },
    })
    fireEvent.click(seatPanel().getByRole('button', { name: 'TAKE THE SEAT' }))

    const dialog = screen
      .getByText(/Hand Faculty Advisor to Rowan Chen\?/)
      .closest('div')!
    // Scoped: the board row above names the incumbent too, so a page-wide query
    // is ambiguous by construction.
    expect(within(dialog).getByText(/Dr Alina Petrov/)).toBeInTheDocument()
    // Nothing sent until it is confirmed.
    expect(
      fetchMock.mock.calls.some(([input]) => urlOf(input).endsWith('/terms/seat')),
    ).toBe(false)
  })

  it('sends the take-over only once confirmed', async () => {
    vi.useFakeTimers()
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    fireEvent.change(seatPanel().getByLabelText(/who is taking a seat/i), {
      target: { value: 'rowan' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    fireEvent.click(seatPanel().getByRole('button', { name: /Rowan Chen/ }))
    fireEvent.change(seatPanel().getByLabelText(/which seat/i), {
      target: { value: 'FACULTY_ADVISOR' },
    })
    fireEvent.click(seatPanel().getByRole('button', { name: 'TAKE THE SEAT' }))
    fireEvent.click(screen.getByRole('button', { name: 'HAND IT OVER' }))

    const seat = fetchMock.mock.calls.find(([input]) =>
      urlOf(input).endsWith('/terms/seat'),
    )
    expect(bodyOf(seat![1])).toEqual({
      userId: 'u2',
      position: 'FACULTY_ADVISOR',
      takeOver: true,
    })
  })

  /** The succession, said back. Without it the officer cannot tell a hand-over
      from an ordinary appointment that happened to work. */
  it('reports who was succeeded', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      stubDesk({ seat: json({ id: 'ot9', succeeded: 'Dr Alina Petrov' }) }),
    )
    renderPage()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    fireEvent.change(seatPanel().getByLabelText(/who is taking a seat/i), {
      target: { value: 'rowan' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    fireEvent.click(seatPanel().getByRole('button', { name: /Rowan Chen/ }))
    fireEvent.change(seatPanel().getByLabelText(/which seat/i), {
      target: { value: 'FACULTY_ADVISOR' },
    })
    fireEvent.click(seatPanel().getByRole('button', { name: 'TAKE THE SEAT' }))
    fireEvent.click(screen.getByRole('button', { name: 'HAND IT OVER' }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByText(/succeeding Dr Alina Petrov/)).toBeInTheDocument()
  })

  /** Moving somebody who is already in a chair to the one they are in is not a
      hand-over with themselves. */
  it('does not offer to displace somebody by themselves', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', stubDesk({ member: { ...ROWAN, id: 'u2' } }))
    renderPage()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    fireEvent.change(seatPanel().getByLabelText(/who is taking a seat/i), {
      target: { value: 'rowan' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    fireEvent.click(seatPanel().getByRole('button', { name: /Rowan Chen/ }))

    // Rowan already holds PRESIDENT in the fixture board.
    fireEvent.change(seatPanel().getByLabelText(/which seat/i), {
      target: { value: 'PRESIDENT' },
    })

    expect(
      seatPanel().getByRole('button', { name: 'SET THE SEAT' }),
    ).toBeInTheDocument()
  })
})
