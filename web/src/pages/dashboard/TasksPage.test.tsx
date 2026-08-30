import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TasksPage } from './TasksPage'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import type {
  ApiMyProject,
  ApiTask,
  ApiTerm,
  ProjectMemberRank,
  UserRole,
} from '../../lib/api/api'
import { bodyOf, urlOf } from '../../test/stubFetch'

/**
 * The tasks page.
 *
 * Two things are worth holding here and the rest is chrome. **Who gets the
 * form**: a plain member manages their own work and cannot write any, which is
 * the sentence the server enforces and the only reason this page can be one
 * page instead of two. And **the calendar toggle is the member's own** — it
 * appears on work assigned to them and nowhere else, because a control that
 * offered to put somebody else's deadline in their week would be a button that
 * lands on a 403.
 *
 * The label filter and the search are the third thing, and they are tested
 * together: both narrow the same list in the browser, so a bug in either shows
 * up as rows that should not be there.
 */

const term: ApiTerm = {
  year: 2035,
  season: 'FALL',
  startsAt: '2035-08-24T04:00:00.000Z',
  endsAt: '2035-12-14T04:59:59.999Z',
  fromCalendar: true,
}

const project = (id: string, title: string): ApiMyProject['project'] => ({
  id,
  slug: title.toLowerCase(),
  title,
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
  meetingWeekdays: [2, 4],
  meetingStartTime: '18:00',
  meetingEndTime: '22:00',
  meetingLocation: 'ENG2 Lab',
  meetingsPublic: true,
  discordRoleId: null,
})

const membership = (
  id: string,
  title: string,
  rank: ProjectMemberRank,
): ApiMyProject => ({
  rank,
  title: null,
  team: null,
  current: true,
  project: project(id, title),
})

const context = (
  role: UserRole = 'MEMBER',
  projects: ApiMyProject[] = [],
): DashboardContext => ({
  user: {
    id: 'u1',
    fullName: 'Test Person',
    email: null,
    slug: null,
    role,
    discordUsername: null,
    photoUrl: null,
    photoFocalX: 50,
    photoFocalY: 50,
    photoZoom: 1,
  },
  projects: { status: 'ready', data: projects },
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

const task = (over: Partial<ApiTask> = {}): ApiTask => ({
  id: 't1',
  projectId: 'p1',
  teamId: null,
  title: 'Cut the brackets',
  details: null,
  // Far future, so nothing is accidentally overdue against the real clock.
  dueAt: '2035-09-10T22:00:00.000Z',
  status: 'OPEN',
  completedAt: null,
  completedByName: null,
  createdById: 'u2',
  createdAt: '2035-08-01T12:00:00.000Z',
  project: { slug: 'rover', title: 'Rover' },
  team: null,
  assignees: [{ userId: 'u1', fullName: 'Test Person', onCalendar: false }],
  ...over,
})

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

function stubTasks(rows: ApiTask[] = [task()]) {
  // `init` is declared even though only the assertions read it: without it the
  // mock's call tuple is length one and `call[1]` is a type error rather than
  // the request body.
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    void init
    const url = urlOf(input)

    // Before `/projects`, which is a substring of nothing here but would be
    // reached first by an officer's project picker.
    if (url.includes('/me/tasks')) return json(rows)
    if (url.includes('/tasks/')) return json(rows[0] ?? task())
    if (url.includes('/projects?')) return json([])
    if (url.includes('/team')) return json({ project: null, teams: [], members: [] })

    return Promise.reject(new Error(`no stub for ${url}`))
  })
}

