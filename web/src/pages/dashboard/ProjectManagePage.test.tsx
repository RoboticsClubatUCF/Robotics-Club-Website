import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectManagePage } from './ProjectManagePage'
import type { ManagePart } from '../../lib/dashboard/subPages'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import type {
  ApiManagedProject,
  ApiMeEvent,
  ApiMeetingSeries,
  ApiMyProject,
  ApiProjectTeamView,
  ApiTerm,
  UserRole,
} from '../../lib/api/api'
import { urlOf } from '../../test/stubFetch'

/**
 * The manage page, narrowed to the one section on it that reaches outside this website.
 *
 * Everything else here — members, teams, events, tasks — changes rows the site owns, and a mistake
 * shows up on a page somebody can go and fix. The Discord role hands out and takes away access to
 * a channel for everybody on the project at once, from a text box with a number in it. So what's
 * worth asserting is narrow: that the box shows what's actually stored, that saving sends the
 * right shape, and that emptying it sends `null` rather than an empty string — because `''` and
 * `null` would be two spellings of "no role" and only one means it.
 */

const term: ApiTerm = {
  year: 2035,
  season: 'FALL',
  startsAt: '2035-08-24T04:00:00.000Z',
  endsAt: '2035-12-14T04:59:59.999Z',
  fromCalendar: true,
}

const project: ApiManagedProject = {
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
  coverFromGallery: false,
  coverFocalX: 50,
  coverFocalY: 50,
  coverZoom: 1,
  galleryHeading: null,
  resourcesHeading: null,
  teamHeading: null,
  featured: false,
  startedAt: null,
  completedAt: null,
  meetingRepeat: null,
  meetingWeekdays: [],
  meetingInterval: 1,
  meetingMonthWeeks: [],
  meetingMonthDays: [],
  meetingDates: [],
  meetingStartsOn: null,
  meetingStartTime: null,
  meetingEndTime: null,
  meetingTimes: [],
  meetingLocation: null,
  meetingDescription: null,
  meetingsPublic: true,
  discordRoleId: null,
}

const lead: ApiMyProject = {
  publiclyListed: true,
  rank: 'PROJECT_LEAD',
  title: null,
  team: null,
  current: true,
  project,
}

const context = (role: UserRole = 'MEMBER'): DashboardContext => ({
  user: {
    id: 'u1',
    fullName: 'Lead Test',
    email: null,
    slug: null,
    role,
    discordUsername: null,
    photoUrl: null,
    photoFocalX: 50,
    photoFocalY: 50,
    photoZoom: 1,
  },
  projects: { status: 'ready', data: [lead] },
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
      surveyPending: false,
      surveyPromptDismissed: false,
      slicerTrained: true,
      printOperator: false,
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

/** The team view the page loads, with whatever role id the test is about. */
const stubDesk = (discordRoleId: string | null = null) =>
  vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input)

    if (url.includes('/team')) {
      return json({
        project: { ...project, discordRoleId },
        teams: [],
        members: [],
      })
    }
    if (init?.method === 'PATCH') return json({ ...project, discordRoleId })

    return json([])
  })

/** Each block names the sub-page its section lives on. */
const renderPage = (
  fetchMock: ReturnType<typeof stubDesk>,
  part: ManagePart = 'members',
) => {
  vi.stubGlobal('fetch', fetchMock)

  return render(
    <MemoryRouter initialEntries={['/rover']}>
      <Routes>
        <Route element={<Outlet context={context()} />}>
          <Route path="/:slug" element={<ProjectManagePage part={part} />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

const panel = () =>
  within(screen.getByText('DISCORD ROLE').closest('div')!)

const patchBody = (fetchMock: ReturnType<typeof stubDesk>) => {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')
  expect(call).toBeDefined()
  return JSON.parse(call![1]!.body as string) as Record<string, unknown>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('public roster approvals', () => {
  function renderRoster(teamLead = false, refuse = false) {
    const data: ApiProjectTeamView = {
      project,
      teams: [
        { id: 't1', name: 'Software', description: null },
        { id: 't2', name: 'Hardware', description: null },
      ],
      members: [
        {
          userId: 'u1',
          fullName: 'Lead Test',
          rank: teamLead ? 'TEAM_LEAD' : 'PROJECT_LEAD',
          teamId: teamLead ? 't1' : null,
          photoUrl: null,
          title: null,
          publiclyListed: true,
        },
        {
          userId: 'u2',
          fullName: 'Rowan Chen',
          rank: 'MEMBER',
          teamId: 't1',
          photoUrl: null,
          title: null,
          publiclyListed: false,
        },
        {
          userId: 'u3',
          fullName: 'Ada Lovelace',
          rank: 'MEMBER',
          teamId: 't2',
          photoUrl: null,
          title: null,
          publiclyListed: true,
        },
        {
          userId: 'u4',
          fullName: 'Grace Hopper',
          rank: 'MEMBER',
          teamId: null,
          photoUrl: null,
          title: null,
          publiclyListed: false,
        },
      ],
    }
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.endsWith('/projects/p1/team')) return json(data)
      if (url.endsWith('/visibility') && init?.method === 'PATCH') {
        if (refuse) return json({ error: 'Only your own team can be approved.' }, 403)
        const id = url.split('/members/')[1]!.split('/')[0]
        const member = data.members.find((row) => row.userId === id)!
        const patch = JSON.parse(init.body as string) as { publiclyListed: boolean }
        member.publiclyListed = patch.publiclyListed
        return json({ userId: id, ...patch })
      }
      return json([])
    })
    vi.stubGlobal('fetch', fetchMock)
    const ctx = context()
    if (teamLead)
      ctx.projects = {
        status: 'ready',
        data: [{ ...lead, rank: 'TEAM_LEAD', team: { id: 't1', name: 'Software' } }],
      }
    render(
      <MemoryRouter initialEntries={['/rover']}>
        <Routes>
          <Route element={<Outlet context={ctx} />}>
            <Route path="/:slug" element={<ProjectManagePage part="members" />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    return fetchMock
  }

  it('filters pending members and approves or hides them with a separate visibility request', async () => {
    const fetchMock = renderRoster()
    await screen.findByRole('button', { name: 'Approve Rowan Chen for public website' })
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Awaiting public listing only/ }),
    )
    expect(
      screen.queryByRole('button', { name: 'Hide Ada Lovelace on public website' }),
    ).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: 'Approve Rowan Chen for public website' }),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Approve Rowan Chen for public website' }),
      ).toBeNull(),
    )
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Awaiting public listing only/ }),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Hide Rowan Chen on public website' }),
    )
    await screen.findByRole('button', { name: 'Approve Rowan Chen for public website' })
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')
    const refreshes = fetchMock.mock.calls.filter(([input]) => urlOf(input).endsWith('/projects/rover'))
    expect(refreshes).toHaveLength(2)
    expect(refreshes.every(([, init]) => init?.cache === 'reload')).toBe(true)
    expect(
      writes.map(([url, init]) => [
        urlOf(url).split('/api')[1],
        JSON.parse(init!.body as string),
      ]),
    ).toEqual([
      ['/projects/p1/members/u2/visibility', { publiclyListed: true }],
      ['/projects/p1/members/u2/visibility', { publiclyListed: false }],
    ])
    expect(screen.getByRole('combobox', { name: 'Team for Rowan Chen' })).toHaveValue(
      't1',
    )
  })

  it('gives a team lead approval controls only for their own ordinary members', async () => {
    const fetchMock = renderRoster(true)
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Approve Rowan Chen for public website',
      }),
    )
    expect(
      await screen.findByRole('button', { name: 'Hide Rowan Chen on public website' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Ada Lovelace.*public website/ }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: /Grace Hopper.*public website/ }),
    ).toBeNull()
    expect(screen.queryByRole('button', { name: /Lead Test.*public website/ })).toBeNull()
    const write = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!
    expect(urlOf(write[0])).toContain('/projects/p1/members/u2/visibility')
  })

  it('keeps a refused approval pending and shows the server explanation', async () => {
    renderRoster(false, true)
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Approve Rowan Chen for public website',
      }),
    )
    expect(
      await screen.findByText('Only your own team can be approved.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Approve Rowan Chen for public website' }),
    ).toBeEnabled()
  })
})

