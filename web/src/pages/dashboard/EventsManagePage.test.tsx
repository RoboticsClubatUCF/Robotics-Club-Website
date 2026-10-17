import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventsManagePage } from './EventsManagePage'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import type {
  ApiMeEvent,
  ApiMyProject,
  ApiTerm,
  ProjectMemberRank,
  UserRole,
} from '../../lib/api/api'
import { bodyOf, urlOf } from '../../test/stubFetch'

/**
 * The events desk.
 *
 * The thing worth testing is who reaches what. It is the only page under `/ MANAGE` a non-officer
 * opens, so the two audiences have to differ in exactly the ways the server enforces and in no
 * others: a lead sees their own projects in the picker; an officer also gets club-wide events.
 * Both can opt events they lead into the main calendar. Anything looser lands on a 403,
 * which is worse than no button.
 *
 * The other invariant is negative and easy to lose: a generated project meeting must never appear
 * in this list. It has no row behind it, so EDIT would PATCH an id that 404s.
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
  meetingRepeat: 'WEEKLY',
  meetingWeekdays: [2, 4],
  meetingInterval: 1,
  meetingMonthWeeks: [],
  meetingMonthDays: [],
  meetingDates: [],
  meetingStartsOn: null,
  meetingStartTime: '18:00',
  meetingEndTime: '22:00',
  meetingTimes: [],
  meetingLocation: 'ENG2 Lab',
  meetingDescription: null,
  meetingsPublic: true,
  discordRoleId: null,
})

const membership = (
  id: string,
  title: string,
  rank: ProjectMemberRank,
): ApiMyProject => ({
  publiclyListed: true,
  rank,
  title: null,
  team: null,
  current: true,
  project: project(id, title),
})

const context = (
  role: UserRole = 'OFFICER',
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
      surveyPending: false,
      surveyPromptDismissed: false,
      slicerTrained: true,
    },
  },
  reloadMembership: () => Promise.resolve(),
})

const meEvent = (over: Partial<ApiMeEvent> = {}): ApiMeEvent => ({
  id: 'e1',
  slug: 'kickoff',
  title: 'Kickoff',
  description: null,
  type: 'MEETING',
  location: null,
  startsAt: '2035-09-06T22:00:00.000Z',
  endsAt: '2035-09-07T02:00:00.000Z',
  allDay: false,
  registrationUrl: null,
  published: false,
  projectId: 'p1',
  teamId: null,
  createdById: 'u1',
  project: { slug: 'rover', title: 'Rover' },
  team: null,
  ...over,
})

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

/**
 * A desk that answers like the real one. Two endpoints matter: the events the
 * caller may see, and the term list the finals warning reads.
 */
function stubDesk(events: ApiMeEvent[] = [meEvent()]) {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input)

    if (url.includes('/me/events')) return json(events)
    if (url.includes('/officer/semesters')) {
      return json([
        {
          year: 2035,
          season: 'FALL',
          startsAt: '2035-08-24T04:00:00.000Z',
          endsAt: '2035-12-14T04:59:59.999Z',
          source: 'calendar',
          // 6 to 14 December, so a date inside it can be typed at the form.
          finalsStartAt: '2035-12-06T05:00:00.000Z',
          finalsEndAt: '2035-12-14T04:59:59.999Z',
          finalsSource: 'calendar',
          note: null,
        },
      ])
    }
    if (url.includes('/events')) return json({ id: 'new', ...(init ? {} : {}) }, 201)

    return Promise.reject(new Error(`no stub for ${url}`))
  })
}

const renderPage = (dashboard = context()) =>
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={dashboard} />}>
          <Route path="/" element={<EventsManagePage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

const formPanel = () => within(screen.getByText(/NEW EVENT|EDITING/).closest('div')!)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('who may open it', () => {
  it('refuses somebody who leads nothing', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage(context('MEMBER', [membership('p1', 'Rover', 'MEMBER')]))

    expect(await screen.findByText(/for people running something/i)).toBeInTheDocument()
  })

  it('opens for a plain member who leads a project', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage(context('MEMBER', [membership('p1', 'Rover', 'PROJECT_LEAD')]))

    // Project authority is a fact about a membership row, never about
    // `UserRole` — this person is a MEMBER globally and runs a build.
    expect(await screen.findByText('NEW EVENT')).toBeInTheDocument()
  })

  it('opens for an officer who leads nothing', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage(context('OFFICER', []))

    expect(await screen.findByText('NEW EVENT')).toBeInTheDocument()
  })
})