const renderPage = (dashboard = context()) =>
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={dashboard} />}>
          <Route path="/" element={<TasksPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

const rowFor = (title: string) =>
  within(screen.getByText(title).closest('li')!)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('what a member sees', () => {
  it('lists their work with its label', async () => {
    vi.stubGlobal(
      'fetch',
      stubTasks([
        task(),
        task({ id: 't2', title: 'Order the steel', status: 'DELAYED' }),
      ]),
    )
    renderPage()

    expect(await screen.findByText('Cut the brackets')).toBeInTheDocument()
    // Scoped to the chip: the row's own label picker carries an <option> with
    // the same word, and an unscoped query finds both.
    expect(
      rowFor('Order the steel').getByText('DELAYED', { selector: 'span' }),
    ).toBeInTheDocument()
    // The project a task belongs to is on the row, because somebody on three
    // builds cannot tell whose deadline this is without it.
    expect(rowFor('Cut the brackets').getByText(/Rover/)).toBeInTheDocument()
  })

  it('gives them no way to write one, and no scope switch to read one', async () => {
    vi.stubGlobal('fetch', stubTasks())
    renderPage()

    await screen.findByText('Cut the brackets')

    // The form is the whole of what separates the two audiences on this page.
    expect(screen.queryByText('NEW TASK')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'WORK I RUN' }),
    ).not.toBeInTheDocument()
  })

  it('says a task with no project has none, rather than leaving a gap', async () => {
    vi.stubGlobal(
      'fetch',
      stubTasks([
        task({ title: 'Order the shirts', projectId: null, project: null }),
      ]),
    )
    renderPage()

    await screen.findByText('Order the shirts')
    // A blank where every other row names a build reads as a row that failed
    // to load, not as the club's own work.
    expect(rowFor('Order the shirts').getByText(/No project/)).toBeInTheDocument()
  })

  it('marks work whose deadline has gone past', async () => {
    vi.stubGlobal(
      'fetch',
      stubTasks([task({ dueAt: '2020-01-01T12:00:00.000Z' })]),
    )
    renderPage()

    await screen.findByText('Cut the brackets')
    expect(screen.getByText('PAST ITS DEADLINE')).toBeInTheDocument()
  })

  it('does not call settled work overdue', async () => {
    vi.stubGlobal(
      'fetch',
      stubTasks([task({ dueAt: '2020-01-01T12:00:00.000Z', status: 'CANCELED' })]),
    )
    renderPage()

    await screen.findByText('Cut the brackets')
    // A cancelled task is not late; it is over.
    expect(screen.queryByText('PAST ITS DEADLINE')).not.toBeInTheDocument()
  })

  it('renders the three states of the read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    )
    renderPage()

    expect(
      await screen.findByText(/couldn't load your tasks/i),
    ).toBeInTheDocument()
  })
})

describe('moving a task between labels', () => {
  it('sends the label the member picked', async () => {
    const fetchMock = stubTasks()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await screen.findByText('Cut the brackets')

    fireEvent.change(rowFor('Cut the brackets').getByLabelText('LABEL'), {
      target: { value: 'DELAYED' },
    })

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input]) =>
        urlOf(input).includes('/status'),
      )
      expect(call).toBeDefined()
      expect(bodyOf(call![1])).toEqual({ status: 'DELAYED' })
    })
  })

  it('offers every one of the five', async () => {
    vi.stubGlobal('fetch', stubTasks())
    renderPage()

    await screen.findByText('Cut the brackets')
    const select = rowFor('Cut the brackets').getByLabelText('LABEL')

    expect(within(select as HTMLElement).getAllByRole('option')).toHaveLength(5)
  })
})

describe('the calendar opt-in', () => {
  it('offers it on my own dated work and sends my answer', async () => {
    const fetchMock = stubTasks()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await screen.findByText('Cut the brackets')

    fireEvent.click(screen.getByRole('checkbox', { name: /show on my calendar/i }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input]) =>
        urlOf(input).includes('/calendar'),
      )
      expect(call).toBeDefined()
      expect(bodyOf(call![1])).toEqual({ onCalendar: true })
    })
  })

  it('is absent on somebody else’s work, and on work with no deadline', async () => {
    vi.stubGlobal(
      'fetch',
      stubTasks([
        task({
          title: 'Not mine',
          assignees: [{ userId: 'u9', fullName: 'Someone Else', onCalendar: false }],
        }),
        task({ id: 't2', title: 'No deadline', dueAt: null }),
      ]),
    )
    renderPage(context('OFFICER'))

    await screen.findByText('Not mine')

    // An officer can see and manage both; neither is theirs to put in a week,
    // and one of them has no moment to put anywhere.
    expect(
      screen.queryByRole('checkbox', { name: /show on my calendar/i }),
    ).not.toBeInTheDocument()
  })
})

describe('narrowing a long list', () => {
  const many = [
    task({ id: 't1', title: 'Cut the brackets', status: 'OPEN' }),
    task({ id: 't2', title: 'Order the steel', status: 'DONE' }),
    task({
      id: 't3',
      title: 'Wire the board',
      status: 'OPEN',
      project: { slug: 'arm', title: 'Arm' },
    }),
  ]

  it('filters by label without going back to the server', async () => {
    const fetchMock = stubTasks(many)
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await screen.findByText('Cut the brackets')
    const before = fetchMock.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'DONE' }))

    expect(screen.getByText('Order the steel')).toBeInTheDocument()
    expect(screen.queryByText('Cut the brackets')).not.toBeInTheDocument()
    // The list is one person's work, so it arrives whole and narrows in the
    // browser — a chip that refetched would put a round trip behind arithmetic.
    expect(fetchMock.mock.calls).toHaveLength(before)
  })

  it('searches the title and the project together', async () => {
    vi.stubGlobal('fetch', stubTasks(many))
    renderPage()

    await screen.findByText('Cut the brackets')

    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'arm wire' },
    })

    // Every word has to appear somewhere in any field, so two facts at once
    // narrow to the one row that carries both.
    expect(screen.getByText('Wire the board')).toBeInTheDocument()
    expect(screen.queryByText('Cut the brackets')).not.toBeInTheDocument()
  })

  it('tells a filtered-out list from an empty one', async () => {
    vi.stubGlobal('fetch', stubTasks(many))
    renderPage()

    await screen.findByText('Cut the brackets')

    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'nothing matches this' },
    })

    expect(screen.getByText(/Nothing matches what you are looking for/i)).toBeInTheDocument()
  })
})

