import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectDashboardPage } from './ProjectDashboardPage'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import type { ApiMyProject, ApiTerm } from '../../lib/api/api'
import { urlOf } from '../../test/stubFetch'

/**
 * Leaving a project from the dashboard, and the one thing it has to do that is
 * not on this page: refresh the *public* project page's cached roster.
 *
 * `/projects/:slug` answers `Cache-Control: max-age=60`, and this page never
 * reads it — so nothing here would evict the copy the browser is holding, which
 * still lists the person who just left. Going straight from leaving a project
 * to looking at its page is the obvious thing to do next, and inside that
 * minute it showed them still on the roster.
 */

const term: ApiTerm = {
  year: 2035,
  season: 'FALL',
  startsAt: '2035-08-24T04:00:00.000Z',
  endsAt: '2035-12-14T04:59:59.999Z',
  fromCalendar: true,
}

const membership = (): ApiMyProject => ({
  rank: 'MEMBER',
  title: null,
  team: null,
  current: true,
  project: {
    id: 'p1',
    slug: 'project-storm',
    title: 'Project S.T.O.R.M.',
    summary: 'A rover.',
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
  },
})

const context = (): DashboardContext => ({
  user: {
    id: 'u1',
    fullName: 'Rowan Chen',
    email: null,
    slug: null,
    role: 'MEMBER',
    discordUsername: null,
    photoUrl: null,
    photoFocalX: 50,
    photoFocalY: 50,
    photoZoom: 1,
  },
  projects: { status: 'ready', data: [membership()] },
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

const json = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/dashboard/projects/project-storm']}>
      <Routes>
        <Route element={<Outlet context={context()} />}>
          <Route
            path="/dashboard/projects/:slug"
            element={<ProjectDashboardPage />}
          />
          <Route path="/dashboard" element={<p>THE DASHBOARD</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ProjectDashboardPage', () => {
  it("refreshes the public page's cached roster on the way out", async () => {
    const fetchMock = vi.fn((input: string | URL | Request, _init?: RequestInit) => {
      const url = urlOf(input)

      if (url.includes('/members/me')) return json({ left: true })
      if (url.includes('/team'))
        return json({ project: membership().project, teams: [], members: [] })
      if (url.includes('/tasks')) return json([])
      if (url.includes('/projects/project-storm')) return json({})

      return Promise.reject(new Error(`no stub for ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'LEAVE THIS PROJECT' }))
    fireEvent.click(await screen.findByRole('button', { name: 'LEAVE THE PROJECT' }))

    // Left, and landed back on the dashboard.
    await screen.findByText('THE DASHBOARD')

    // The read that matters: by slug, and `reload` so the entry is *replaced*
    // rather than merely stepped around. `no-store` would leave the stale copy
    // in place, which is the bug.
    await waitFor(() => {
      const refresh = fetchMock.mock.calls.find(([input]) =>
        urlOf(input).endsWith('/projects/project-storm'),
      )
      expect(refresh).toBeDefined()
      expect(refresh?.[1]).toMatchObject({ cache: 'reload' })
    })
  })

  /**
   * Leaving has already succeeded by the time the refresh runs, so a failure
   * there must not surface as "leaving didn't work" — the row is gone either
   * way, and the worst case is a roster that is stale for under a minute.
   */
  it('still leaves when the cache refresh fails', async () => {
    const fetchMock = vi.fn((input: string | URL | Request, _init?: RequestInit) => {
      const url = urlOf(input)

      if (url.includes('/members/me')) return json({ left: true })
      if (url.includes('/team'))
        return json({ project: membership().project, teams: [], members: [] })
      if (url.includes('/tasks')) return json([])

      return Promise.reject(new Error('offline'))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'LEAVE THIS PROJECT' }))
    fireEvent.click(await screen.findByRole('button', { name: 'LEAVE THE PROJECT' }))

    expect(await screen.findByText('THE DASHBOARD')).toBeInTheDocument()
  })
})