describe('the project Discord role', () => {
  it('shows the role the project is actually carrying', async () => {
    const fetchMock = stubDesk('984535585270157362')
    renderPage(fetchMock, 'settings')
    await act(async () => {})

    expect(panel().getByLabelText('ROLE ID')).toHaveValue('984535585270157362')
  })

  it('saves a pasted role id', async () => {
    const fetchMock = stubDesk()
    renderPage(fetchMock, 'settings')
    await act(async () => {})

    fireEvent.change(panel().getByLabelText('ROLE ID'), {
      target: { value: '984535585270157362' },
    })

    await act(async () => {
      fireEvent.submit(
        panel().getByRole('button', { name: 'SAVE' }).closest('form')!,
      )
    })

    expect(patchBody(fetchMock)).toEqual({
      discordRoleId: '984535585270157362',
    })
    expect(panel().getByText('Saved.')).toBeInTheDocument()
  })

  it('clears the role with null rather than an empty string', async () => {
    // Two spellings of "no role" is a difference nobody can see and every
    // reader has to handle. The column takes null.
    const fetchMock = stubDesk('984535585270157362')
    renderPage(fetchMock, 'settings')
    await act(async () => {})

    fireEvent.change(panel().getByLabelText('ROLE ID'), {
      target: { value: '  ' },
    })

    await act(async () => {
      fireEvent.submit(
        panel().getByRole('button', { name: 'SAVE' }).closest('form')!,
      )
    })

    expect(patchBody(fetchMock)).toEqual({ discordRoleId: null })
  })

  it('says what the field does, because pressing SAVE changes what people can see', async () => {
    renderPage(stubDesk(), 'settings')
    await act(async () => {})

    expect(
      screen.getByText(/loses it when they leave/i),
    ).toBeInTheDocument()
  })

  it('reports a role the server does not recognise', async () => {
    // The server checks a pasted id against the guild's real roles, because a
    // wrong snowflake is not an error at Discord and would match nobody for
    // ever. The page has to show that answer rather than swallowing it.
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) =>
      urlOf(input).includes('/team')
        ? json({ project, teams: [], members: [] })
        : init?.method === 'PATCH'
          ? json(
              { error: 'No role with that id in the club’s Discord server.' },
              422,
            )
          : json([]),
    )
    renderPage(fetchMock as unknown as ReturnType<typeof stubDesk>, 'settings')
    await act(async () => {})

    fireEvent.change(panel().getByLabelText('ROLE ID'), {
      target: { value: '111111111111111111' },
    })

    await act(async () => {
      fireEvent.submit(
        panel().getByRole('button', { name: 'SAVE' }).closest('form')!,
      )
    })

    expect(
      panel().getByText(/No role with that id/),
    ).toBeInTheDocument()
  })

  /**
   * The refusal that matters more than a typo. A project's role is added and removed as people
   * join and leave it, so a project pointed at the club's Members role takes membership off the
   * first person to leave — and unlike the check above, the server makes this one whether or not
   * Discord is reachable.
   */
  it('reports a club role being pasted, in the server’s own words', async () => {
    const refusal =
      'That is the club’s Members role, which the site hands out itself.'
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) =>
      urlOf(input).includes('/team')
        ? json({ project, teams: [], members: [] })
        : init?.method === 'PATCH'
          ? json({ error: refusal }, 422)
          : json([]),
    )
    renderPage(fetchMock as unknown as ReturnType<typeof stubDesk>, 'settings')
    await act(async () => {})

    fireEvent.change(panel().getByLabelText('ROLE ID'), {
      target: { value: '222222222222222222' },
    })

    await act(async () => {
      fireEvent.submit(
        panel().getByRole('button', { name: 'SAVE' }).closest('form')!,
      )
    })

    expect(panel().getByText(/hands out itself/)).toBeInTheDocument()
  })

  /**
   * Finding a role id is a four-step job in another application, and the field
   * used to carry only the last step of it. The guide is a disclosure so the
   * panel stays short for the people who already know.
   */
  it('keeps the how-to behind a disclosure, closed', async () => {
    renderPage(stubDesk(), 'settings')
    await screen.findByText('DISCORD ROLE')

    const guide = screen.getByText('WHERE DO I FIND THIS?')
    expect(guide.closest('details')).not.toHaveAttribute('open')

    // Closed, not unmounted: a `<details>` keeps its content findable by the
    // browser's own in-page search, which is half the reason it is one.
    expect(screen.getAllByText(/Developer Mode/).length).toBeGreaterThan(0)
  })

  /** The half of the guide that is not instructions, and the half that stops
      somebody meeting the server's refusal at all. */
  it('warns against the club’s own roles, and against ranking', async () => {
    renderPage(stubDesk(), 'settings')
    await screen.findByText('DISCORD ROLE')

    expect(screen.getByText(/Not one of the club/)).toBeInTheDocument()
    expect(
      screen.getByText(/Members, Project Lead, Team Lead, Officers/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Not a role above the bot/)).toBeInTheDocument()
  })
})