describe('who may write one', () => {
  it('gives a project lead the form and the scope switch', async () => {
    vi.stubGlobal('fetch', stubTasks())
    renderPage(context('MEMBER', [membership('p1', 'Rover', 'PROJECT_LEAD')]))

    expect(await screen.findByText('NEW TASK')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'WORK I RUN' })).toBeInTheDocument()

    // Project authority is a fact about a membership row, never about a club
    // role — this person is a plain MEMBER and still gets the form.
    expect(
      within(screen.getByLabelText('PROJECT') as HTMLElement).getByRole(
        'option',
        { name: 'Rover' },
      ),
    ).toBeInTheDocument()
  })

  it('offers the club-wide option to officers and to nobody else', async () => {
    vi.stubGlobal('fetch', stubTasks())
    renderPage(context('MEMBER', [membership('p1', 'Rover', 'PROJECT_LEAD')]))

    await screen.findByText('NEW TASK')
    expect(
      screen.queryByRole('option', { name: /the club's own work/i }),
    ).not.toBeInTheDocument()
  })

  it('lets an officer write one that belongs to no project', async () => {
    vi.stubGlobal('fetch', stubTasks())
    renderPage(context('OFFICER'))

    await screen.findByText('NEW TASK')
    expect(
      screen.getByRole('option', { name: /the club's own work/i }),
    ).toBeInTheDocument()
  })

  it('reloads when the scope changes, because the rows differ', async () => {
    const fetchMock = stubTasks()
    vi.stubGlobal('fetch', fetchMock)
    renderPage(context('MEMBER', [membership('p1', 'Rover', 'PROJECT_LEAD')]))

    await screen.findByText('Cut the brackets')

    fireEvent.click(screen.getByRole('button', { name: 'WORK I RUN' }))

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) =>
          urlOf(input).includes('scope=managed'),
        ),
      ).toBe(true)
    })
  })
})

describe('a new task goes on this semester only', () => {
  const past = (id: string, title: string): ApiMyProject => ({
    ...membership(id, title, 'PROJECT_LEAD'),
    current: false,
  })

  it('keeps a finished build out of the picker', async () => {
    vi.stubGlobal('fetch', stubTasks())
    renderPage(
      context('MEMBER', [
        membership('p1', 'Rover', 'PROJECT_LEAD'),
        past('p0', 'Old Rover'),
      ]),
    )

    await screen.findByText('NEW TASK')
    const picker = screen.getByLabelText('PROJECT') as HTMLElement

    // The server answers 409 for anything but this term, so an option that
    // could only ever be refused has no business being offered.
    expect(within(picker).getByRole('option', { name: 'Rover' })).toBeInTheDocument()
    expect(
      within(picker).queryByRole('option', { name: 'Old Rover' }),
    ).not.toBeInTheDocument()
  })

  it('says so in words when nothing of theirs is running', async () => {
    vi.stubGlobal('fetch', stubTasks())
    renderPage(context('MEMBER', [past('p0', 'Old Rover')]))

    // A note rather than an empty picker over a button that would 409, and it
    // says what they can still do — last term's board is right above it.
    expect(
      await screen.findByText(/New tasks go on a project running this semester/i),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('PROJECT')).not.toBeInTheDocument()
  })

  it('still lets them read and manage last term’s work', async () => {
    vi.stubGlobal(
      'fetch',
      stubTasks([task({ projectId: 'p0', project: { slug: 'old', title: 'Old Rover' } })]),
    )
    renderPage(context('MEMBER', [past('p0', 'Old Rover')]))

    await screen.findByText('Cut the brackets')

    // The rule is about writing new work, not about closing out what is there:
    // the row keeps its label picker and its EDIT.
    expect(rowFor('Cut the brackets').getByLabelText('LABEL')).toBeInTheDocument()
    expect(
      rowFor('Cut the brackets').getByRole('button', { name: 'EDIT' }),
    ).toBeInTheDocument()
  })

  it('leaves the scope switch alone, because reading is not writing', async () => {
    vi.stubGlobal('fetch', stubTasks())
    renderPage(context('MEMBER', [past('p0', 'Old Rover')]))

    await screen.findByText('Cut the brackets')
    expect(screen.getByRole('button', { name: 'WORK I RUN' })).toBeInTheDocument()
  })
})
