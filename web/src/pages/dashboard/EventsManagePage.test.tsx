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
 * others: a lead sees their own projects in the picker and no publish switch; an officer sees every
 * event, the club-wide option and the switch. Anything looser is a button that lands on a 403,
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
  meetingWeekdays: [2, 4],
  meetingStartTime: '18:00',
  meetingEndTime: '22:00',
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

const formPanel = () =>
  within(screen.getByText(/NEW EVENT|EDITING/).closest('div')!)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('who may open it', () => {
  it('refuses somebody who leads nothing', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage(context('MEMBER', [membership('p1', 'Rover', 'MEMBER')]))

    expect(
      await screen.findByText(/for people running something/i),
    ).toBeInTheDocument()
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
    expect(
      within(picker).queryByRole('option', { name: 'Sumobots' }),
    ).toBeNull()
    // The club's own calendar is not theirs to write to.
    expect(within(picker).queryByRole('option', { name: /Club-wide/ })).toBeNull()
  })

  it('gives an officer the club-wide option', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage(context('OFFICER', []))
    await screen.findByText('NEW EVENT')

    const picker = formPanel().getByLabelText('PROJECT')
    expect(
      within(picker).getByRole('option', { name: /Club-wide/ }),
    ).toBeDefined()
  })
})

describe('the publish switch', () => {
  it('is drawn for an officer', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage(context('OFFICER', []))
    await screen.findByText('NEW EVENT')

    expect(
      screen.getByRole('checkbox', { name: /public calendar/i }),
    ).toBeDefined()
  })

  it('is not drawn for a lead', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage(context('MEMBER', [membership('p1', 'Rover', 'PROJECT_LEAD')]))
    await screen.findByText('NEW EVENT')

    // Absent rather than disabled: a control somebody cannot use is a question
    // they will ask. The server refuses the field from them regardless.
    expect(
      screen.queryByRole('checkbox', { name: /public calendar/i }),
    ).toBeNull()
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

    expect(
      await screen.findByText(/set on the project/i),
    ).toBeInTheDocument()
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
    fireEvent.change(panel.getByLabelText('DATE'), {
      target: { value: '2035-09-20' },
    })
    fireEvent.change(panel.getByLabelText('FROM'), {
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

    fireEvent.change(formPanel().getByLabelText('DATE'), {
      target: { value: '2035-12-10' },
    })

    expect(await screen.findByText(/finals week/i)).toBeInTheDocument()
    // Advisory, not a refusal: a competition can legitimately fall in finals
    // week, and the halt is about the meetings the site generates.
    expect(
      screen.getByRole('button', { name: 'CREATE EVENT' }),
    ).not.toBeDisabled()
  })
})