describe('a finished build takes no new tasks', () => {
  /** The same desk, for a project stamped to a term that has been and gone. */
  const stubOldDesk = () =>
    vi.fn((input: string | URL | Request) => {
      const url = urlOf(input)

      if (url.includes('/team')) {
        return json({
          project: { ...project, termYear: 2020, termSeason: 'SPRING' },
          teams: [],
          members: [],
        })
      }

      return json([])
    })

  it('replaces the form with a sentence, and keeps the board', async () => {
    renderPage(stubOldDesk() as unknown as ReturnType<typeof stubDesk>, 'tasks')

    // The server answers 409 for a new task here, so the page says so instead
    // of drawing a form whose button could only be refused.
    expect(
      await screen.findByText(/not running this semester, so it takes no new tasks/i),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Task title')).not.toBeInTheDocument()

    // TASKS is still a panel — what is on the board stays readable and
    // tickable, which is how a semester actually ends.
    expect(screen.getByText('TASKS', { selector: 'p' })).toBeInTheDocument()
  })

  it('draws the form for this semester’s build', async () => {
    renderPage(stubDesk(), 'tasks')

    // The fixture project and the fixture term are both FALL 2035, so this is
    // the ordinary case and the form is there.
    expect(await screen.findByLabelText('Task title')).toBeInTheDocument()
    expect(
      screen.queryByText(/not running this semester/i),
    ).not.toBeInTheDocument()
  })
})


/**
 * The desk with two teams on it.
 *
 * **The method is checked before the path, and that ordering is the whole
 * trick.** `/api/teams/t1` contains `/team`, so the path-only match the rest of
 * this file uses would answer a team write with the roster and the assertion
 * would be about the wrong request.
 */
const stubTeams = () =>
  vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input)

    if (init?.method === 'PATCH' || init?.method === 'POST') {
      return json({ id: 't1', name: 'Chassis', description: null })
    }
    if (url.includes('/projects/p1/team')) {
      return json({
        project,
        teams: [
          { id: 't1', name: 'Chassis', description: 'Frame and drivetrain.' },
          { id: 't2', name: 'Software', description: null },
        ],
        members: [],
      })
    }

    return json([])
  })

// The panel's label, not the sub-page link of the same name.
const teams = () =>
  within(screen.getByText('TEAMS', { selector: 'p' }).closest('div')!)

const wrote = (fetchMock: ReturnType<typeof stubTeams>, method: string) =>
  fetchMock.mock.calls.find(([, init]) => init?.method === method)

/**
 * Teams, which a project lead makes and unmakes.
 *
 * The rename and the description are what these cover, because they're what the page couldn't do
 * at all: `PATCH /api/teams/:id` has always existed and nothing in the browser called it, so
 * `Team.description` was a column the site displayed and could never write.
 */
describe('a project lead editing teams', () => {
  it('opens a team with the name and description it is carrying', async () => {
    renderPage(stubTeams(), 'teams')
    await act(async () => {})

    const panel = teams()
    fireEvent.click(panel.getAllByRole('button', { name: 'EDIT' })[0]!)

    expect(panel.getByLabelText('Name for Chassis')).toHaveValue('Chassis')
    expect(panel.getByLabelText('Description for Chassis')).toHaveValue(
      'Frame and drivetrain.',
    )
  })

  it('saves a rename and a description together', async () => {
    const fetchMock = stubTeams()
    renderPage(fetchMock, 'teams')
    await act(async () => {})

    const panel = teams()
    fireEvent.click(panel.getAllByRole('button', { name: 'EDIT' })[0]!)
    fireEvent.change(panel.getByLabelText('Name for Chassis'), {
      target: { value: 'Chassis & Drive' },
    })
    fireEvent.change(panel.getByLabelText('Description for Chassis'), {
      target: { value: 'Frame, drivetrain, welding.' },
    })

    await act(async () => {
      fireEvent.submit(
        panel.getByRole('button', { name: 'SAVE' }).closest('form')!,
      )
    })

    const call = wrote(fetchMock, 'PATCH')
    expect(call).toBeDefined()
    expect(urlOf(call![0])).toContain('/teams/t1')
    expect(JSON.parse(call![1]!.body as string)).toEqual({
      name: 'Chassis & Drive',
      description: 'Frame, drivetrain, welding.',
    })
  })

  it('sends null rather than an empty string for a cleared description', async () => {
    const fetchMock = stubTeams()
    renderPage(fetchMock, 'teams')
    await act(async () => {})

    const panel = teams()
    fireEvent.click(panel.getAllByRole('button', { name: 'EDIT' })[0]!)
    fireEvent.change(panel.getByLabelText('Description for Chassis'), {
      target: { value: '   ' },
    })

    await act(async () => {
      fireEvent.submit(
        panel.getByRole('button', { name: 'SAVE' }).closest('form')!,
      )
    })

    // Same reasoning as the Discord role above: '' and null would be two
    // spellings of "no description" and only one of them means it.
    expect(JSON.parse(wrote(fetchMock, 'PATCH')![1]!.body as string)).toEqual({
      name: 'Chassis',
      description: null,
    })
  })

  it('cancels back to the row without writing anything', async () => {
    const fetchMock = stubTeams()
    renderPage(fetchMock, 'teams')
    await act(async () => {})

    const panel = teams()
    fireEvent.click(panel.getAllByRole('button', { name: 'EDIT' })[0]!)
    fireEvent.change(panel.getByLabelText('Name for Chassis'), {
      target: { value: 'Nonsense' },
    })
    fireEvent.click(panel.getByRole('button', { name: 'CANCEL' }))

    expect(panel.queryByLabelText('Name for Chassis')).not.toBeInTheDocument()
    expect(panel.getAllByRole('button', { name: 'EDIT' })).toHaveLength(2)
    expect(wrote(fetchMock, 'PATCH')).toBeUndefined()
  })

  it('creates a team with the description typed beside it', async () => {
    const fetchMock = stubTeams()
    renderPage(fetchMock, 'teams')
    await act(async () => {})

    const panel = teams()
    fireEvent.change(panel.getByLabelText('NEW TEAM'), {
      target: { value: 'Outreach' },
    })
    fireEvent.change(panel.getByLabelText('New team description'), {
      target: { value: 'Schools, demos, and the tent at Spark.' },
    })

    await act(async () => {
      fireEvent.submit(
        panel.getByRole('button', { name: 'CREATE' }).closest('form')!,
      )
    })

    const call = wrote(fetchMock, 'POST')
    expect(call).toBeDefined()
    expect(urlOf(call![0])).toContain('/projects/p1/teams')
    expect(JSON.parse(call![1]!.body as string)).toEqual({
      name: 'Outreach',
      description: 'Schools, demos, and the tent at Spark.',
    })
  })
})