describe('the project picker', () => {
  it('offers a lead only what they lead', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage(
      context('MEMBER', [
        membership('p1', 'Rover', 'PROJECT_LEAD'),
        membership('p2', 'Sumobots', 'MEMBER'),
      ]),
    )
    await screen.findByText('NEW EVENT')

    const picker = formPanel().getByLabelText('PROJECT')
    expect(within(picker).getByRole('option', { name: 'Rover' })).toBeDefined()
    expect(within(picker).queryByRole('option', { name: 'Sumobots' })).toBeNull()
    // The club's own calendar is not theirs to write to.
    expect(within(picker).queryByRole('option', { name: /Club-wide/ })).toBeNull()
  })

  it('gives an officer the club-wide option', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage(context('OFFICER', []))
    await screen.findByText('NEW EVENT')

    const picker = formPanel().getByLabelText('PROJECT')
    expect(within(picker).getByRole('option', { name: /Club-wide/ })).toBeDefined()
  })
})

describe('the publish switch', () => {
  it('is drawn for an officer', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage(context('OFFICER', []))
    await screen.findByText('NEW EVENT')

    expect(screen.getByRole('checkbox', { name: /main calendar/i })).not.toBeChecked()
  })

  it.each(['PROJECT_LEAD', 'TEAM_LEAD'] as const)('is available to a %s and defaults to private', async (rank) => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage(context('MEMBER', [{ ...membership('p1', 'Rover', rank), team: rank === 'TEAM_LEAD' ? { id: 't1', name: 'Software' } : null }]))
    await screen.findByText('NEW EVENT')

    expect(screen.getByRole('checkbox', { name: /main calendar/i })).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: /main calendar/i })).not.toBeChecked()
  })

  it.each(['PROJECT_LEAD', 'TEAM_LEAD'] as const)('sends publication and the correct scope for a %s', async (rank) => {
    const fetchStub = stubDesk([])
    vi.stubGlobal('fetch', fetchStub)
    renderPage(context('MEMBER', [{ ...membership('p1', 'Rover', rank), team: rank === 'TEAM_LEAD' ? { id: 't1', name: 'Software' } : null }]))
    await screen.findByText('NEW EVENT')
    fireEvent.click(screen.getByRole('checkbox', { name: /main calendar/i }))
    const body = await create(fetchStub, { 'START DATE': '2035-10-20', 'START TIME': '18:00' })
    expect(body).toMatchObject({ published: true, projectId: 'p1' })
    if (rank === 'TEAM_LEAD') expect(body).toHaveProperty('teamId', 't1')
    else expect(body).not.toHaveProperty('teamId')
    expect(screen.getByRole('checkbox', { name: /main calendar/i })).not.toBeChecked()
  })

  it('loads a published event checked and sends false when a lead withdraws it', async () => {
    const fetchStub = stubDesk([meEvent({ published: true, createdById: 'someone-else' })])
    vi.stubGlobal('fetch', fetchStub)
    renderPage(context('MEMBER', [membership('p1', 'Rover', 'PROJECT_LEAD')]))
    fireEvent.click(await screen.findByRole('button', { name: 'EDIT' }))
    const checkbox = screen.getByRole('checkbox', { name: /main calendar/i })
    expect(checkbox).toBeChecked()
    fireEvent.click(checkbox)
    await act(async () => { fireEvent.submit(checkbox.closest('form')!) })
    const patch = fetchStub.mock.calls.find(([, init]) => init?.method === 'PATCH')!
    expect(urlOf(patch[0])).toContain('/events/e1')
    expect(bodyOf(patch[1])).toMatchObject({ published: false })
  })

  it('does not give team leads controls for another team’s event', async () => {
    vi.stubGlobal('fetch', stubDesk([
      meEvent({ id: 'own', title: 'Software review', teamId: 't1', createdById: 'other' }),
      meEvent({ id: 'sibling', title: 'Hardware review', teamId: 't2', createdById: 'other' }),
    ]))
    renderPage(context('MEMBER', [{ ...membership('p1', 'Rover', 'TEAM_LEAD'), team: { id: 't1', name: 'Software' } }]))
    expect(await screen.findByText('Software review')).toBeInTheDocument()
    expect(screen.queryByText('Hardware review')).toBeNull()
  })

  it('preserves publication when a creator no longer leads that event', async () => {
    const fetchStub = stubDesk([meEvent({ published: true })])
    vi.stubGlobal('fetch', fetchStub)
    renderPage(context('MEMBER', [membership('p2', 'Other build', 'PROJECT_LEAD')]))
    fireEvent.click(await screen.findByRole('button', { name: 'EDIT' }))
    expect(screen.queryByRole('checkbox', { name: /main calendar/i })).toBeNull()
    const title = screen.getByLabelText('TITLE')
    fireEvent.change(title, { target: { value: 'Corrected title' } })
    await act(async () => { fireEvent.submit(title.closest('form')!) })
    const patch = fetchStub.mock.calls.find(([, init]) => init?.method === 'PATCH')!
    expect(bodyOf(patch[1])).not.toHaveProperty('published')
  })
})

