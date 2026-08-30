import {
  fireEvent,
  render as renderBare,
  screen,
  within,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CalendarSection } from './CalendarSection'
import type { ApiEvent } from '../../lib/api/api'
import {
  stubFetch,
  stubFetchNetworkError,
  stubFetchPending,
  urlOf,
} from '../../test/stubFetch'

/**
 * Everything here is pinned to a fixed "now" — Wednesday 12 August 2026 — so the
 * assertions can name specific squares. A calendar that reads the real clock
 * would pass in August and fail in September.
 */
const NOW = new Date(2026, 7, 12, 9, 0)

/** Local time, written the way the component reads it back. */
/**
 * The header's "All events" is a `<Link>` now that `/events` is a real page, and
 * a `<Link>` throws outside a router. Same helper, same reason, as
 * `OfficersSection.test.tsx`.
 */
const render = (ui: ReactNode) => renderBare(<MemoryRouter>{ui}</MemoryRouter>)

const local = (day: number, hour = 18, minute = 0) =>
  new Date(2026, 7, day, hour, minute).toISOString()

const event = (over: Partial<ApiEvent> = {}): ApiEvent => ({
  id: 'e1',
  slug: 'general-body-meeting',
  title: 'General Body Meeting',
  description: 'What every project is working on this cycle.',
  type: 'MEETING',
  location: 'Institute for Simulation and Training',
  startsAt: local(19),
  endsAt: local(19, 21),
  allDay: false,
  registrationUrl: null,
  ...over,
})

/** The square for a given day of the displayed month. */
const cellFor = (day: number) =>
  screen.getByText(String(day), { selector: 'td span' }).closest('td')!

/**
 * Whether a square carries an event. Each one is marked twice — a dot for the
 * narrow layout and a chip for the wide one, with CSS choosing between them.
 * Only the dot carries a `title`: the chip's hover card replaced its tooltip.
 */
const cellHas = (day: number, title: string) =>
  within(cellFor(day)).queryAllByTitle(title).length > 0

/**
 * The month heading, by role — "August 2026" also appears in the schedule label
 * below the grid, so a bare text query matches two nodes.
 */
const monthHeading = (name: string) => screen.findByRole('heading', { name })

/**
 * An event's row in the schedule. Its title is deliberately on the page twice —
 * once as a chip in its square, once as this heading — so waiting on the text
 * alone is ambiguous. Only the agenda entry is a heading.
 */
const agendaEntry = (title: string) => screen.findByRole('heading', { name: title })

/**
 * An event's whole row in the schedule. Worth scoping to: the hover card in the
 * grid prints the same time, type and location, so an unscoped query for any of
 * them now matches twice.
 */
const agendaRow = async (title: string) =>
  (await agendaEntry(title)).closest('article')!

/**
 * The square's own button — the overlay that sits behind its contents, and no
 * longer the only button in the cell: every chip is one now, and so is the "add
 * to calendar" trigger on each chip's card. Matched on the count at the end of
 * its label rather than on the whole of it, because the date in front is a
 * localised string and would tie these to whichever locale the runner has.
 */
const dayButton = (day: number) =>
  within(cellFor(day)).getByRole('button', { name: /\d+ events?$/ })

/**
 * The card a chip shows on hover. Found through the untruncated title it
 * repeats: the chip itself carries the same string, so the `<p>` is what tells
 * the two apart.
 */
const chipCard = (day: number, title: string) =>
  within(cellFor(day)).getByText(title, { selector: 'p' }).closest('div')!

/** Every event currently listed in the schedule, in order. */
const scheduled = () =>
  screen.getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)

