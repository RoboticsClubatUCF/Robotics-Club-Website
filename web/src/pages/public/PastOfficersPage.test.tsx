import {
  fireEvent,
  render as renderBare,
  screen,
  within,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PastOfficersPage } from './PastOfficersPage'
import type { ApiOfficerTerm, OfficerPosition } from '../../lib/api/api'
import {
  stubFetch,
  stubFetchNetworkError,
  stubFetchPending,
  urlOf,
} from '../../test/stubFetch'

/** The page links back to the front page's board with a plain `<a>`, but the
    layout around it is a router's, and so is anything this grows. */
const render = (ui: ReactNode) => renderBare(<MemoryRouter>{ui}</MemoryRouter>)

/** Written in academic years because that is how a board is talked about; the
    dates are the storage, August to May. */
const term = (
  position: OfficerPosition | null,
  startYear: number,
  endYear: number,
  fullName: string,
  photoUrl: string | null = null,
): ApiOfficerTerm => ({
  id: `${position ?? 'NONE'}-${String(startYear)}-${fullName}`,
  position,
  startedAt: `${String(startYear)}-08-01T00:00:00.000Z`,
  endedAt:
    endYear > startYear
      ? `${String(endYear)}-05-31T00:00:00.000Z`
      : `${String(startYear)}-12-31T00:00:00.000Z`,
  fullName,
  photoUrl,
  profileUrl: null,
})

/** As the route sends it: newest start first, board order inside. */
const archive: ApiOfficerTerm[] = [
  term('PRESIDENT', 2024, 2025, 'Priya Raman'),
  term('TREASURER', 2024, 2025, 'Elena Vasquez'),
  term('PRESIDENT', 2023, 2024, 'Grace Okonkwo'),
  term('PRESIDENT', 2022, 2023, 'Ryan Delacroix'),
  term('PRESIDENT', 2022, 2023, 'Mei-Lin Zhao'),
]

/**
 * The archive as the route answers it: a *window* plus how much is outside it.
 * `older` defaults to none, so a case that does not care about the window
 * behaves as though the whole archive arrived.
 */
/**
 * The seats a window used, in board order — the route works this out from the
 * rows it is returning, because it can see how `OfficerPosition` is declared
 * and the browser cannot. The page keeps no list of the seats at all now, so
 * this fixture is standing in for the database.
 */
const SEATS = [
  'PRESIDENT',
  'VICE_PRESIDENT',
  'TREASURER',
  'SECRETARY',
  'MARKETING',
  'OUTREACH',
  'LAB_MANAGER',
  'FACULTY_ADVISOR',
] as const

const seatsAmong = (terms: ApiOfficerTerm[]) => {
  const held = new Set(terms.map((term) => term.position))
  return SEATS.filter((seat) => held.has(seat))
}

const stub = (terms: ApiOfficerTerm[] = archive, older = 0) =>
  vi.stubGlobal(
    'fetch',
    stubFetch({ '/officers/past': { terms, older, seats: seatsAmong(terms) } }),
  )

/** Two answers keyed on `all=1`: the default window, then everything. The page
    fetches the second only when asked. */
const stubWindow = (windowed: ApiOfficerTerm[], everything: ApiOfficerTerm[]) =>
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            urlOf(input).includes('all=1')
              ? { terms: everything, older: 0, seats: seatsAmong(everything) }
              : {
                  terms: windowed,
                  older: everything.length - windowed.length,
                  seats: seatsAmong(windowed),
                },
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    ),
  )

const search = () => screen.getByRole('searchbox')
const chip = (label: string | RegExp) => screen.getByRole('button', { name: label })

/**
 * The captions under one year's heading, in order.
 *
 * Scoped to the heading's own block, so this asserts on one year rather than the page. The caption
 * rather than the whole card, because an empty frame draws `[ PHOTO ]` and that isn't what these
 * tests are about.
 */