/**
 * The one control on this page that destroys something no copy exists of.
 *
 * It was the word DANGER in grey over a text-link button that turned red only on hover — the same
 * weight the page gives REMOVE on a single task. It's drawn as the destructive panel it is now.
 */
describe('deleting a project', () => {
  const openPage = async () => {
    renderPage(stubDesk(), 'settings')
    await screen.findByText('DISCORD ROLE')
  }

  it('says who it affects, and that it cannot be undone', async () => {
    await openPage()

    expect(screen.getByText(/deletes Rover for/i)).toBeInTheDocument()
    expect(screen.getByText('everyone on it')).toBeInTheDocument()
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument()
  })

  /* Named one by one rather than summarised: a lead is entitled to delete all
     of this and is not entitled to be surprised by it. The files are the line
     that matters — those bytes have no other copy. */
  it('names what goes with it, the files included', async () => {
    await openPage()

    expect(screen.getByText(/its roster and its teams/i)).toBeInTheDocument()
    expect(screen.getByText(/every event it has scheduled/i)).toBeInTheDocument()
    expect(screen.getByText(/keeps no\s+other copy of those files/i)).toBeInTheDocument()
  })

  /** The way out for the common case, which is a build that has simply ended. */
  it('points at archiving instead', async () => {
    await openPage()

    expect(screen.getByText('ARCHIVED')).toBeInTheDocument()
  })

  it('says the confirmation is coming before the press', async () => {
    await openPage()

    expect(
      screen.getByText(/asked to type the project’s name/i),
    ).toBeInTheDocument()
  })
})

/**
 * The meeting schedule and the meetings it makes.
 *
 * The schedule is one pattern at a time, and the form only sends that pattern's fields. The
 * list below it is where a lead calls one meeting off, which is keyed on the campus date.
 */

const scheduled: ApiManagedProject = {
  ...project,
  meetingRepeat: 'WEEKLY',
  meetingWeekdays: [2, 4],
  meetingStartTime: '18:00',
  meetingEndTime: '22:00',
  meetingTimes: [],
  meetingLocation: 'ENG2 Lab',
}

const series: ApiMeetingSeries = {
  projectSlug: 'rover',
  projectTitle: 'Rover',
  repeat: 'WEEKLY',
  weekdays: [2, 4],
  interval: 1,
  monthWeeks: [],
  monthDays: [],
  dates: [],
  startTime: '18:00',
  endTime: '22:00',
  location: 'ENG2 Lab',
  untilDate: term.endsAt,
  skip: null,
  skipDates: [],
  cancelledDates: [],
  hours: [],
}

/** Fall 2035 as the term route answers: classes from 24 August, finals 7 to 13 December. */
const fallTerm = {
  year: 2035,
  season: 'FALL',
  startsAt: '2035-08-24T04:00:00.000Z',
  endsAt: '2035-12-14T04:59:59.999Z',
  finalsStartAt: '2035-12-07T05:00:00.000Z',
  finalsEndAt: '2035-12-14T04:59:59.999Z',
}

/** Six in the evening on campus, which is 22:00Z while daylight saving lasts. */
const occurrence = (
  day: string,
  cancelled: { reason: string | null } | null = null,
): ApiMeEvent => ({
  id: `meeting:p1:${day}T22:00:00.000Z`,
  slug: 'rover',
  title: 'Rover meeting',
  description: null,
  type: 'MEETING',
  location: 'ENG2 Lab',
  startsAt: `${day}T22:00:00.000Z`,
  endsAt: `${day}T02:00:00.000Z`,
  allDay: false,
  registrationUrl: null,
  meeting: series,
  cancelled,
  published: true,
  projectId: 'p1',
  teamId: null,
  createdById: null,
  project: { slug: 'rover', title: 'Rover' },
  team: null,
})