beforeEach(() => {
  // `shouldAdvanceTime` keeps Testing Library's polling alive under fake timers.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('CalendarSection', () => {
  it('opens on the current month', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/events': [event()] }))

    render(<CalendarSection />)

    expect(await monthHeading('August 2026')).toBeInTheDocument()
  })

  it('asks for exactly the displayed month, and for past days too', async () => {
    const fetchStub = stubFetch({ '/events': [event()] })
    vi.stubGlobal('fetch', fetchStub)

    render(<CalendarSection />)
    await agendaEntry('General Body Meeting')

    const url = urlOf(fetchStub.mock.calls[0]![0])
    expect(url).toContain(`from=${encodeURIComponent(new Date(2026, 7, 1).toISOString())}`)
    expect(url).toContain(`to=${encodeURIComponent(new Date(2026, 8, 1).toISOString())}`)
    // A grid shows days that have already been, so `upcoming` would be wrong.
    expect(url).toContain('when=all')
  })

  it('puts an event on its own square', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/events': [event()] }))

    render(<CalendarSection />)
    await agendaEntry('General Body Meeting')

    expect(cellHas(19, 'General Body Meeting')).toBe(true)
    expect(cellHas(18, 'General Body Meeting')).toBe(false)
  })

  it('spans a multi-day event across every square it covers', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/events': [
          event({
            id: 'urc',
            title: 'University Rover Challenge',
            startsAt: local(20, 0),
            endsAt: new Date(2026, 7, 22, 23, 59).toISOString(),
            allDay: true,
          }),
        ],
      }),
    )

    render(<CalendarSection />)
    await agendaEntry('University Rover Challenge')

    for (const day of [20, 21, 22]) {
      expect(cellHas(day, 'University Rover Challenge'), `day ${day}`).toBe(true)
    }
    expect(cellHas(23, 'University Rover Challenge')).toBe(false)
  })

  it('says ALL DAY rather than inventing a midnight-to-midnight span', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/events': [
          event({
            title: 'STEM Saturday',
            startsAt: local(15, 0),
            endsAt: new Date(2026, 7, 15, 23, 59).toISOString(),
            allDay: true,
          }),
        ],
      }),
    )

    render(<CalendarSection />)
    const row = await agendaRow('STEM Saturday')

    expect(within(row).getByText('ALL DAY')).toBeInTheDocument()
    expect(screen.queryByText(/12:00 AM/i)).not.toBeInTheDocument()
  })

  it('lists the month below the grid with its time, type and location', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/events': [event()] }))

    render(<CalendarSection />)
    const row = await agendaRow('General Body Meeting')

    expect(within(row).getByText('6:00 PM – 9:00 PM')).toBeInTheDocument()
    expect(within(row).getByText(/MEETING/)).toHaveTextContent(
      'Institute for Simulation and Training',
    )
  })

  /**
   * The whole point of the range is that it is a range. Printing
   * "6:00 PM – 2:00 AM" against a date span reads as eight hours on the first
   * day, so anything crossing midnight has to say the day at both ends.
   */
  it('says the day at both ends of a time that crosses midnight', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/events': [
          event({
            title: 'Build Weekend',
            startsAt: local(21, 18),
            endsAt: local(23, 2),
          }),
        ],
      }),
    )

    render(<CalendarSection />)
    const row = await agendaRow('Build Weekend')

    expect(
      within(row).getByText('Aug 21, 6:00 PM – Aug 23, 2:00 AM'),
    ).toBeInTheDocument()
  })

  /**
   * A square is about a hundred pixels wide, so its chip can only ever be a
   * truncated title. The card is what carries the rest, on hover.
   */
  it('carries the detail the square has no room for on the chip’s card', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/events': [event()] }))

    render(<CalendarSection />)
    await agendaEntry('General Body Meeting')

    const square = within(cellFor(19))
    expect(square.getByText('Aug 19')).toBeInTheDocument()
    expect(square.getByText('6:00 PM – 9:00 PM')).toBeInTheDocument()
    expect(square.getByText(/what every project is working on/i)).toBeInTheDocument()
  })

  /**
   * The card holds a pointer while it is open, which is the whole reason it can
   * carry a control at all — so the shortcut off the grid is the same one the
   * schedule below offers, without opening the day first.
   */
  it('offers add to calendar on the chip’s card, without opening the day', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/events': [event()] }))

    render(<CalendarSection />)
    await agendaEntry('General Body Meeting')

    const card = within(chipCard(19, 'General Body Meeting'))
    fireEvent.click(card.getByRole('button', { name: /add to calendar/i }))

    expect(
      card.getByRole('menuitem', { name: /google calendar/i }).getAttribute('href'),
    ).toContain('calendar.google.com')
    // The menu belongs to the card, not to the day: pressing it is not a press
    // on the square behind it, so the schedule still shows the whole month.
    expect(scheduled()).toHaveLength(1)
    expect(dayButton(19)).toHaveAttribute('aria-pressed', 'false')
  })

  /**
   * A chip is drawn on top of the square's button, so without a press of its
   * own it would be the one dead strip in the grid.
   */
  it('opens the day from a press on the chip itself', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/events': [
          event(),
          event({ id: 'e2', title: 'Print Farm Clinic', startsAt: local(24) }),
        ],
      }),
    )

    render(<CalendarSection />)
    await agendaEntry('General Body Meeting')

    fireEvent.click(
      within(cellFor(19)).getByRole('button', { name: 'General Body Meeting' }),
    )

    expect(scheduled()).toEqual(['General Body Meeting'])
  })

  /**
   * The square is a target and a day with nothing on it is not one: there is
   * nothing to open, and thirty empty tab stops between the ones that matter
   * help nobody. On a phone the chips are not rendered at all, so the square is
   * the only way to reach an event from the grid.
   */
  it('makes a day with events pressable, and one without it not', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/events': [event()] }))

    render(<CalendarSection />)
    await agendaEntry('General Body Meeting')

    expect(dayButton(19)).toBeInTheDocument()
    expect(within(cellFor(18)).queryByRole('button')).not.toBeInTheDocument()
  })

  it('opens a day into the schedule, listing only what is on it', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/events': [
          event(),
          event({ id: 'e2', title: 'Print Farm Clinic', startsAt: local(24) }),
        ],
      }),
    )

    render(<CalendarSection />)
    await agendaEntry('General Body Meeting')

    expect(scheduled()).toEqual(['General Body Meeting', 'Print Farm Clinic'])

    fireEvent.click(dayButton(19))

    expect(scheduled()).toEqual(['General Body Meeting'])
    expect(await screen.findByRole('heading', { name: /august 19.*schedule/i }))
      .toBeInTheDocument()
    expect(dayButton(19)).toHaveAttribute('aria-pressed', 'true')
  })

  /**
   * `eventsOn` decides what a day holds, so a competition that runs Friday to
   * Sunday opens on all three squares — not only the one it began on.
   */
  it('opens a multi-day event on every day it covers', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/events': [
          event({
            id: 'urc',
            title: 'University Rover Challenge',
            startsAt: local(20, 0),
            endsAt: new Date(2026, 7, 22, 23, 59).toISOString(),
            allDay: true,
          }),
        ],
      }),
    )

    render(<CalendarSection />)
    await agendaEntry('University Rover Challenge')

    fireEvent.click(dayButton(22))
    expect(scheduled()).toEqual(['University Rover Challenge'])
  })

  it('gives the month back, from the square or from the button', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/events': [
          event(),
          event({ id: 'e2', title: 'Print Farm Clinic', startsAt: local(24) }),
        ],
      }),
    )

    render(<CalendarSection />)
    await agendaEntry('General Body Meeting')

    // Pressing the open square again closes it — the button below the grid can
    // be off screen on a phone, so the square has to work both ways.
    fireEvent.click(dayButton(19))
    fireEvent.click(dayButton(19))
    expect(scheduled()).toHaveLength(2)

    fireEvent.click(dayButton(19))
    fireEvent.click(screen.getByRole('button', { name: /whole month/i }))
    expect(scheduled()).toHaveLength(2)
  })

  /**
   * The selected day is not in the month being moved to, and a filter whose
   * cell you can no longer see is a filter you cannot undo.
   */
  it('drops the open day when the month changes', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/events': [event()] }))

    render(<CalendarSection />)
    await agendaEntry('General Body Meeting')

    fireEvent.click(dayButton(19))
    fireEvent.click(screen.getByRole('button', { name: /next month/i }))

    await monthHeading('September 2026')
    expect(
      screen.queryByRole('button', { name: /whole month/i }),
    ).not.toBeInTheDocument()
  })

  it('refetches the new range when the month is changed', async () => {
    const fetchStub = stubFetch({ '/events': [event()] })
    vi.stubGlobal('fetch', fetchStub)

    render(<CalendarSection />)
    await agendaEntry('General Body Meeting')

    fireEvent.click(screen.getByRole('button', { name: /next month/i }))

    expect(await monthHeading('September 2026')).toBeInTheDocument()
    const url = urlOf(fetchStub.mock.calls.at(-1)![0])
    expect(url).toContain(`from=${encodeURIComponent(new Date(2026, 8, 1).toISOString())}`)
  })

  it('offers a way back to today only once you have left it', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/events': [event()] }))

    render(<CalendarSection />)
    await monthHeading('August 2026')
    expect(screen.queryByRole('button', { name: 'TODAY' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /previous month/i }))
    await monthHeading('July 2026')

    fireEvent.click(screen.getByRole('button', { name: 'TODAY' }))
    expect(await monthHeading('August 2026')).toBeInTheDocument()
  })

  it('draws the grid before the events land, so nothing reflows', async () => {
    vi.stubGlobal('fetch', stubFetchPending())

    render(<CalendarSection />)

    // The month is date arithmetic, not data — August 2026 has 31 days.
    expect(screen.getByText('31', { selector: 'td span' })).toBeInTheDocument()
    expect(await monthHeading('August 2026')).toBeInTheDocument()
  })

  it('says so when the month is empty rather than rendering nothing', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/events': [] }))

    render(<CalendarSection />)

    expect(
      await screen.findByText(/nothing on the calendar this month/i),
    ).toBeInTheDocument()
    // The grid is still there to navigate away from.
    expect(screen.getByText('31', { selector: 'td span' })).toBeInTheDocument()
  })

  it('explains itself when the API is unreachable, and keeps the grid', async () => {
    vi.stubGlobal('fetch', stubFetchNetworkError())
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<CalendarSection />)

    expect(await screen.findByText(/couldn't load the calendar/i)).toBeInTheDocument()
    expect(screen.getByText('31', { selector: 'td span' })).toBeInTheDocument()
    consoleError.mockRestore()
  })
})
