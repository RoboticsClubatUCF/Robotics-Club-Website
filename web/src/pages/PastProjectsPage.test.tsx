import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { PastProjectsPage } from './PastProjectsPage'
import type { DashboardContext } from '../components/dashboard/DashboardLayout'
import type { ApiMyProject, ApiTerm } from '../lib/api'

/**
 * Everything somebody has ever been on, minus what they are on now.
 *
 * The page makes no request of its own — the layout already fetched every
 * membership and flagged each one — so these render it against a context rather
 * than a stubbed `fetch`. What is worth asserting is the grouping: a build run
 * three years running is three rows with one name, and the term heading is the
 * only thing that tells them apart.
 */

const term: ApiTerm = {
  year: 2035,
  season: 'FALL',
  startsAt: '2035-08-24T04:00:00.000Z',
  endsAt: '2035-12-14T04:59:59.999Z',
  fromCalendar: true,
}

const membership = (
  over: Partial<ApiMyProject> & {
    id?: string
    title?: string
    termYear?: number
    termSeason?: 'SPRING' | 'SUMMER' | 'FALL'
  } = {},
): ApiMyProject => ({
  rank: over.rank ?? 'MEMBER',
  title: null,
  team: null,
  current: over.current ?? false,
  project: {
    id: over.id ?? 'p1',
    slug: over.id ?? 'rover',
    title: over.title ?? 'Rover',
    summary: 'A rover.',
    season: null,
    termYear: over.termYear ?? 2034,
    termSeason: over.termSeason ?? 'SPRING',
    competition: null,
    status: 'COMPLETED',
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
})

const context = (projects: DashboardContext['projects']): DashboardContext => ({
  user: {
    id: 'u1',
    fullName: 'Member Test',
    email: null,
    slug: null,
    role: 'MEMBER',
    discordUsername: null,
  },
  projects,
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

const renderPage = (projects: DashboardContext['projects']) =>
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={context(projects)} />}>
          <Route path="/" element={<PastProjectsPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

describe('PastProjectsPage', () => {
  it('groups by term, newest first', () => {
    renderPage({
      status: 'ready',
      data: [
        membership({ id: 'a', title: 'Rover One', termYear: 2034, termSeason: 'SPRING' }),
        membership({ id: 'b', title: 'Rover Two', termYear: 2035, termSeason: 'SPRING' }),
        membership({ id: 'c', title: 'Blimp', termYear: 2034, termSeason: 'FALL' }),
      ],
    })

    const headings = screen
      .getAllByText(/^(SPRING|SUMMER|FALL) \d{4}$/)
      .map((node) => node.textContent)

    // `Season` is declared in calendar order on the server, so within a year
    // the sort is just the index — fall 2034 is after spring 2034.
    expect(headings).toEqual(['SPRING 2035', 'FALL 2034', 'SPRING 2034'])
  })

  /** The same build run twice is two rows, and the term is what separates them. */
  it('lists one project under each of the terms it ran in', () => {
    renderPage({
      status: 'ready',
      data: [
        membership({ id: 'a', title: 'Rover', termYear: 2034, termSeason: 'FALL' }),
        membership({ id: 'b', title: 'Rover', termYear: 2035, termSeason: 'SPRING' }),
      ],
    })

    expect(screen.getAllByRole('link', { name: 'Rover' })).toHaveLength(2)
    expect(screen.getByText('FALL 2034')).toBeInTheDocument()
    expect(screen.getByText('SPRING 2035')).toBeInTheDocument()
  })

  /** This term's are the rail's business, not this page's. */
  it('leaves out anything still running', () => {
    renderPage({
      status: 'ready',
      data: [
        membership({ id: 'a', title: 'Old Rover' }),
        membership({ id: 'b', title: 'New Rover', current: true, termYear: 2035 }),
      ],
    })

    expect(screen.getByRole('link', { name: 'Old Rover' })).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'New Rover' }),
    ).not.toBeInTheDocument()
  })

  /**
   * Still a link. Nothing about a past project is closed — the roster, the
   * tasks and the write-up are all still there, and its lead still leads it.
   */
  it('links each row to the project, and prints the standing', () => {
    renderPage({
      status: 'ready',
      data: [membership({ id: 'rover', rank: 'PROJECT_LEAD' })],
    })

    expect(screen.getByRole('link', { name: 'Rover' })).toHaveAttribute(
      'href',
      '/dashboard/projects/rover',
    )
    expect(screen.getByText('Project lead')).toBeInTheDocument()
  })

  it('says so when there is nothing behind them yet', () => {
    renderPage({ status: 'ready', data: [membership({ current: true })] })

    expect(screen.getByText(/Nothing here yet/)).toBeInTheDocument()
  })

  /** All three states, because the layout's one fetch can be in any of them. */
  it('shows a skeleton while the layout is still loading', () => {
    const { container } = renderPage({ status: 'loading' })

    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  })

  it('degrades to a sentence when that read failed', () => {
    renderPage({ status: 'error', code: 500 })

    expect(screen.getByText(/couldn’t load your projects/i)).toBeInTheDocument()
  })

  it('keeps every link inside the dashboard', () => {
    renderPage({
      status: 'ready',
      data: [membership({ id: 'a' }), membership({ id: 'b', termYear: 2033 })],
    })

    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href')).toMatch(/^\/dashboard/)
    }
  })

  it('names the page rather than the section', () => {
    renderPage({ status: 'ready', data: [membership()] })

    // The rail already says MY PROJECTS; the eyebrow says which page this is.
    expect(screen.getByText('/ MY PROJECTS · PAST')).toBeInTheDocument()
    expect(
      within(screen.getByRole('heading', { level: 1 })).getByText(
        /What you.ve worked on/,
      ),
    ).toBeInTheDocument()
  })
})
