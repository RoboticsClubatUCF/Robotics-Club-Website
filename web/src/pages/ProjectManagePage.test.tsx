import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectManagePage } from './ProjectManagePage'
import type { DashboardContext } from '../components/dashboard/DashboardLayout'
import type {
  ApiManagedProject,
  ApiMyProject,
  ApiTerm,
  UserRole,
} from '../lib/api'
import { urlOf } from '../test/stubFetch'

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
  repoUrl: null,
  featured: false,
  startedAt: null,
  completedAt: null,
  meetingWeekday: null,
  meetingTime: null,
  meetingLocation: null,
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
})
