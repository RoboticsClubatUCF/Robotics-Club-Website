import { render as renderBare, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SponsorsSection } from './SponsorsSection'
import type { ApiSponsor } from '../../lib/api/api'
import {
  stubFetch,
  stubFetchNetworkError,
  stubFetchPending,
  urlOf,
} from '../../test/stubFetch'

/**
 * The header's "Sponsor us" is a `<Link>` now that `/sponsors` is a real page,
 * and a `<Link>` throws outside a router. Same helper, same reason, as
 * `OfficersSection.test.tsx`.
 */
const render = (ui: ReactNode) => renderBare(<MemoryRouter>{ui}</MemoryRouter>)

const sponsor = (over: Partial<ApiSponsor> = {}): ApiSponsor => ({
  id: 's1',
  name: 'Northgate Manufacturing',
  tier: 'PROCESSOR_PATRON',
  logoUrl: null,
  websiteUrl: 'https://example.com',
  blurb: 'Machining and fabrication for every competition chassis.',
  ...over,
})

/**
 * The one list on the strip that isn't a repeat.
 *
 * The marquee renders the sponsors several times over and marks every copy but
 * the first `aria-hidden`, so an unscoped text query matches once per copy.
 * `getByRole` skips hidden subtrees, which makes it the shortest way to say
 * "the real one".
 */
const strip = async () => within(await screen.findByRole('list'))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SponsorsSection', () => {
  it('renders a card per sponsor, with its tier and blurb', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/sponsors': [
          sponsor(),
          sponsor({ id: 's2', name: 'Halden Robotics Supply', tier: 'BOLT_BACKER' }),
        ],
      }),
    )

    render(<SponsorsSection />)
    const cards = await strip()

    expect(cards.getByText('Northgate Manufacturing')).toBeInTheDocument()
    expect(cards.getByText('Halden Robotics Supply')).toBeInTheDocument()
    // The wire format is the enum name; the underscore is not for reading.
    expect(cards.getByText('PROCESSOR PATRON')).toBeInTheDocument()
    expect(cards.getByText('BOLT BACKER')).toBeInTheDocument()
    expect(cards.queryByText(/_/)).not.toBeInTheDocument()
  })

  /**
   * The "top" in "top five sponsors" is the server's tier ordering, so all this
   * component has to get right is the count it asks for.
   */
  it('asks for only the five the section shows', async () => {
    const fetchStub = stubFetch({ '/sponsors': [sponsor()] })
    vi.stubGlobal('fetch', fetchStub)

    render(<SponsorsSection />)
    await strip()

    expect(urlOf(fetchStub.mock.calls[0]![0])).toContain('limit=5')
  })

  /**
   * The loop is one translation: slide the track back by exactly one copy of the list and start
   * again. That is seamless only while the shift and the number of copies agree — if they drift
   * apart the strip visibly jumps once per cycle, which is the kind of bug that survives a
   * screenshot.
   */
  it('shifts the track by exactly one copy of the list', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/sponsors': [sponsor()] }))

    const { container } = render(<SponsorsSection />)
    await strip()

    const copies = container.querySelectorAll('ul').length
    const track = container.querySelector<HTMLElement>('[style*="--marquee-shift"]')

    expect(copies).toBeGreaterThan(1)
    expect(track?.style.getPropertyValue('--marquee-shift')).toBe(`-${100 / copies}%`)
  })

  /**
   * An `aria-hidden` subtree holding tabbable links is worse than no duplicate
   * at all: focus lands somewhere a screen reader has been told is not there.
   */
  it('leaves the repeated copies unfocusable', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/sponsors': [sponsor()] }))

    const { container } = render(<SponsorsSection />)
    await strip()

    expect(container.querySelectorAll('ul').length).toBeGreaterThan(1)
    // One card is the real one; every repeat of it is plain text.
    expect(container.querySelectorAll('a[href="https://example.com"]')).toHaveLength(1)
  })

  it('links a sponsor that has a site, and leaves one that does not as plain text', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/sponsors': [
          sponsor(),
          sponsor({ id: 's2', name: 'Local Makerspace', websiteUrl: null }),
        ],
      }),
    )

    render(<SponsorsSection />)
    const cards = await strip()

    expect(cards.getByText('Northgate Manufacturing').closest('a')).toHaveAttribute(
      'href',
      'https://example.com',
    )
    // A dead anchor is worse than plain text for anyone tabbing through.
    expect(cards.getByText('Local Makerspace').closest('a')).toBeNull()
  })

  /**
   * The well is reserved whether or not there is artwork in it, so one sponsor
   * sending a logo can't make their card taller than the ones beside it.
   */
  it('keeps a logo well in every card, filled or not', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/sponsors': [
          sponsor({ logoUrl: 'https://example.com/logo.svg' }),
          sponsor({ id: 's2', name: 'Local Makerspace', logoUrl: null }),
        ],
      }),
    )

    render(<SponsorsSection />)
    const list = await screen.findByRole('list')
    const cards = within(list)

    const logo = list.querySelector('img')
    expect(logo).toHaveAttribute('src', 'https://example.com/logo.svg')
    // Decorative — the name is printed right below it.
    expect(logo).toHaveAttribute('alt', '')

    // The sponsor with no artwork still gets the well, as a placeholder.
    expect(cards.getByText('[ LOGO ]')).toBeInTheDocument()
    expect(list.querySelectorAll('.h-20')).toHaveLength(2)
  })

  it('names a sponsor in text even when it has a logo', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/sponsors': [sponsor({ logoUrl: 'https://example.com/logo.svg' })] }),
    )

    render(<SponsorsSection />)
    const cards = await strip()

    // An image alone would leave the card unreadable if the artwork 404s.
    expect(cards.getByText('Northgate Manufacturing')).toBeInTheDocument()
  })

  it('says so when there are no sponsors rather than rendering nothing', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/sponsors': [] }))

    render(<SponsorsSection />)

    expect(await screen.findByText(/no sponsors are listed yet/i)).toBeInTheDocument()
  })

  it('explains itself when the API is unreachable', async () => {
    vi.stubGlobal('fetch', stubFetchNetworkError())
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<SponsorsSection />)

    expect(await screen.findByText(/couldn't load the sponsors/i)).toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('shows placeholder cards while loading, and no error', () => {
    vi.stubGlobal('fetch', stubFetchPending())

    const { container } = render(<SponsorsSection />)

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument()
  })
})
