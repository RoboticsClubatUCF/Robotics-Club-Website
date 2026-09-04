import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectManagePage } from './ProjectManagePage'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import type {
  ApiManagedProject,
  ApiMyProject,
  ApiTerm,
  UserRole,
} from '../../lib/api/api'
import { urlOf } from '../../test/stubFetch'

/**
 * The manage page, narrowed to the one section on it that reaches outside this
 * website.
 *
 * Everything else here — members, teams, events, tasks — changes rows the site
 * owns, and a mistake shows up on a page somebody can go and fix. The Discord
 * role hands out and takes away access to a channel for everybody on the
 * project at once, and it does that from a text box with a number in it. So
 * what is worth asserting is narrow and specific: that the box shows what is
 * actually stored, that saving sends the right shape, and that emptying it
 * sends `null` rather than an empty string — because `''` and `null` would be
 * two spellings of "no role" and only one of them means it.
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
  meetingWeekdays: [],
  meetingStartTime: null,
  meetingEndTime: null,
  meetingLocation: null,
  meetingDescription: null,
  meetingsPublic: true,
  discordRoleId: null,
}

const lead: ApiMyProject = {
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

const renderPage = (fetchMock: ReturnType<typeof stubDesk>) => {
  vi.stubGlobal('fetch', fetchMock)

  return render(
    <MemoryRouter initialEntries={['/rover']}>
      <Routes>
        <Route element={<Outlet context={context()} />}>
          <Route path="/:slug" element={<ProjectManagePage />} />
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

describe('the project Discord role', () => {
  it('shows the role the project is actually carrying', async () => {
    const fetchMock = stubDesk('984535585270157362')
    renderPage(fetchMock)
    await act(async () => {})

    expect(panel().getByLabelText('ROLE ID')).toHaveValue('984535585270157362')
  })

  it('saves a pasted role id', async () => {
    const fetchMock = stubDesk()
    renderPage(fetchMock)
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
    renderPage(fetchMock)
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
    renderPage(stubDesk())
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
    renderPage(fetchMock as unknown as ReturnType<typeof stubDesk>)
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
   * The refusal that matters more than a typo. A project's role is added and
   * removed as people join and leave it, so a project pointed at the club's
   * Members role takes membership off the first person to leave — and unlike
   * the check above, the server makes this one whether or not Discord is
   * reachable. The page has to print the sentence rather than flattening it.
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
    renderPage(fetchMock as unknown as ReturnType<typeof stubDesk>)
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
    renderPage(stubDesk())
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
    renderPage(stubDesk())
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
    renderPage(stubOldDesk() as unknown as ReturnType<typeof stubDesk>)

    // The server answers 409 for a new task here, so the page says so instead
    // of drawing a form whose button could only be refused.
    expect(
      await screen.findByText(/not running this semester, so it takes no new tasks/i),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Task title')).not.toBeInTheDocument()

    // TASKS is still a panel — what is on the board stays readable and
    // tickable, which is how a semester actually ends.
    expect(screen.getByText('TASKS')).toBeInTheDocument()
  })

  it('draws the form for this semester’s build', async () => {
    renderPage(stubDesk())

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

const teams = () => within(screen.getByText('TEAMS').closest('div')!)

const wrote = (fetchMock: ReturnType<typeof stubTeams>, method: string) =>
  fetchMock.mock.calls.find(([, init]) => init?.method === method)

/**
 * Teams, which a project lead makes and unmakes.
 *
 * The rename and the description are what these cover, because they are what
 * the page could not do at all: `PATCH /api/teams/:id` has always existed and
 * nothing in the browser called it, so `Team.description` was a column the site
 * displayed on the project dashboard and could never write. Creating and
 * deleting are older and are covered on the server.
 */
describe('a project lead editing teams', () => {
  it('opens a team with the name and description it is carrying', async () => {
    renderPage(stubTeams())
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
    renderPage(fetchMock)
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
    renderPage(fetchMock)
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
    renderPage(fetchMock)
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
    renderPage(fetchMock)
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
 * It was the word DANGER in grey over a text-link button that turned red only
 * on hover — the same weight the page gives REMOVE on a single task. It is
 * drawn as the destructive panel it is now, matching `DeleteAccountPanel`.
 */
describe('deleting a project', () => {
  const openPage = async () => {
    renderPage(stubDesk())
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
