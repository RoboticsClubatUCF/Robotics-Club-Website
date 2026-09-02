import { render as renderBare, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfficersSection } from './OfficersSection'
import type { ApiOfficerTerm, OfficerPosition } from '../../lib/api/api'
import { stubFetch, stubFetchNetworkError, stubFetchPending } from '../../test/stubFetch'

/**
 * The section's "Past officers" link is a `<Link>` — the archive is a real
 * route, unlike the `/members` page the header used to point at — and a `<Link>`
 * throws outside a router. Same helper, same reason, as `SiteNav.test.tsx`.
 */
const render = (ui: ReactNode) => renderBare(<MemoryRouter>{ui}</MemoryRouter>)

/**
 * The seats there are, as the route sends them — the `OfficerPosition` enum in
 * board order.
 *
 * **The frontend keeps no list of these any more**, which is what these tests
 * are mostly about: how many seats the club has is the database's answer, so
 * this fixture is standing in for the database rather than mirroring a constant
 * the page also reads.
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

/**
 * An open term, which is what `GET /api/officers` answers with. The board is a
 * tenure with dates rather than a column on a person — that is what lets an
 * admin sit on it, and what puts somebody who leaves on `/officers` rather than
 * nowhere at all.
 */
const officer = (
  position: OfficerPosition | null,
  over: Partial<ApiOfficerTerm> = {},
): ApiOfficerTerm => ({
  id: position ?? 'seatless',
  position,
  startedAt: '2025-08-01T00:00:00.000Z',
  endedAt: null,
  fullName: 'Jordan Ellis',
  photoUrl: null,
  profileUrl: null,
  ...over,
})

