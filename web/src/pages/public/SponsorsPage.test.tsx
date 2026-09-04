import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SponsorsPage } from './SponsorsPage'
import type { ApiSponsor, ApiSponsorship, ApiTierOffer } from '../../lib/api/api'
import { stubFetch, stubFetchNetworkError } from '../../test/stubFetch'

const sponsor = (over: Partial<ApiSponsor> = {}): ApiSponsor => ({
  id: 's1',
  name: 'Northgate Manufacturing',
  tier: 'PROCESSOR_PATRON',
  logoUrl: null,
  websiteUrl: 'https://example.com',
  blurb: 'Machining and fabrication for every competition chassis.',
  ...over,
})

const halden = sponsor({
  id: 's2',
  name: 'Halden Robotics Supply',
  tier: 'CIRCUIT_SUPPORTER',
})

const offer = (over: Partial<ApiTierOffer> = {}): ApiTierOffer => ({
  tier: 'PROCESSOR_PATRON',
  amount: '$2,500 a season',
  blurb: 'Underwrites a competition season.',
  benefits: ['Logo on the rover'],
  ...over,
})

/** A tier as the club actually writes them: an amount over a list, no sentence. */
const bare = (over: Partial<ApiTierOffer> = {}): ApiTierOffer =>
  offer({ blurb: null, ...over })

const pitch = (over: Partial<ApiSponsorship> = {}): ApiSponsorship => ({
  tiers: [],
  inKind: [],
  footnotes: null,
  ...over,
})

/**
 * The page's two reads, plus the one `ContactForm` makes at the foot of it: it asks whether this
 * visitor has any messages left today before drawing its fields, and every case here renders it.
 * Answered permissively, because none of these tests are about the limit.
 *
 * `/sponsorship` is listed before `/sponsors` and has to be. `stubFetch` matches on `includes`
 * and takes the first key that hits, and every `/sponsorship` URL contains `/sponsors` — the
 * other way round, the pitch is answered with a list of companies and the page renders
 * `undefined.length`.
 */
