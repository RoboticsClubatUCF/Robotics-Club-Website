import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfficersSection } from './OfficersSection'
import { officerSeats } from '../../content/home'
import type { ApiMember, OfficerPosition } from '../../lib/api'
import { stubFetch, stubFetchNetworkError, stubFetchPending } from '../../test/stubFetch'

const officer = (
  officerPosition: OfficerPosition,
  over: Partial<ApiMember> = {},
): ApiMember => ({
  id: officerPosition,
  slug: officerPosition.toLowerCase(),
  fullName: 'Jordan Ellis',
  role: 'OFFICER',
  officerPosition,
  title: null,
  gradYear: 2027,
  bio: null,
  photoUrl: null,
  active: true,
  subteam: null,
  ...over,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OfficersSection', () => {
  /**
   * The board has a fixed shape, and that is the whole design: the eight cards
   * come from `officerSeats`, so the response can only fill them in. If this
   * ever depends on how many officers the API returned, the grid will reflow
   * every time someone resigns.
   */
  it('always draws one card per seat, however few are filled', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officers': [officer('PRESIDENT')] }))

    render(<OfficersSection />)
    await screen.findByText('Jordan Ellis')

    expect(officerSeats).toHaveLength(8)
    for (const seat of officerSeats) {
      expect(screen.getByText(seat.label), seat.position).toBeInTheDocument()
    }
    expect(screen.getAllByRole('listitem')).toHaveLength(8)
  })

  it('puts each officer in their own seat', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/officers': [
          officer('PRESIDENT', { fullName: 'Jordan Ellis' }),
          officer('FACULTY_ADVISOR', { fullName: 'Dr. Alina Petrov', role: 'MENTOR' }),
        ],
      }),
    )

    render(<OfficersSection />)
    await screen.findByText('Jordan Ellis')

    const cardFor = (label: string) =>
      screen.getByText(label).closest('li')!.textContent

    expect(cardFor('President')).toContain('Jordan Ellis')
    // The advisor is a MENTOR, not an OFFICER — the seat is what places them.
    expect(cardFor('Faculty Advisor')).toContain('Dr. Alina Petrov')
  })

  it('marks an unheld seat as open instead of dropping the card', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officers': [officer('PRESIDENT')] }))

    render(<OfficersSection />)
    await screen.findByText('Jordan Ellis')

    // Seven seats are unfilled by that response.
    expect(screen.getAllByText('Seat open')).toHaveLength(7)
  })

  /**
   * The caption is the seat and the name, full stop. Everything else in the
   * response — the free-text title, the subteam, the grad year — is deliberately
   * dropped, and it would be easy to add one back "just for the president" and
   * end up with eight cards of uneven length.
   */
  it('captions a card with the seat and the name and nothing else', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/officers': [
          officer('PRESIDENT', {
            title: 'Interim President',
            gradYear: 2027,
            subteam: { slug: 'combat', name: 'Combat Robotics', color: null },
          }),
        ],
      }),
    )

    render(<OfficersSection />)
    await screen.findByText('Jordan Ellis')

    const caption = screen.getByText('President').closest('figcaption')!
    expect(caption.textContent).toBe('PresidentJordan Ellis')
    expect(screen.queryByText('Interim President')).not.toBeInTheDocument()
    expect(screen.queryByText(/combat robotics/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/2027/)).not.toBeInTheDocument()
  })

  /**
   * The frame is a fixed ratio and is drawn whether or not there is a photo in
   * it, so one officer sending one can't make their card taller than the three
   * beside it — and the grid holds its shape before any image loads.
   */
  it('frames every seat, with a headshot or with a placeholder', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/officers': [
          officer('PRESIDENT', { photoUrl: 'https://example.com/jordan.jpg' }),
          officer('TREASURER', { fullName: 'Owen Castellanos', photoUrl: null }),
        ],
      }),
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

  it('still lists the board when the API is unreachable', async () => {
    vi.stubGlobal('fetch', stubFetchNetworkError())
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<OfficersSection />)

    expect(await screen.findByText(/couldn't load who currently holds/i)).toBeInTheDocument()
    // The seats are known without the API; only the names are not.
    expect(screen.getByText('President')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(8)
    consoleError.mockRestore()
  })

  it('shows placeholders while loading, and claims no seat is open yet', () => {
    vi.stubGlobal('fetch', stubFetchPending())

    const { container } = render(<OfficersSection />)

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    // "Seat open" before the response has landed would be a lie.
    expect(screen.queryByText('Seat open')).not.toBeInTheDocument()
  })
})