const stub = (
  officers: ApiOfficerTerm[],
  seats: readonly string[] = SEATS,
) => vi.stubGlobal('fetch', stubFetch({ '/officers': { seats, officers } }))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OfficersSection', () => {
  /**
   * **The size of the board is the database's answer, not this file's.**
   *
   * It was a fixed eight from a list in `content/home.ts`, and the club could
   * not change the shape of its own board without a frontend edit. A response
   * carrying five seats draws five cards.
   */
  it('draws as many cards as the club has seats', async () => {
    stub([officer('PRESIDENT')], ['PRESIDENT', 'TREASURER', 'SECRETARY'])

    render(<OfficersSection />)
    await screen.findByText('Jordan Ellis')

    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('President')).toBeInTheDocument()
    expect(screen.getByText('Treasurer')).toBeInTheDocument()
    // And nothing invented beyond what was sent.
    expect(screen.queryByText('Lab Manager')).not.toBeInTheDocument()
  })

  /** A seat added to the enum reaches the page with no frontend change — the
      case the old fixed list made impossible. */
  it('draws a seat it has never heard of', async () => {
    stub([], [...SEATS, 'SAFETY_OFFICER'])

    render(<OfficersSection />)
    await screen.findByText('Safety Officer')

    expect(screen.getAllByRole('listitem')).toHaveLength(9)
  })

  /**
   * The half of the old design that was right: a club with no treasurer this
   * term still has a treasurer's seat, and a card saying so beats a shorter
   * board that looks like the club shrank.
   */
  it('still draws the chairs nobody is in', async () => {
    stub([officer('PRESIDENT')])

    render(<OfficersSection />)
    await screen.findByText('Jordan Ellis')

    expect(screen.getAllByRole('listitem')).toHaveLength(8)
    expect(screen.getAllByText('Seat open')).toHaveLength(7)
  })

  /**
   * **An officer with no seat is on the board.** This is the other thing the
   * fixed eight made impossible: the Discord sync promotes somebody the moment
   * they carry the role, and until an officer gives them a chair they held no
   * position — so a real officer was invisible here while being an officer
   * everywhere else on the site.
   */
  it('draws an officer who holds no named seat', async () => {
    stub([
      officer('PRESIDENT'),
      officer(null, { id: 'x1', fullName: 'Newly Promoted' }),
    ])

    render(<OfficersSection />)
    await screen.findByText('Newly Promoted')

    // Eight seats plus the one person waiting for one.
    expect(screen.getAllByRole('listitem')).toHaveLength(9)
    expect(screen.getByText('Officer')).toBeInTheDocument()
  })

  /** Last, not in amongst the seated: a card between two named seats reads as
      holding whichever one came above it. */
  it('puts the seatless after the seats', async () => {
    stub([officer('PRESIDENT'), officer(null, { id: 'x1', fullName: 'Newly Promoted' })])

    render(<OfficersSection />)
    await screen.findByText('Newly Promoted')

    const cards = screen.getAllByRole('listitem')
    expect(cards.at(-1)!.textContent).toContain('Newly Promoted')
  })

  it('puts each officer in their own seat', async () => {
    stub([
      officer('PRESIDENT', { fullName: 'Jordan Ellis' }),
      officer('FACULTY_ADVISOR', { fullName: 'Dr. Alina Petrov' }),
    ])

    render(<OfficersSection />)
    await screen.findByText('Jordan Ellis')

    const cardFor = (label: string) =>
      screen.getByText(label).closest('li')!.textContent

    expect(cardFor('President')).toContain('Jordan Ellis')
    // The advisor holds a seat while being a plain MEMBER by role. The term is
    // what places them, which is the whole reason this is not
    // `/members?role=OFFICER`.
    expect(cardFor('Faculty Advisor')).toContain('Dr. Alina Petrov')
  })

  /**
   * The seat's wording comes from the value, not from a table beside it. That
   * is what lets a seat the frontend has never seen still print properly.
   */
  it('writes a seat name out of its enum value', async () => {
    stub([], ['VICE_PRESIDENT', 'LAB_MANAGER'])

    render(<OfficersSection />)
    await screen.findByText('Vice President')

    expect(screen.getByText('Lab Manager')).toBeInTheDocument()
  })

  /**
   * The header used to read "Full roster" and point at `/members`, which is
   * still an empty file and still 404s. This one points at a page that exists,
   * and it is the archive's only entrance from the front of the site.
   */
  it('sends the header link to the archive', async () => {
    stub([officer('PRESIDENT')])

    render(<OfficersSection />)
    await screen.findByText('Jordan Ellis')

    expect(screen.getByRole('link', { name: /past officers/i })).toHaveAttribute(
      'href',
      '/officers',
    )
  })

  /**
   * The caption is the seat and the name, full stop. Everything else about a
   * term — when it started, who linked it — is deliberately dropped, and it
   * would be easy to add the dates back "just for the president" and end up
   * with a board of uneven cards.
   */
  it('captions a card with the seat and the name and nothing else', async () => {
    stub([officer('PRESIDENT', { startedAt: '2019-08-01T00:00:00.000Z' })], ['PRESIDENT'])

    render(<OfficersSection />)
    await screen.findByText('Jordan Ellis')

    const caption = screen.getByText('President').closest('figcaption')!
    expect(caption.textContent).toBe('PresidentJordan Ellis')
    // The board prints no dates, and the archive does. That asymmetry is the
    // point: here only some officers would have a span worth reading, and a
    // field set on some cards and not others is a table of exceptions.
    expect(caption.textContent).not.toMatch(/2019/)
  })

  /**
   * The frame is a fixed ratio and is drawn whether or not there is a photo in
   * it, so one officer sending one can't make their card taller than the three
   * beside it — and the grid holds its shape before any image loads.
   */
  it('frames every seat, with a headshot or with a placeholder', async () => {
    stub(
      [
        officer('PRESIDENT', { photoUrl: 'https://example.com/jordan.jpg' }),
        officer('TREASURER', { fullName: 'Owen Castellanos', photoUrl: null }),
      ],
      SEATS,
    )

    const { container } = render(<OfficersSection />)
    await screen.findByText('Jordan Ellis')

    const headshot = container.querySelector('img')
    expect(headshot).toHaveAttribute('src', 'https://example.com/jordan.jpg')
    // Decorative — the name is printed right below it.
    expect(headshot).toHaveAttribute('alt', '')
    // Cropped from the top: a standing photo squared off from the centre lands
    // on the midriff, which is the one crop a headshot can't survive.
    expect(headshot).toHaveClass('object-top')

    // One headshot, seven empty frames, eight frames.
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(screen.getAllByText('[ PHOTO ]')).toHaveLength(7)
    expect(container.querySelectorAll('.aspect-square')).toHaveLength(8)
  })

  /**
   * The photograph is the link, and only for an officer who has given one. The
   * empty chairs never are: a seat nobody is in has nobody to point at, and an
   * anchor on it would be a link with no name.
   */
  it('links a headshot to the officer’s profile', async () => {
    stub(
      [
        officer('PRESIDENT', {
          photoUrl: 'https://example.com/jordan.jpg',
          profileUrl: 'https://github.com/jordan',
        }),
        officer('TREASURER', { fullName: 'Owen Castellanos' }),
      ],
      SEATS,
    )

    render(<OfficersSection />)
    await screen.findByText('Jordan Ellis')

    const link = screen.getByRole('link', { name: 'Jordan Ellis on GitHub' })
    expect(link).toHaveAttribute('href', 'https://github.com/jordan')

    // Seven empty chairs and an officer who gave no link: no other anchor in
    // the grid. The section's own header link to the archive is outside it.
    expect(screen.queryByRole('link', { name: /Owen Castellanos/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Seat open/ })).not.toBeInTheDocument()
  })

  /**
   * The board cannot be listed without the response now — the seats come from
   * it too — so a failure says so rather than drawing a grid of empty chairs
   * the club may not even have.
   */
  it('says so when the board cannot be loaded', async () => {
    vi.stubGlobal('fetch', stubFetchNetworkError())
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<OfficersSection />)

    expect(
      await screen.findByText(/couldn.t load the officer board/i),
    ).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    consoleError.mockRestore()
  })

  /** No seats and nobody in them is a club that has not set this up, which is
      a different sentence from a board of empty chairs. */
  it('says when no officers are listed at all', async () => {
    stub([], [])

    render(<OfficersSection />)

    expect(await screen.findByText(/no officers are listed yet/i)).toBeInTheDocument()
  })

  it('shows placeholders while loading, and claims no seat is open yet', () => {
    vi.stubGlobal('fetch', stubFetchPending())

    const { container } = render(<OfficersSection />)

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    // "Seat open" before the response has landed would be a lie — and so would
    // any particular number of seats, which is why the skeleton count is a
    // guess rather than a claim.
    expect(screen.queryByText('Seat open')).not.toBeInTheDocument()
  })
})