const cardsUnder = (year: string) =>
  within(screen.getByRole('heading', { name: year }).parentElement!)
    .getAllByRole('listitem')
    // The seat and the name, which is what these assertions are about. The
    // third caption line is the served range and has a case of its own.
    .map((card) => {
      const lines = [...card.querySelector('figcaption')!.children]
      return lines
        .slice(0, 2)
        .map((line) => line.textContent)
        .join('')
    })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PastOfficersPage', () => {
  it('groups the archive under the year each term was served', async () => {
    stub()
    render(<PastOfficersPage />)
    await screen.findByText('Priya Raman')

    // Newest first, and the server's order is kept rather than re-sorted.
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['2024–2025', '2023–2024', '2022–2023'])

    expect(cardsUnder('2024–2025')).toEqual([
      'PresidentPriya Raman',
      'TreasurerElena Vasquez',
    ])
  })

  /**
   * The archive draws the landing board's card, so the caption is the seat and
   * the name and nothing else — no year, no seat number, nothing that would
   * make a past officer read as a different kind of thing from a sitting one.
   */
  it('captions a card with the seat and the name, the way the board does', async () => {
    stub([term('LAB_MANAGER', 2024, 2025, 'Aisha Bello')])
    render(<PastOfficersPage />)
    await screen.findByText('Aisha Bello')

    const caption = screen.getByText('Lab Manager').closest('figcaption')!

    expect(caption.textContent).toContain('Lab Manager')
    expect(caption.textContent).toContain('Aisha Bello')
    // The served range, and nothing beyond those three lines.
    expect(caption.textContent).toMatch(/2024/)
    expect(caption.textContent).not.toMatch(/Treasurer/)
  })

  it('frames a headshot when there is one and holds the space when there is not', async () => {
    stub([
      term('PRESIDENT', 2024, 2025, 'Priya Raman', 'https://example.com/priya.jpg'),
      term('TREASURER', 2024, 2025, 'Elena Vasquez'),
    ])
    const { container } = render(<PastOfficersPage />)
    await screen.findByText('Priya Raman')

    const headshot = container.querySelector('img')
    expect(headshot).toHaveAttribute('src', 'https://example.com/priya.jpg')
    // Decorative — the name is printed right below it.
    expect(headshot).toHaveAttribute('alt', '')
    expect(screen.getAllByText('[ PHOTO ]')).toHaveLength(1)
    expect(container.querySelectorAll('.aspect-square')).toHaveLength(2)
  })

  /**
   * The dates are the record now — the sync stamps them when a Discord role is
   * gained and lost — so a card says the span somebody served rather than only
   * the year it is filed under.
   */
  it('prints the span each officer served, under their name', async () => {
    stub([term('PRESIDENT', 2024, 2025, 'Priya Raman')])
    render(<PastOfficersPage />)
    await screen.findByText('Priya Raman')

    const caption = screen.getByText('Priya Raman').closest('figcaption')!

    expect(caption.textContent).toMatch(/2024/)
    expect(caption.textContent).toMatch(/2025/)
  })

  /**
   * Discord decides *that* somebody is an officer; the roles desk decides which
   * chair. Somebody who served without ever being given a named seat is a real
   * row, and a card with a blank gold line would read as a rendering bug.
   */
  it('calls a seatless term an officer rather than drawing a blank', async () => {
    stub([term(null, 2024, 2025, 'Unseated Officer')])
    render(<PastOfficersPage />)
    await screen.findByText('Unseated Officer')

    expect(screen.getByText('Officer')).toBeInTheDocument()
  })

  it('searches by name, in any word order', async () => {
    stub()
    render(<PastOfficersPage />)
    await screen.findByText('Priya Raman')

    fireEvent.change(search(), { target: { value: 'raman priya' } })

    expect(screen.getByText('Priya Raman')).toBeInTheDocument()
    expect(screen.queryByText('Grace Okonkwo')).not.toBeInTheDocument()
    // The year it was served comes with it; the years with no match are gone.
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['2024–2025'])
  })

  it('filters to one seat across every year', async () => {
    stub()
    render(<PastOfficersPage />)
    await screen.findByText('Priya Raman')

    fireEvent.click(chip('TREASURER'))

    expect(screen.getByText('Elena Vasquez')).toBeInTheDocument()
    expect(screen.queryByText('Priya Raman')).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1)
  })

  it('filters to one year across every seat', async () => {
    stub()
    render(<PastOfficersPage />)
    await screen.findByText('Priya Raman')

    fireEvent.click(chip('2023–2024'))

    expect(screen.getByText('Grace Okonkwo')).toBeInTheDocument()
    expect(screen.queryByText('Elena Vasquez')).not.toBeInTheDocument()
  })

  /**
   * The three controls narrow the same list rather than replacing each other's
   * answer — this is the combination that would silently pass if any one of
   * them were applied last and won outright.
   */
  it('applies the search and both filters together', async () => {
    stub()
    render(<PastOfficersPage />)
    await screen.findByText('Priya Raman')

    fireEvent.click(chip('PRESIDENT'))
    fireEvent.click(chip('2022–2023'))
    fireEvent.change(search(), { target: { value: 'mei' } })

    expect(screen.getByText('Mei-Lin Zhao')).toBeInTheDocument()
    expect(screen.queryByText('Ryan Delacroix')).not.toBeInTheDocument()
    expect(screen.queryByText('Priya Raman')).not.toBeInTheDocument()
  })

  /**
   * Two presidents in one year is a resignation mid-term, which the database
   * allows on purpose. Both belong under the one heading — a page that showed
   * only one of them would be quietly rewriting the club's history.
   */
  it('shows both holders when a seat changed hands mid-year', async () => {
    stub()
    render(<PastOfficersPage />)
    await screen.findByText('Priya Raman')

    expect(cardsUnder('2022–2023')).toEqual([
      'PresidentRyan Delacroix',
      'PresidentMei-Lin Zhao',
    ])
  })

  it('offers only the years the archive actually holds', async () => {
    stub()
    render(<PastOfficersPage />)
    await screen.findByText('Priya Raman')

    expect(chip('2024–2025')).toBeInTheDocument()
    // Nothing was served in 2021, so there is no chip that can only ever show
    // an empty page.
    expect(screen.queryByRole('button', { name: '2021–2022' })).not.toBeInTheDocument()
  })

  /** The seat row follows the same rule as the year row, and for the same
      reason: the eight seats are a list in the frontend, but which of them this
      page offers comes from the rows it was sent. */
  it('offers only the seats the archive actually holds', async () => {
    stub([term('TREASURER', 2024, 2025, 'Elena Vasquez')])
    render(<PastOfficersPage />)
    await screen.findByText('Elena Vasquez')

    expect(chip('TREASURER')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'PRESIDENT' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'FACULTY ADVISOR' }),
    ).not.toBeInTheDocument()
  })

  it('says so when nothing matches, and how to get back', async () => {
    stub()
    render(<PastOfficersPage />)
    await screen.findByText('Priya Raman')

    fireEvent.change(search(), { target: { value: 'nobody' } })

    expect(screen.getByText(/nothing in the archive matches/i)).toBeInTheDocument()
    expect(screen.getByText('NO MATCHES')).toBeInTheDocument()
    // The controls stay put — a dead end with no way out of it is the failure.
    expect(chip('ALL SEATS')).toBeInTheDocument()
    expect(search()).toBeInTheDocument()
  })

  it('says the archive is empty rather than showing controls for nothing', async () => {
    stub([])
    render(<PastOfficersPage />)

    expect(await screen.findByText(/no past officers have been recorded/i)).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })

  it('reports a failure without blanking the page', async () => {
    vi.stubGlobal('fetch', stubFetchNetworkError())
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<PastOfficersPage />)

    expect(await screen.findByText(/couldn’t load the officer archive/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Past Officers' })).toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('holds the shape of the page while loading, and offers no controls yet', () => {
    vi.stubGlobal('fetch', stubFetchPending())

    const { container } = render(<PastOfficersPage />)

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    // A search box that cannot search anything yet is worse than one a moment
    // late, and "no matches" before the response has landed would be a lie.
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.queryByText('NO MATCHES')).not.toBeInTheDocument()
  })

  /**
   * The window.
   *
   * The page opens on the two most recent years the archive holds, because a
   * fifty-year club is a few hundred cards and every one asks for a headshot.
   * The rest has to stay reachable or the archive is a claim it does not keep.
   */
  describe('the two-year window', () => {
    const recent = [
      term('PRESIDENT', 2024, 2025, 'Priya Raman'),
      term('PRESIDENT', 2023, 2024, 'Grace Okonkwo'),
    ]
    const everything = [...recent, term('PRESIDENT', 2019, 2020, 'Ancient President')]

    it('says how much is outside the window', async () => {
      stubWindow(recent, everything)
      render(<PastOfficersPage />)
      await screen.findByText('Priya Raman')

      expect(screen.getByText(/1 earlier term is on record/i)).toBeInTheDocument()
    })

    it('does not ask for the earlier years until told to', async () => {
      stubWindow(recent, everything)
      render(<PastOfficersPage />)
      await screen.findByText('Priya Raman')

      expect(screen.queryByText('Ancient President')).not.toBeInTheDocument()
      expect(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([input]) =>
          urlOf(input as string).includes('all=1'),
        ),
      ).toBe(false)
    })

    it('fetches the rest when asked, and stops offering', async () => {
      stubWindow(recent, everything)
      render(<PastOfficersPage />)
      await screen.findByText('Priya Raman')

      fireEvent.click(screen.getByRole('button', { name: /show every year/i }))

      expect(await screen.findByText('Ancient President')).toBeInTheDocument()
      // Nothing left outside the window, so nothing left to offer.
      expect(screen.queryByRole('button', { name: /show every year/i })).not.toBeInTheDocument()
    })

    /** The seats and years those older terms used arrive with them. */
    it('widens the chips along with the cards', async () => {
      stubWindow(recent, [
        ...recent,
        term('LAB_MANAGER', 2019, 2020, 'Ancient Lab Manager'),
      ])
      render(<PastOfficersPage />)
      await screen.findByText('Priya Raman')

      expect(screen.queryByRole('button', { name: 'LAB MANAGER' })).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /show every year/i }))
      await screen.findByText('Ancient Lab Manager')

      expect(chip('LAB MANAGER')).toBeInTheDocument()
      expect(chip('2019–2020')).toBeInTheDocument()
    })

    /** Nothing to offer when the whole archive already arrived. */
    it('offers nothing when there is nothing older', async () => {
      stub()
      render(<PastOfficersPage />)
      await screen.findByText('Priya Raman')

      expect(screen.queryByRole('button', { name: /show every year/i })).not.toBeInTheDocument()
    })
  })
})