describe('the list', () => {
  it('leaves generated meetings out', async () => {
    vi.stubGlobal(
      'fetch',
      stubDesk([
        meEvent(),
        meEvent({
          id: 'meeting:p1:2035-09-06T22:00:00.000Z',
          title: 'Rover meeting',
        }),
      ]),
    )
    renderPage(context('OFFICER', []))
    await screen.findByText('Kickoff')

    // No row behind it, so no EDIT button may point at it.
    expect(screen.queryByText('Rover meeting')).toBeNull()
  })

  it('says where to find a schedule when there is nothing else', async () => {
    vi.stubGlobal('fetch', stubDesk([]))
    renderPage(context('OFFICER', []))

    expect(await screen.findByText(/set on the project/i)).toBeInTheDocument()
  })

  it('says so when the calendar cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('down'))),
    )
    renderPage(context('OFFICER', []))

    expect(await screen.findByText(/couldn.t load the calendar/i)).toBeInTheDocument()
  })
})

describe('writing an event', () => {
  it('omits the project entirely for a club-wide event', async () => {
    const fetchStub = stubDesk([])
    vi.stubGlobal('fetch', fetchStub)
    renderPage(context('OFFICER', []))
    await screen.findByText('NEW EVENT')

    const panel = formPanel()
    fireEvent.change(panel.getByLabelText('TITLE'), {
      target: { value: 'Open house' },
    })
    fireEvent.change(panel.getByLabelText('START DATE'), {
      target: { value: '2035-09-20' },
    })
    fireEvent.change(panel.getByLabelText('START TIME'), {
      target: { value: '18:00' },
    })

    await act(async () => {
      fireEvent.submit(
        screen.getByRole('button', { name: 'CREATE EVENT' }).closest('form')!,
      )
    })

    const post = fetchStub.mock.calls.find(
      (call) =>
        urlOf(call[0]).endsWith('/events') &&
        (call[1] as RequestInit | undefined)?.method === 'POST',
    )
    const body = bodyOf(post![1]) as Record<string, unknown>

    // Absent, not null: an omitted `projectId` is what the route reads as club
    // business. Sending `null` would be a different shape for zod to argue with.
    expect('projectId' in body).toBe(false)
    expect(body.title).toBe('Open house')
  })

  it('warns when the date lands in finals week, and still allows it', async () => {
    vi.stubGlobal('fetch', stubDesk([]))
    renderPage(context('OFFICER', []))
    await screen.findByText('NEW EVENT')

    fireEvent.change(formPanel().getByLabelText('START DATE'), {
      target: { value: '2035-12-10' },
    })

    expect(await screen.findByText(/finals week/i)).toBeInTheDocument()
    // Advisory, not a refusal: a competition can legitimately fall in finals
    // week, and the halt is about the meetings the site generates.
    expect(screen.getByRole('button', { name: 'CREATE EVENT' })).not.toBeDisabled()
  })

  it('still warns for the same date on the next event after a save', async () => {
    vi.stubGlobal('fetch', stubDesk([]))
    renderPage(context('OFFICER', []))
    await screen.findByText('NEW EVENT')

    const fill = (label: string, value: string) => {
      fireEvent.change(formPanel().getByLabelText(label), { target: { value } })
    }
    fill('TITLE', 'Study night')
    fill('START DATE', '2035-12-10')
    fill('START TIME', '18:00')
    await act(async () => {
      fireEvent.submit(
        screen.getByRole('button', { name: 'CREATE EVENT' }).closest('form')!,
      )
    })
    expect(await screen.findByText('Saved.')).toBeInTheDocument()
    expect(screen.queryByText(/finals week/i)).not.toBeInTheDocument()

    // `form.reset()` used to leave React holding the old value, so this fired no onChange.
    fill('START DATE', '2035-12-10')
    expect(screen.getByText(/finals week/i)).toBeInTheDocument()
  })

  it('warns when a run that starts before finals week reaches into it', async () => {
    vi.stubGlobal('fetch', stubDesk([]))
    renderPage(context('OFFICER', []))
    await screen.findByText('NEW EVENT')

    fireEvent.change(formPanel().getByLabelText('START DATE'), {
      target: { value: '2035-12-04' },
    })
    expect(screen.queryByText(/finals week/i)).not.toBeInTheDocument()

    fireEvent.change(formPanel().getByLabelText('END DATE'), {
      target: { value: '2035-12-07' },
    })
    expect(
      await screen.findByText(/Those dates run into finals week/),
    ).toBeInTheDocument()
  })
})

