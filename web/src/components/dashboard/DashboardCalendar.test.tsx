import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardCalendar } from './DashboardCalendar'
import type { ApiMeEvent, ApiMeetingSeries } from '../../lib/api/api'
import { stubFetch, stubFetchStatus, urlOf } from '../../test/stubFetch'

/**
 * Pinned to a fixed "now" — Wednesday 12 August 2026 — the same one the public calendar's suite
 * uses, because everything here is about which square a thing lands on and a test reading the real
 * clock would drift.
 *
 * This suite used to prove the weekday arithmetic: the component expanded `meetingWeekday` into a
 * chip per matching Thursday, and the test walked August's Thursdays. That expansion has moved to
 * `server/src/projects/meetings.ts`, where it can see the term's end and finals week. What is left
 * to prove here is what the component still does: ask the right endpoint, and draw whatever comes
 * back — meetings and stored events alike, with no idea which is which.
 */
const NOW = new Date(2026, 7, 12, 9, 0)

const series: ApiMeetingSeries = {
  projectSlug: 'rover',
  projectTitle: 'Rover',
  weekdays: [2, 4],
  startTime: '18:00',
  endTime: '22:00',
  location: 'ENG2 Lab',
  untilDate: new Date(2026, 11, 13, 23, 59).toISOString(),
  skip: null,
  skipDates: [],
}

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

/** A generated meeting, shaped the way the server sends one. */
const meeting = (day: number): ApiMeEvent =>
  meEvent({
    id: `meeting:p1:${new Date(2026, 7, day, 18, 0).toISOString()}`,
    slug: 'rover',
    title: 'Rover meeting',
    location: 'ENG2 Lab',
    startsAt: new Date(2026, 7, day, 18, 0).toISOString(),
    endsAt: new Date(2026, 7, day, 22, 0).toISOString(),
    published: true,
    meeting: series,
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

    render(<DashboardCalendar />)
    await screen.findByRole('heading', { name: 'August 2026' })

    expect(urlOf(fetchStub.mock.calls[0]![0])).toContain('/me/events')
  })

  it('asks for the month it is showing, both ends of it', async () => {
    const fetchStub = stubFetch({ '/me/events': [] })
    vi.stubGlobal('fetch', fetchStub)

    render(<DashboardCalendar />)
    await screen.findByRole('heading', { name: 'August 2026' })

    // Both bounds, because the server only expands meetings for a window it
    // can see the far end of — one without a `to` gets stored rows and nothing
    // else, which would be a calendar with no meetings on it.
    const asked = urlOf(fetchStub.mock.calls[0]![0])
    expect(asked).toContain('from=')
    expect(asked).toContain('to=')
  })

  /**
   * The second request is the list under the grid, which is not the month — see
   * `MonthCalendar`. No `to`, so it runs on past the end of it; the meetings and
   * the member's own deadlines still come from the windowed one above.
   */
  it('asks a second time for everything ahead, with no far end', async () => {
    const fetchStub = stubFetch({ '/me/events': [] })
    vi.stubGlobal('fetch', fetchStub)

    render(<DashboardCalendar />)
    await screen.findByRole('heading', { name: 'August 2026' })

    const asked = urlOf(fetchStub.mock.calls[1]![0])
    expect(asked).toContain(`from=${encodeURIComponent(NOW.toISOString())}`)
    expect(asked).not.toContain('to=')
  })

  it('draws generated meetings and stored events alike', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/me/events': [meEvent(), meeting(20), meeting(25)] }),
    )

    render(<DashboardCalendar />)
    await screen.findByRole('heading', { name: 'August 2026' })

    expect(cellHas(21, 'Kickoff')).toBe(true)
    expect(cellHas(20, 'Rover meeting')).toBe(true)
    expect(cellHas(25, 'Rover meeting')).toBe(true)
  })

  it('invents nothing when the server sends no meetings', async () => {
    // The component has no schedule to expand any more, so an empty response is
    // an empty calendar. This is the tripwire for anybody reintroducing
    // client-side expansion: it would start painting chips again.
    vi.stubGlobal('fetch', stubFetch({ '/me/events': [] }))

    render(<DashboardCalendar />)
    await screen.findByRole('heading', { name: 'August 2026' })

    expect(screen.queryAllByTitle('Rover meeting')).toHaveLength(0)
  })

  it('says so when the calendar cannot be reached', async () => {
    vi.stubGlobal('fetch', stubFetchStatus(500))

    render(<DashboardCalendar />)

    expect(
      await screen.findByText(/couldn't load the calendar/i),
    ).toBeInTheDocument()
  })
})