const page = (routes: Record<string, unknown>) =>
  stubFetch({
    '/contact': { allowed: true, remaining: 2, retryAfter: 0, message: null },
    '/sponsorship': pitch(),
    ...routes,
  })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SponsorsPage', () => {
  it('groups the sponsors under their tier, with the underscore taken out', async () => {
    vi.stubGlobal('fetch', page({ '/sponsors': [sponsor(), halden] }))

    render(<SponsorsPage />)

    expect(await screen.findByText('Northgate Manufacturing')).toBeInTheDocument()
    // Level 2, because the tier sheet below prints the same names as `h3`s —
    // which is the point of the sheet, and not what this test is about.
    expect(
      screen.getByRole('heading', { level: 2, name: 'PROCESSOR PATRON' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'CIRCUIT SUPPORTER' }),
    ).toBeInTheDocument()
  })

  /**
   * The price belongs to the level, not the company, so it comes off the pitch read — the page's
   * other request. Both halves are asserted here: the tier that has a sheet says what it costs,
   * and the one that has none is a bare heading rather than an empty separator.
   */
  it('prints what a tier costs beside its name over the roll', async () => {
    vi.stubGlobal(
      'fetch',
      page({
        '/sponsorship': pitch({ tiers: [bare({ amount: '$2,500 a season' })] }),
        '/sponsors': [sponsor(), halden],
      }),
    )

    render(<SponsorsPage />)
    // `findAll`: with a tier sheet published the sponsor's name is on the page
    // twice — its card up here, and that tier's roll of supporters below.
    await screen.findAllByText('Northgate Manufacturing')

    // Read off `textContent` rather than matched as an accessible name: the
    // amount is a `<span>` for its own size and weight, and the name algorithm
    // trims each node it assembles, which eats the space before the middot.
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)

    expect(headings).toContain('PROCESSOR PATRON · $2,500 a season')
    // Halden's tier has sponsors in it and no sheet — a real state, since the
    // two are different tables. Nothing invented, and no dangling middot.
    expect(headings).toContain('CIRCUIT SUPPORTER')
  })

  /**
   * The club's own ranking is the enum's order and the server sends the rows in
   * it. Sorting again here would be a second copy of the ranking, and the two
   * would eventually disagree.
   */
  it('keeps the order the server sent rather than ranking the tiers itself', async () => {
    // Deliberately the wrong way round: a response ordered by the server would
    // never look like this, and the page must not quietly fix it.
    vi.stubGlobal('fetch', page({ '/sponsors': [halden, sponsor()] }))

    render(<SponsorsPage />)
    await screen.findByText('Halden Robotics Supply')

    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)

    expect(headings.indexOf('CIRCUIT SUPPORTER')).toBeLessThan(
      headings.indexOf('PROCESSOR PATRON'),
    )
  })

  it('links a sponsor with a website and leaves one without as plain text', async () => {
    vi.stubGlobal(
      'fetch',
      page({
        '/sponsors': [sponsor(), sponsor({ id: 's3', name: 'Quiet Backer', websiteUrl: null })],
      }),
    )

    render(<SponsorsPage />)
    await screen.findByText('Quiet Backer')

    expect(
      screen.getByRole('link', { name: /Northgate Manufacturing/ }),
    ).toHaveAttribute('href', 'https://example.com')
    // A dead anchor is worse than plain text for anyone tabbing through.
    expect(screen.queryByRole('link', { name: /Quiet Backer/ })).not.toBeInTheDocument()
  })

  /**
   * The price list is the club's own words now — `sponsor_tier_offers`, written
   * by officers — where it used to be four hardcoded objects marked PLACEHOLDER
   * under a panel on the page admitting it. Both halves of that matter: what
   * they wrote appears, and the panel does not.
   */
  it('prints a published tier and no longer warns about placeholders', async () => {
    vi.stubGlobal(
      'fetch',
      page({
        '/sponsorship': pitch({ tiers: [offer()] }),
        '/sponsors': [sponsor()],
      }),
    )

    render(<SponsorsPage />)

    expect(await screen.findByText('$2,500 a season')).toBeInTheDocument()
    expect(screen.getByText('Logo on the rover')).toBeInTheDocument()
    expect(screen.queryByText(/are placeholders/i)).not.toBeInTheDocument()
  })

  /** An amount and a sentence is a whole offer; the list is what is optional. */
  it('draws a tier that lists no benefits', async () => {
    vi.stubGlobal(
      'fetch',
      page({
        '/sponsorship': pitch({ tiers: [offer({ benefits: [] })] }),
        '/sponsors': [sponsor()],
      }),
    )

    render(<SponsorsPage />)

    expect(await screen.findByText('$2,500 a season')).toBeInTheDocument()
    expect(
      screen.getByText('Underwrites a competition season.'),
    ).toBeInTheDocument()
  })

  /**
   * Nothing published is a supported state and the club starts there. The
   * section still has to answer the question a company arrived with, which is
   * why it points at the form rather than going quiet.
   */
  it('points at the contact form when no tier is published', async () => {
    vi.stubGlobal('fetch', page({ '/sponsors': [sponsor()] }))

    render(<SponsorsPage />)

    expect(await screen.findByText(/aren’t published here yet/i)).toBeInTheDocument()
    expect(screen.getByText('/ SPONSORSHIP TIERS')).toBeInTheDocument()
  })

  /**
   * The other half of that decision, and deliberately the opposite one: the
   * tiers answer a question somebody came with, so they speak when empty; this
   * section is the club volunteering extra ways to say yes, and an empty
   * heading over nothing is the sad version of that.
   */
  it('leaves the other-ways section off entirely when there is nothing in it', async () => {
    vi.stubGlobal(
      'fetch',
      page({
        '/sponsorship': pitch({
          tiers: [offer()],
          inKind: [{ id: 'k1', title: 'Machine time', blurb: 'An afternoon of a shop.' }],
        }),
        '/sponsors': [sponsor()],
      }),
    )

    const shown = render(<SponsorsPage />)
    expect(await screen.findByText('Machine time')).toBeInTheDocument()
    shown.unmount()

    vi.stubGlobal('fetch', page({ '/sponsors': [sponsor()] }))
    render(<SponsorsPage />)

    await screen.findByText('Northgate Manufacturing')
    expect(screen.queryByText('/ OTHER WAYS TO HELP')).not.toBeInTheDocument()
  })

  /** The pitch has to stand up even before anybody has signed. */
  it('still offers the tiers when nobody is sponsoring yet', async () => {
    vi.stubGlobal(
      'fetch',
      page({ '/sponsorship': pitch({ tiers: [offer()] }), '/sponsors': [] }),
    )

    render(<SponsorsPage />)

    expect(await screen.findByText(/no sponsors are listed yet/i)).toBeInTheDocument()
    expect(screen.getByText('$2,500 a season')).toBeInTheDocument()
  })

  /**
   * The roll on each tier card, and the sentence that has to be there when it is
   * empty. A tier that silently prints no supporters reads as one that is
   * closed — the reader cannot tell "nobody yet" from "we stopped listing them".
   */
  it('names the supporters at each tier, and says when there are none', async () => {
    vi.stubGlobal(
      'fetch',
      page({
        '/sponsorship': pitch({
          tiers: [
            bare(),
            bare({ tier: 'CIRCUIT_SUPPORTER', amount: 'Up to $3,000' }),
          ],
        }),
        '/sponsors': [halden],
      }),
    )

    render(<SponsorsPage />)
    await screen.findByText('$2,500 a season')

    const rolls = screen.getAllByText('CURRENT SUPPORTERS')
    expect(rolls).toHaveLength(2)

    // Halden is a CIRCUIT_SUPPORTER, so the patron card is the empty one.
    expect(screen.getByText('No sponsors at this tier yet.')).toBeInTheDocument()
    // Named on its own tier's card as well as in the roll at the top.
    expect(screen.getAllByText('Halden Robotics Supply')).toHaveLength(2)
  })

  /**
   * The club's own sheet has no per-tier sentence, which is why the column is
   * nullable. A card that drew an empty paragraph for it would hold the layout
   * open for nothing.
   */
  it('draws a tier with no blurb', async () => {
    vi.stubGlobal(
      'fetch',
      page({ '/sponsorship': pitch({ tiers: [bare()] }), '/sponsors': [] }),
    )

    render(<SponsorsPage />)

    expect(await screen.findByText('$2,500 a season')).toBeInTheDocument()
    expect(
      screen.queryByText('Underwrites a competition season.'),
    ).not.toBeInTheDocument()
  })

  /**
   * The fine print is one block under the grid rather than a field on a card,
   * because the same marker is cited by more than one tier. Its line breaks are
   * the structure, so it renders `whitespace-pre-line` and the text node keeps
   * the newlines.
   */
  it('prints the fine print under the grid, newlines and all', async () => {
    const footnotes =
      '* Logo size determined by donation amount\n\nNOTE: tax-deductible.'

    vi.stubGlobal(
      'fetch',
      page({
        '/sponsorship': pitch({ tiers: [bare()], footnotes }),
        '/sponsors': [],
      }),
    )

    render(<SponsorsPage />)

    const printed = await screen.findByText(/Logo size determined/)
    expect(printed.textContent).toBe(footnotes)
    expect(printed).toHaveClass('whitespace-pre-line')
  })

  /** Nobody has written any, which is what the grid did before the row existed. */
  it('prints no fine print when there is none', async () => {
    vi.stubGlobal(
      'fetch',
      page({ '/sponsorship': pitch({ tiers: [bare()] }), '/sponsors': [] }),
    )

    render(<SponsorsPage />)
    await screen.findByText('$2,500 a season')

    expect(screen.queryByText(/NOTE:/)).not.toBeInTheDocument()
  })

  it('carries the contact form, because it is the only way to say yes', async () => {
    vi.stubGlobal('fetch', page({ '/sponsors': [sponsor()] }))

    render(<SponsorsPage />)
    await screen.findByText('Northgate Manufacturing')

    const form = screen.getByRole('button', { name: /send message/i }).closest('form')!
    expect(within(form).getByLabelText(/^email$/i)).toBeInTheDocument()
  })

  /**
   * Both reads fail together here, and the two halves answer differently on purpose: the list says
   * it couldn't load, and the pitch falls into the same place an unpublished one does. A visitor
   * deciding whether to sponsor a robotics club isn't owed the difference between "not settled
   * yet" and "the API is down".
   */
  it('degrades to a message when the API is unreachable', async () => {
    vi.stubGlobal('fetch', stubFetchNetworkError())
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<SponsorsPage />)

    expect(await screen.findByText(/couldn’t load the sponsors/i)).toBeInTheDocument()
    expect(screen.getByText(/aren’t published here yet/i)).toBeInTheDocument()
    consoleError.mockRestore()
  })
})
