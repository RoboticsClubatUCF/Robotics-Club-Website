import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardCalendar } from './DashboardCalendar'
import type { ApiMeEvent, ApiMyProject } from '../../lib/api'
import { stubFetch, urlOf } from '../../test/stubFetch'

/**
 * Pinned to the same fixed "now" the public calendar's suite uses — Wednesday
 * 12 August 2026 — because the thing under test is weekday arithmetic: a
 * Thursday-meeting project must put a chip on every Thursday of the shown
 * month and nowhere else. A test reading the real clock would drift.
 */
const NOW = new Date(2026, 7, 12, 9, 0)

/** August 2026's Thursdays. */
const THURSDAYS = [6, 13, 20, 27]

const membership = (over: Partial<ApiMyProject['project']> = {}): ApiMyProject => ({
  rank: 'MEMBER',
  title: null,
  team: null,
  project: {
    id: 'p1',
    slug: 'rover',
    title: 'Rover',
    summary: null,
    season: null,
    competition: null,
    status: 'IN_PROGRESS',
    coverUrl: null,
    repoUrl: null,
    featured: false,
    startedAt: null,
    completedAt: null,
    meetingWeekday: 4,
    meetingTime: '18:30',
    meetingLocation: 'ENG2 Lab',
    ...over,
  },
})

const meEvent = (over: Partial<ApiMeEvent> = {}): ApiMeEvent => ({
  id: 'e1',
  slug: 'kickoff',
  title: 'Kickoff',
  description: null,
  type: 'MEETING',
  location: null,
  startsAt: new Date(2026, 7, 21, 18, 0).toISOString(),
  endsAt: null,
  allDay: false,
  registrationUrl: null,
  published: false,
  projectId: 'p1',
  teamId: null,
  createdById: null,
  project: { slug: 'rover', title: 'Rover' },
  team: null,
  ...over,
})

const cellFor = (day: number) =>
  screen.getByText(String(day), { selector: 'td span' }).closest('td')!

/** The narrow layout's dot is the one marker that carries a `title`. */
const cellHas = (day: number, title: string) =>
  within(cellFor(day)).queryAllByTitle(title).length > 0

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('DashboardCalendar', () => {
  it('asks the member endpoint, not the public one', async () => {
    const fetchStub = stubFetch({ '/me/events': [] })
    vi.stubGlobal('fetch', fetchStub)

    render(
      <DashboardCalendar
        projects={{ status: 'ready', data: [membership()] }}
      />,
    )
    await screen.findByRole('heading', { name: 'August 2026' })

    expect(urlOf(fetchStub.mock.calls[0]![0])).toContain('/me/events')
  })

  it('paints the weekly meeting on every matching weekday, and only those', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/me/events': [] }))

    render(
      <DashboardCalendar
        projects={{ status: 'ready', data: [membership()] }}
      />,
    )
    await screen.findByRole('heading', { name: 'August 2026' })

    for (const thursday of THURSDAYS) {
      expect(cellHas(thursday, 'Rover meeting'), `Aug ${thursday}`).toBe(true)
    }
    // A Wednesday and a Friday, straddling a meeting day.
    expect(cellHas(12, 'Rover meeting')).toBe(false)
    expect(cellHas(14, 'Rover meeting')).toBe(false)
  })

  it('shows real events and synthetic meetings together', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/me/events': [meEvent()] }))

    render(
      <DashboardCalendar
        projects={{ status: 'ready', data: [membership()] }}
      />,
    )
    await screen.findByRole('heading', { name: 'August 2026' })

    // The real event on its Friday square, the meeting on its Thursdays.
    expect(cellHas(21, 'Kickoff')).toBe(true)
    expect(cellHas(20, 'Rover meeting')).toBe(true)
  })

  it('paints nothing synthetic for a project with no schedule', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/me/events': [] }))

    render(
      <DashboardCalendar
        projects={{
          status: 'ready',
          data: [membership({ meetingWeekday: null, meetingTime: null })],
        }}
      />,
    )
    await screen.findByRole('heading', { name: 'August 2026' })

    expect(screen.queryAllByTitle('Rover meeting')).toHaveLength(0)
  })
})