const stubMeetings = (
  meetings: unknown = [
    occurrence('2035-10-16'),
    occurrence('2035-10-18', { reason: 'Homecoming' }),
  ],
  status = 200,
  term: 'ready' | 'failed' | 'pending' = 'ready',
) =>
  vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input)

    if (url.includes('/team')) {
      return json({ project: scheduled, teams: [], members: [] })
    }
    if (url.includes('/terms/')) {
      if (term === 'pending') return new Promise<Response>(() => {})
      return term === 'failed' ? json({ error: 'down' }, 503) : json(fallTerm)
    }
    if (url.includes('/cancel')) return json({})
    if (url.includes('/meetings')) return json(meetings, status)
    if (init?.method === 'PATCH') {
      return json({ ...scheduled, ...(JSON.parse(init.body as string) as object) })
    }

    return json([])
  })

const schedulePanel = () =>
  within(screen.getByText('MEETING SCHEDULE').closest('div')!)

const meetingsPanel = () =>
  within(screen.getByText('UPCOMING MEETINGS').closest('div')!)

const saveSchedule = () =>
  act(async () => {
    fireEvent.submit(
      schedulePanel().getByRole('button', { name: 'SAVE' }).closest('form')!,
    )
  })

describe('the meeting schedule', () => {
  it('needs a first date for every other week, then saves it', async () => {
    const fetchMock = stubMeetings()
    renderPage(fetchMock, 'meetings')
    await act(async () => {})

    fireEvent.change(schedulePanel().getByLabelText('EVERY'), {
      target: { value: '2' },
    })
    expect(
      schedulePanel().getByText('Meets every other Tuesday and Thursday · 6:00 – 10:00 PM.'),
    ).toBeInTheDocument()

    await saveSchedule()
    expect(schedulePanel().getByText(/first meeting/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(
      false,
    )

    fireEvent.change(schedulePanel().getByLabelText('FIRST MEETING'), {
      target: { value: '2035-10-14' },
    })
    await saveSchedule()

    expect(patchBody(fetchMock)).toMatchObject({
      meetingRepeat: 'WEEKLY',
      meetingWeekdays: [2, 4],
      meetingInterval: 2,
      meetingStartsOn: '2035-10-14',
      meetingMonthWeeks: [],
    })
    expect(schedulePanel().getByText('Saved.')).toBeInTheDocument()
  })

  it('sends a monthly weekday as the weeks and the days', async () => {
    const fetchMock = stubMeetings()
    renderPage(fetchMock, 'meetings')
    await act(async () => {})

    fireEvent.click(schedulePanel().getByRole('radio', { name: 'MONTHLY' }))
    // The days ticked for weekly are kept, so only the week is new.
    fireEvent.click(schedulePanel().getByRole('checkbox', { name: 'Thursday' }))
    fireEvent.click(schedulePanel().getByRole('checkbox', { name: '1st week of the month' }))
    fireEvent.click(schedulePanel().getByRole('checkbox', { name: 'Last week of the month' }))

    expect(
      schedulePanel().getByText(
        'Meets the first and last Tuesday of the month · 6:00 – 10:00 PM.',
      ),
    ).toBeInTheDocument()

    await saveSchedule()
    expect(patchBody(fetchMock)).toMatchObject({
      meetingRepeat: 'MONTHLY_WEEKDAY',
      meetingWeekdays: [2],
      meetingMonthWeeks: [1, -1],
      meetingInterval: 1,
    })
  })

  /**
   * A list of dates is clicked on a month grid. The term is fall 2035, which starts after
   * today whenever this runs, so the grid opens on August and no day is greyed for being past.
   */
  it('takes a list of dates clicked on the calendar', async () => {
    const fetchMock = stubMeetings()
    renderPage(fetchMock, 'meetings')
    await act(async () => {})

    fireEvent.click(schedulePanel().getByRole('radio', { name: 'ON CHOSEN DATES' }))
    expect(schedulePanel().getByText('No dates picked yet.')).toBeInTheDocument()
    expect(schedulePanel().getByText('August 2035')).toBeInTheDocument()

    // Before classes start, greyed and read out as such, and a click does nothing.
    const early = schedulePanel().getByRole('button', {
      name: 'Monday, August 20, outside the semester',
    })
    expect(early).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(early)
    expect(early).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(schedulePanel().getByRole('button', { name: 'Next month' }))
    for (const day of ['Thursday, September 13', 'Saturday, September 1']) {
      fireEvent.click(schedulePanel().getByRole('button', { name: day }))
    }
    expect(
      schedulePanel().getByRole('button', { name: 'Saturday, September 1' }),
    ).toHaveAttribute('aria-pressed', 'true')

    // A second click takes one back off.
    fireEvent.click(schedulePanel().getByRole('button', { name: 'Thursday, September 13' }))
    fireEvent.click(schedulePanel().getByRole('button', { name: 'Tuesday, September 25' }))

    // Listed under the grid, sorted, each removable.
    expect(
      schedulePanel().getAllByRole('button', { name: /^Remove / }).map((button) =>
        button.getAttribute('aria-label'),
      ),
    ).toEqual(['Remove Sat, Sep 1', 'Remove Tue, Sep 25'])

    await saveSchedule()
    expect(patchBody(fetchMock)).toMatchObject({
      meetingRepeat: 'DATES',
      meetingDates: ['2035-09-01', '2035-09-25'],
      meetingWeekdays: [],
      meetingStartsOn: null,
    })
  })

  /**
   * The term read is an extra, not a gate: while it loads, or if it fails, the grid still
   * works and greys only the past, and the server refuses the rest with its reason.
   */
  it.each(['failed', 'pending'] as const)(
    'still takes dates when the term read has %s',
    async (term) => {
      renderPage(stubMeetings(undefined, 200, term), 'meetings')
      await act(async () => {})

      fireEvent.click(schedulePanel().getByRole('radio', { name: 'ON CHOSEN DATES' }))

      expect(schedulePanel().getByText('Greyed days are past.')).toBeInTheDocument()
      expect(
        schedulePanel().getByRole('button', { name: 'Next month' }),
      ).not.toHaveAttribute('aria-disabled')
      expect(
        schedulePanel()
          .getByRole('table')
          .querySelectorAll('button:not([aria-disabled])').length,
      ).toBeGreaterThan(0)
    },
  )

  it('hands focus to the next picked date when one is removed', async () => {
    renderPage(stubMeetings(), 'meetings')
    await act(async () => {})

    fireEvent.click(schedulePanel().getByRole('radio', { name: 'ON CHOSEN DATES' }))
    fireEvent.click(schedulePanel().getByRole('button', { name: 'Next month' }))
    fireEvent.click(schedulePanel().getByRole('button', { name: 'Saturday, September 1' }))
    fireEvent.click(schedulePanel().getByRole('button', { name: 'Tuesday, September 4' }))

    await act(async () => {
      fireEvent.click(schedulePanel().getByRole('button', { name: 'Remove Sat, Sep 1' }))
    })

    expect(schedulePanel().getByRole('button', { name: 'Remove Tue, Sep 4' })).toHaveFocus()
  })

  it('greys finals week and stops paging at the end of the term', async () => {
    renderPage(stubMeetings(), 'meetings')
    await act(async () => {})

    fireEvent.click(schedulePanel().getByRole('radio', { name: 'ON CHOSEN DATES' }))
    for (let month = 0; month < 4; month++) {
      fireEvent.click(schedulePanel().getByRole('button', { name: 'Next month' }))
    }

    expect(schedulePanel().getByText('December 2035')).toBeInTheDocument()
    expect(schedulePanel().getByRole('button', { name: 'Next month' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(
      schedulePanel().getByRole('button', { name: 'Thursday, December 6' }),
    ).not.toHaveAttribute('aria-disabled')
    expect(
      schedulePanel().getByRole('button', { name: 'Friday, December 7, finals week' }),
    ).toHaveAttribute('aria-disabled', 'true')
  })

  /**
   * One day is in the tab order and the arrows move it, crossing into the next month at the
   * edge, the way a date grid works everywhere else.
   */
  it('moves between days with the arrow keys, into the next month', async () => {
    renderPage(stubMeetings(), 'meetings')
    await act(async () => {})

    fireEvent.click(schedulePanel().getByRole('radio', { name: 'ON CHOSEN DATES' }))
    const tabbable = schedulePanel()
      .getAllByRole('button', { pressed: false })
      .filter((button) => button.getAttribute('tabindex') === '0')
    expect(tabbable).toHaveLength(1)

    const lastDay = schedulePanel().getByRole('button', { name: 'Friday, August 31' })
    await act(async () => {
      fireEvent.keyDown(lastDay, { key: 'ArrowRight' })
    })

    expect(schedulePanel().getByText('September 2035')).toBeInTheDocument()
    const first = schedulePanel().getByRole('button', { name: 'Saturday, September 1' })
    expect(first).toHaveFocus()

    // Home is the start of the week, back across the month edge.
    await act(async () => {
      fireEvent.keyDown(first, { key: 'Home' })
    })
    expect(schedulePanel().getByRole('button', { name: 'Sunday, August 26' })).toHaveFocus()
  })

  /**
   * The saved schedule is Tuesdays and Thursdays, six till ten. Each day starts on those hours
   * once they vary, so the lead only changes Thursday, and only Thursday is sent.
   */
  it('gives a day its own hours, sending only the day that differs', async () => {
    const fetchMock = stubMeetings()
    renderPage(fetchMock, 'meetings')
    await act(async () => {})

    expect(schedulePanel().getByRole('radio', { name: 'SAME EVERY DAY' })).toBeChecked()
    fireEvent.click(schedulePanel().getByRole('radio', { name: 'DIFFERENT BY DAY' }))

    expect(schedulePanel().queryByLabelText('FROM')).not.toBeInTheDocument()
    expect(schedulePanel().getByLabelText('Tuesday from')).toHaveValue('18:00')
    fireEvent.change(schedulePanel().getByLabelText('Thursday from'), {
      target: { value: '19:00' },
    })
    fireEvent.change(schedulePanel().getByLabelText('Thursday to'), {
      target: { value: '21:00' },
    })

    await saveSchedule()
    expect(patchBody(fetchMock)).toMatchObject({
      meetingStartTime: '18:00',
      meetingEndTime: '22:00',
      meetingTimes: [{ day: '4', startTime: '19:00', endTime: '21:00' }],
    })
    // Read back from what the server kept, still day by day.
    expect(schedulePanel().getByLabelText('Thursday from')).toHaveValue('19:00')
  })

  it('names the day whose hours are backwards, and sends nothing', async () => {
    const fetchMock = stubMeetings()
    renderPage(fetchMock, 'meetings')
    await act(async () => {})

    fireEvent.click(schedulePanel().getByRole('radio', { name: 'DIFFERENT BY DAY' }))
    fireEvent.change(schedulePanel().getByLabelText('Thursday to'), {
      target: { value: '17:00' },
    })
    await saveSchedule()

    expect(
      schedulePanel().getByText('Thursday: the meeting has to end after it starts.'),
    ).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(
      false,
    )
  })

  it('goes back to one set of hours for every day', async () => {
    const fetchMock = stubMeetings()
    renderPage(fetchMock, 'meetings')
    await act(async () => {})

    fireEvent.click(schedulePanel().getByRole('radio', { name: 'DIFFERENT BY DAY' }))
    for (const day of ['Tuesday', 'Thursday']) {
      fireEvent.change(schedulePanel().getByLabelText(`${day} from`), {
        target: { value: '17:00' },
      })
    }
    fireEvent.click(schedulePanel().getByRole('radio', { name: 'SAME EVERY DAY' }))

    // The hours every day had, not the ones from before the split.
    expect(schedulePanel().getByLabelText('FROM')).toHaveValue('17:00')
    await saveSchedule()
    expect(patchBody(fetchMock)).toMatchObject({
      meetingStartTime: '17:00',
      meetingTimes: [],
    })

    // Splitting again starts every day on the shared hours, not on what they were before.
    fireEvent.change(schedulePanel().getByLabelText('FROM'), { target: { value: '16:00' } })
    fireEvent.click(schedulePanel().getByRole('radio', { name: 'DIFFERENT BY DAY' }))
    expect(schedulePanel().getByLabelText('Thursday from')).toHaveValue('16:00')
  })

  /** The line under the pattern is the check on a mistake, so it carries the hours too. */
  it('reads each day’s hours back before saving', async () => {
    renderPage(stubMeetings(), 'meetings')
    await act(async () => {})

    expect(
      schedulePanel().getByText('Meets Tuesdays and Thursdays · 6:00 – 10:00 PM.'),
    ).toBeInTheDocument()

    fireEvent.click(schedulePanel().getByRole('radio', { name: 'DIFFERENT BY DAY' }))
    fireEvent.change(schedulePanel().getByLabelText('Thursday from'), {
      target: { value: '19:00' },
    })
    fireEvent.change(schedulePanel().getByLabelText('Thursday to'), {
      target: { value: '21:00' },
    })

    expect(
      schedulePanel().getByText(
        'Meets Tuesdays and Thursdays · Tue 6:00 – 10:00 PM; Thu 7:00 – 9:00 PM.',
      ),
    ).toBeInTheDocument()

    // A time half cleared leaves the hours out rather than printing midnight.
    fireEvent.change(schedulePanel().getByLabelText('Thursday to'), {
      target: { value: '' },
    })
    expect(schedulePanel().getByText('Meets Tuesdays and Thursdays.')).toBeInTheDocument()
  })

  /** With one day, SAME takes the HOURS choice away, and focus would go with it. */
  it('hands focus to FROM when the choice of hours goes away', async () => {
    renderPage(stubMeetings(), 'meetings')
    await act(async () => {})

    fireEvent.click(schedulePanel().getByRole('radio', { name: 'DIFFERENT BY DAY' }))
    fireEvent.click(schedulePanel().getByRole('checkbox', { name: 'Thursday' }))
    await act(async () => {
      fireEvent.click(schedulePanel().getByRole('radio', { name: 'SAME EVERY DAY' }))
    })

    expect(
      schedulePanel().queryByRole('radio', { name: 'SAME EVERY DAY' }),
    ).not.toBeInTheDocument()
    expect(schedulePanel().getByLabelText('FROM')).toHaveFocus()
  })

  it('offers no choice of hours for a single day', async () => {
    renderPage(stubMeetings(), 'meetings')
    await act(async () => {})

    fireEvent.click(schedulePanel().getByRole('checkbox', { name: 'Thursday' }))
    expect(
      schedulePanel().queryByRole('radio', { name: 'DIFFERENT BY DAY' }),
    ).not.toBeInTheDocument()
  })

  it('gives a picked date its own hours', async () => {
    const fetchMock = stubMeetings()
    renderPage(fetchMock, 'meetings')
    await act(async () => {})

    fireEvent.click(schedulePanel().getByRole('radio', { name: 'ON CHOSEN DATES' }))
    fireEvent.click(schedulePanel().getByRole('button', { name: 'Next month' }))
    for (const day of ['Saturday, September 1', 'Tuesday, September 4']) {
      fireEvent.click(schedulePanel().getByRole('button', { name: day }))
    }
    fireEvent.click(schedulePanel().getByRole('radio', { name: 'DIFFERENT BY DATE' }))
    fireEvent.change(schedulePanel().getByLabelText('Saturday, September 1 from'), {
      target: { value: '10:00' },
    })
    fireEvent.change(schedulePanel().getByLabelText('Saturday, September 1 to'), {
      target: { value: '14:00' },
    })

    await saveSchedule()
    expect(patchBody(fetchMock)).toMatchObject({
      meetingRepeat: 'DATES',
      meetingDates: ['2035-09-01', '2035-09-04'],
      meetingStartTime: '18:00',
      meetingTimes: [{ day: '2035-09-01', startTime: '10:00', endTime: '14:00' }],
    })
  })

  it('asks before taking the schedule off, then sends no pattern', async () => {
    const fetchMock = stubMeetings()
    renderPage(fetchMock, 'meetings')
    await act(async () => {})

    fireEvent.click(schedulePanel().getByRole('button', { name: 'REMOVE SCHEDULE' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH'),
    ).toBe(false)

    await act(async () => {
      fireEvent.click(dialog.getByRole('button', { name: 'REMOVE IT' }))
    })

    expect(patchBody(fetchMock)).toEqual({ meetingRepeat: null })
  })
})

describe('the upcoming meetings', () => {
  it('lists them, the cancelled one marked with its reason', async () => {
    renderPage(stubMeetings(), 'meetings')
    await act(async () => {})

    const list = meetingsPanel()
    expect(list.getByText('CANCELLED')).toBeInTheDocument()
    expect(list.getByText(/Homecoming/)).toBeInTheDocument()
    expect(list.getAllByRole('button', { name: /^Call off / })).toHaveLength(1)
    expect(list.getAllByRole('button', { name: /^Restore / })).toHaveLength(1)
  })

  it('cancels one with a reason, keyed on the campus date', async () => {
    const fetchMock = stubMeetings()
    renderPage(fetchMock, 'meetings')
    await act(async () => {})

    fireEvent.click(meetingsPanel().getByRole('button', { name: /^Call off / }))
    fireEvent.change(meetingsPanel().getByLabelText('REASON (OPTIONAL)'), {
      target: { value: 'Lab closed' },
    })
    await act(async () => {
      fireEvent.click(meetingsPanel().getByRole('button', { name: 'CANCEL MEETING' }))
    })

    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(urlOf(call![0])).toContain('/projects/p1/meetings/2035-10-16/cancel')
    expect(JSON.parse(call![1]!.body as string)).toEqual({ reason: 'Lab closed' })
    expect(meetingsPanel().getByText(/^Cancelled /)).toBeInTheDocument()
  })

  it('puts a cancelled one back', async () => {
    const fetchMock = stubMeetings()
    renderPage(fetchMock, 'meetings')
    await act(async () => {})

    await act(async () => {
      fireEvent.click(meetingsPanel().getByRole('button', { name: /^Restore / }))
    })

    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')
    expect(urlOf(call![0])).toContain('/projects/p1/meetings/2035-10-18/cancel')
    expect(meetingsPanel().getByText(/is back on\.$/)).toBeInTheDocument()
  })

  it('closes the reason without cancelling, and gives focus back to the row', async () => {
    const fetchMock = stubMeetings()
    renderPage(fetchMock, 'meetings')
    await act(async () => {})

    const callOff = meetingsPanel().getByRole('button', { name: /^Call off / })
    fireEvent.click(callOff)
    expect(callOff).toHaveAttribute('aria-expanded', 'true')

    fireEvent.keyDown(meetingsPanel().getByLabelText('REASON (OPTIONAL)'), {
      key: 'Escape',
    })

    expect(meetingsPanel().queryByLabelText('REASON (OPTIONAL)')).toBeNull()
    expect(callOff).toHaveFocus()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('holds its place while the list loads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) =>
        urlOf(input).includes('/meetings')
          ? new Promise<Response>(() => {})
          : stubMeetings()(input),
      ),
    )
    render(
      <MemoryRouter initialEntries={['/rover']}>
        <Routes>
          <Route element={<Outlet context={context()} />}>
            <Route path="/:slug" element={<ProjectManagePage part="meetings" />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    await act(async () => {})

    expect(
      meetingsPanel()
        .getByText('UPCOMING MEETINGS')
        .closest('div')!
        .querySelector('[aria-busy="true"]'),
    ).not.toBeNull()
  })

  it('says so when there are none left', async () => {
    renderPage(stubMeetings([]), 'meetings')
    await act(async () => {})

    expect(
      meetingsPanel().getByText('No meetings left this semester.'),
    ).toBeInTheDocument()
  })

  it('says so when they will not load, rather than showing none', async () => {
    renderPage(stubMeetings({ error: 'down' }, 500), 'meetings')
    await act(async () => {})

    expect(
      meetingsPanel().getByText(/Couldn.t load the meetings just now\./),
    ).toBeInTheDocument()
  })
})

describe('the project events form', () => {
  function renderEvents(rank: 'PROJECT_LEAD' | 'TEAM_LEAD', existing: ApiMeEvent[] = []) {
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = urlOf(input)
      if (url.includes('/team')) return json({ project, teams: [{ id: 't1', name: 'Software', description: null }], members: [] })
      if (url.includes('/me/events')) return json(existing)
      if (init?.method === 'POST' || init?.method === 'PATCH') return json({ id: 'e1' })
      return json([])
    })
    vi.stubGlobal('fetch', fetchMock)
    const ctx = context()
    ctx.projects = { status: 'ready', data: [{ ...lead, rank, team: rank === 'TEAM_LEAD' ? { id: 't1', name: 'Software' } : null }] }
    render(<MemoryRouter initialEntries={['/rover']}><Routes>
      <Route element={<Outlet context={ctx} />}><Route path="/:slug" element={<ProjectManagePage part="events" />} /></Route>
    </Routes></MemoryRouter>)
    return fetchMock
  }

  it.each([
    ['PROJECT_LEAD', true], ['PROJECT_LEAD', false],
    ['TEAM_LEAD', true], ['TEAM_LEAD', false],
  ] as const)('%s creates an event with main calendar %s', async (rank, published) => {
    const fetchMock = renderEvents(rank)
    const title = await screen.findByLabelText('Event title')
    fireEvent.change(title, { target: { value: 'Team demonstration' } })
    fireEvent.change(screen.getByLabelText('START DATE'), { target: { value: '2035-10-20' } })
    fireEvent.change(screen.getByLabelText('START TIME'), { target: { value: '18:00' } })
    const checkbox = screen.getByRole('checkbox', { name: /main calendar/i })
    expect(checkbox).not.toBeChecked()
    if (published) fireEvent.click(checkbox)
    await act(async () => { fireEvent.submit(title.closest('form')!) })
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({
      projectId: 'p1', teamId: rank === 'TEAM_LEAD' ? 't1' : null, published,
    })
  })

  it.each(['PROJECT_LEAD', 'TEAM_LEAD'] as const)('%s can uncheck the main calendar on an existing event', async (rank) => {
    const fetchMock = renderEvents(rank, [{
      id: 'e1', slug: 'demo', title: 'Team demonstration', description: null,
      type: 'MEETING', location: null, startsAt: '2035-10-20T22:00:00.000Z',
      endsAt: '2035-10-20T23:00:00.000Z', allDay: false, registrationUrl: null,
      published: true, projectId: 'p1', teamId: 't1', createdById: 'other',
      project: { slug: 'rover', title: 'Rover' }, team: { name: 'Software' },
    }])
    const eventPanel = (await screen.findByText('EVENTS', { selector: 'p' })).closest('div')!
    fireEvent.click(await within(eventPanel).findByRole('button', { name: 'EDIT' }))
    const checkbox = within(eventPanel).getByRole('checkbox', { name: /main calendar/i })
    expect(checkbox).toBeChecked()
    fireEvent.click(checkbox)
    await act(async () => { fireEvent.submit(checkbox.closest('form')!) })
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!
    expect(urlOf(patch[0])).toContain('/events/e1')
    expect(JSON.parse(patch[1]!.body as string)).toMatchObject({ published: false })
  })

  it('sends an event that runs over several days', async () => {
    const fetchMock = stubDesk()
    renderPage(fetchMock, 'events')
    await act(async () => {})

    const local = (value: string) => new Date(value).toISOString()
    fireEvent.change(screen.getByLabelText('Event title'), {
      target: { value: 'Build weekend' },
    })
    for (const [label, value] of [
      ['START DATE', '2035-09-21'],
      ['START TIME', '09:00'],
      ['END DATE', '2035-09-23'],
      ['END TIME', '17:00'],
    ]) {
      fireEvent.change(screen.getByLabelText(label!), { target: { value } })
    }

    await act(async () => {
      fireEvent.submit(screen.getByLabelText('END DATE').closest('form')!)
    })

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(post![1]!.body as string)).toMatchObject({
      title: 'Build weekend',
      startsAt: local('2035-09-21T09:00'),
      endsAt: local('2035-09-23T17:00'),
      projectId: 'p1',
    })
  })
})