/** Fills the form and presses CREATE EVENT, handing back what went to `POST /events`. */
async function create(
  fetchStub: ReturnType<typeof stubDesk>,
  values: Record<string, string>,
  allDay = false,
) {
  const panel = formPanel()
  fireEvent.change(panel.getByLabelText('TITLE'), {
    target: { value: 'Regional qualifier' },
  })
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(panel.getByLabelText(label), { target: { value } })
  }
  if (allDay) fireEvent.click(panel.getByLabelText(/All day/))

  await act(async () => {
    fireEvent.submit(
      screen.getByRole('button', { name: 'CREATE EVENT' }).closest('form')!,
    )
  })

  const post = fetchStub.mock.calls.find(
    (call) =>
      urlOf(call[0]).endsWith('/events') &&
      (call[1] as RequestInit | undefined)?.method === 'POST',
  )
  return post ? (bodyOf(post[1]) as Record<string, unknown>) : null
}

describe('an event over several days', () => {
  // Local wall-clock times, the zone the form is filled in, whatever zone the suite runs in.
  const local = (value: string) => new Date(value).toISOString()

  it('sends the end date with the end time', async () => {
    const fetchStub = stubDesk([])
    vi.stubGlobal('fetch', fetchStub)
    renderPage(context('OFFICER', []))
    await screen.findByText('NEW EVENT')

    const body = await create(fetchStub, {
      'START DATE': '2035-09-20',
      'START TIME': '18:00',
      'END DATE': '2035-09-22',
      'END TIME': '14:00',
    })

    expect(body?.startsAt).toBe(local('2035-09-20T18:00'))
    expect(body?.endsAt).toBe(local('2035-09-22T14:00'))
  })

  it('runs an all-day event to the end of its last day', async () => {
    const fetchStub = stubDesk([])
    vi.stubGlobal('fetch', fetchStub)
    renderPage(context('OFFICER', []))
    await screen.findByText('NEW EVENT')

    const body = await create(
      fetchStub,
      { 'START DATE': '2035-09-20', 'END DATE': '2035-09-22' },
      true,
    )

    expect(body).toMatchObject({
      startsAt: local('2035-09-20T00:00'),
      endsAt: local('2035-09-22T23:59'),
      allDay: true,
    })
  })

  it('says what is missing instead of sending an end date with no time', async () => {
    const fetchStub = stubDesk([])
    vi.stubGlobal('fetch', fetchStub)
    renderPage(context('OFFICER', []))
    await screen.findByText('NEW EVENT')

    const body = await create(fetchStub, {
      'START DATE': '2035-09-20',
      'START TIME': '18:00',
      'END DATE': '2035-09-22',
    })

    expect(body).toBeNull()
    expect(
      screen.getByText('An event ending on another day needs an end time.'),
    ).toBeInTheDocument()

    // Gone once the field it names is filled, rather than sitting under the fix.
    fireEvent.change(formPanel().getByLabelText('END TIME'), {
      target: { value: '14:00' },
    })
    expect(
      screen.queryByText('An event ending on another day needs an end time.'),
    ).not.toBeInTheDocument()
  })

  it('lists the whole run and fills the end date back in to edit', async () => {
    vi.stubGlobal(
      'fetch',
      stubDesk([
        meEvent({
          title: 'Regional qualifier',
          startsAt: local('2035-09-20T00:00'),
          endsAt: local('2035-09-22T23:59'),
          allDay: true,
        }),
      ]),
    )
    renderPage(context('OFFICER', []))

    const row = (await screen.findByText('Regional qualifier')).closest('li')!
    expect(row).toHaveTextContent(/Sep 20.*–.*Sep 22/)

    fireEvent.click(within(row).getByRole('button', { name: 'EDIT' }))
    expect(screen.getByLabelText('END DATE')).toHaveValue('2035-09-22')
  })

  it('leaves the end date empty when editing a one-day event', async () => {
    // Local times: the fixture's default evening crosses midnight in UTC, where CI runs.
    vi.stubGlobal(
      'fetch',
      stubDesk([
        meEvent({
          startsAt: local('2035-09-06T18:00'),
          endsAt: local('2035-09-06T22:00'),
        }),
      ]),
    )
    renderPage(context('OFFICER', []))

    const row = (await screen.findByText('Kickoff')).closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: 'EDIT' }))
    // Blank, so moving it to another day is one field rather than two.
    expect(screen.getByLabelText('END DATE')).toHaveValue('')
  })
})
