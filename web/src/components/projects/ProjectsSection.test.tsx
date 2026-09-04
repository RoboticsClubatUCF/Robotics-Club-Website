import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectsSection } from './ProjectsSection'
import type { ApiCardProject } from '../../lib/api/api'
import { DEFAULT_FRAMING } from '../../lib/media/imageFraming'
import {
  stubFetch,
  stubFetchNetworkError,
  stubFetchPending,
  urlOf,
} from '../../test/stubFetch'

const project = (over: Partial<ApiCardProject> = {}): ApiCardProject => ({
  id: 'p1',
  slug: 'project-storm',
  title: 'Project S.T.O.R.M.',
  // The line the card prints, and the only prose it prints. Every project has
  // one: the migration that added the cover seeded them from each project's own
  // first paragraph, because the column had never once been filled in by hand.
  summary: 'Research, design, build and test a Mars rover.',
  season: 'June 2026',
  // Every project carries the term it is built for, and this page splits on
  // it. Pinned rather than left to today's date.
  termYear: 2035,
  termSeason: 'FALL',
  competition: 'UNIVERSITY ROVER CHALLENGE',
  status: 'IN_PROGRESS',
  coverUrl: null,
  coverFromGallery: false,
  coverFocalX: 50,
  coverFocalY: 50,
  coverZoom: 1,
  galleryHeading: null,
  resourcesHeading: null,
  teamHeading: null,
  featured: true,
  startedAt: null,
  completedAt: null,
  images: [],
  ...over,
})

/**
 * The two requests are the same path with different query strings, and
 * `stubFetch` matches on a fragment — so the fragment has to be the part that
 * differs. A key of `/projects` would answer both with whichever was declared
 * first, which is the failure this page exists to avoid.
 */
const CURRENT = 'term=current'
const ARCHIVE = 'term=other'

afterEach(() => {
  vi.unstubAllGlobals()
})

// The rows are `<Link>`s, and a Link outside a router is a crash rather than a
// degraded render.
const renderSection = () =>
  render(
    <MemoryRouter>
      <ProjectsSection />
    </MemoryRouter>,
  )

/**
 * The covers on the page.
 *
 * Queried out of the DOM rather than by role: a cover is decorative and carries `alt=""`, because
 * the title beside it names the project and a second announcement of "Project S.T.O.R.M." helps
 * nobody. An `alt=""` image has no `img` role, which is the point.
 */
const covers = (container: HTMLElement) => Array.from(container.querySelectorAll('img'))

const showPast = () => {
  fireEvent.click(screen.getByRole('button', { name: /show past projects/i }))
}

describe('ProjectsSection', () => {
  it('renders a card per current project, with its competition and label', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        [CURRENT]: [
          project(),
          project({
            id: 'p2',
            slug: 'pep26',
            title: 'PEP26',
            competition: 'PROMOTION OF ELECTRIC PROPULSION',
            season: 'Apr 2026',
          }),
        ],
      }),
    )

    renderSection()

    expect(await screen.findByText('Project S.T.O.R.M.')).toBeInTheDocument()
    expect(screen.getByText('UNIVERSITY ROVER CHALLENGE')).toBeInTheDocument()
    expect(screen.getByText('June 2026')).toBeInTheDocument()
    expect(screen.getByText('PEP26')).toBeInTheDocument()
    expect(
      screen.getByText('PROMOTION OF ELECTRIC PROPULSION'),
    ).toBeInTheDocument()
  })

  /**
   * The whole point of the change: the page is one term, and the term is named
   * rather than left for the reader to work out from the season labels.
   */
  it('asks for the current term only, with its pictures, and says which term', async () => {
    const fetchStub = stubFetch({ [CURRENT]: [project()] })
    vi.stubGlobal('fetch', fetchStub)

    renderSection()
    await screen.findByText('Project S.T.O.R.M.')

    const url = urlOf(fetchStub.mock.calls[0]![0])
    expect(url).toContain('term=current')
    // One picture per project, not the whole gallery — a card is a still now.
    expect(url).toContain('cover=true')
    expect(url).not.toContain('images=true')
    // And no write-up: the card prints the summary and nothing else.
    expect(url).not.toContain('description=true')
    expect(url).toContain('limit=100')

    expect(screen.getByText('Fall 2035')).toBeInTheDocument()
  })

  /**
   * A card is one still and no controls. It carried a compact slideshow for a
   * while, which put six sets of arrows and six counters down a page whose job
   * is to get somebody into a project.
   */
  it('draws the cover, and no slideshow controls', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        [CURRENT]: [
          project({
            coverFromGallery: true,
            images: [
              { id: 'i1', url: '/api/files/i1', caption: 'Chassis', ...DEFAULT_FRAMING },
              { id: 'i2', url: '/api/files/i2', caption: 'Arm', ...DEFAULT_FRAMING },
            ],
          }),
        ],
      }),
    )

    const { container } = renderSection()
    await screen.findByText('Project S.T.O.R.M.')

    // The first picture, once, and nothing to press.
    const shown = covers(container)
    expect(shown).toHaveLength(1)
    expect(shown[0]).toHaveAttribute('src', expect.stringContaining('/api/files/i1'))
    expect(screen.queryByRole('button', { name: 'Next image' })).not.toBeInTheDocument()
  })

  /**
   * The checkbox is the whole of the rule, and neither side falls back to the
   * other — reordering a gallery must not silently change the listing image,
   * which is why `coverUrl` survives beside it.
   */
  it('draws the chosen cover rather than the gallery when the box is off', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        [CURRENT]: [
          project({
            coverFromGallery: false,
            coverUrl: 'https://example.test/chosen.png',
            images: [
              { id: 'i1', url: '/api/files/i1', caption: null, ...DEFAULT_FRAMING },
            ],
          }),
        ],
      }),
    )

    const { container } = renderSection()
    await screen.findByText('Project S.T.O.R.M.')

    const shown = covers(container)
    expect(shown).toHaveLength(1)
    expect(shown[0]).toHaveAttribute('src', 'https://example.test/chosen.png')
  })

  it('prints the summary on a card', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ [CURRENT]: [project({ summary: 'A one-liner.' })] }),
    )

    renderSection()

    expect(await screen.findByText('A one-liner.')).toBeInTheDocument()
  })

  /**
   * The long form belongs on the project's own page, which the card is a door
   * to. Six write-ups down this one was a page of grey text.
   */
  it('does not print the write-up on a card', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ [CURRENT]: [project({ summary: 'A one-liner.' })] }),
    )

    renderSection()
    await screen.findByText('A one-liner.')

    expect(screen.queryByText(/Research, design, build/)).not.toBeInTheDocument()
  })

  /**
   * The archive's third column is one blurb wide and clamps in CSS, so the whole
   * summary stays in the DOM and nothing is hidden from a screen reader.
   */
  it('prints the summary on an archived row', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        [CURRENT]: [],
        [ARCHIVE]: [
          project({
            id: 'old',
            slug: 'rover-24',
            title: 'Rover 24',
            summary: 'A rover, three years ago.',
          }),
        ],
      }),
    )

    renderSection()
    showPast()

    expect(await screen.findByText('A rover, three years ago.')).toBeInTheDocument()
  })

  /** Neither pictures nor prose: forty galleries is not a list anybody scrolls,
      and the write-up has never been what this column printed. */
  it('asks the archive for neither pictures nor the write-up', async () => {
    const fetchStub = stubFetch({ [CURRENT]: [], [ARCHIVE]: [] })
    vi.stubGlobal('fetch', fetchStub)

    renderSection()
    showPast()
    await screen.findByText(/nothing here yet/i)

    const url = urlOf(fetchStub.mock.calls[1]![0])
    expect(url).toContain('term=other')
    expect(url).not.toContain('description=true')
    expect(url).not.toContain('cover=true')
    expect(url).not.toContain('images=true')
  })

  /** An empty hatched box on a public page reads as an image that failed to
      load, so a project with nothing to show gets its text full-width. */
  it('draws no frame for a project with no cover', async () => {
    vi.stubGlobal('fetch', stubFetch({ [CURRENT]: [project()] }))

    const { container } = renderSection()
    await screen.findByText('Project S.T.O.R.M.')

    expect(covers(container)).toHaveLength(0)
  })

  /** One request per visit. The archive costs nothing until somebody asks. */
  it('does not fetch the archive until the button is pressed', async () => {
    const fetchStub = stubFetch({
      [CURRENT]: [project()],
      [ARCHIVE]: [project({ id: 'old', slug: 'rover-24', title: 'Rover 24' })],
    })
    vi.stubGlobal('fetch', fetchStub)

    renderSection()
    await screen.findByText('Project S.T.O.R.M.')
    expect(fetchStub).toHaveBeenCalledTimes(1)

    showPast()
    expect(await screen.findByText('Rover 24')).toBeInTheDocument()
    expect(urlOf(fetchStub.mock.calls[1]![0])).toContain('term=other')
  })

  /**
   * The archive's right-hand column prints the term, not the free-text season:
   * the same build three years running is three rows with one title, and the
   * term is the only thing that tells them apart.
   */
  it('labels an archived row by its term', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        [CURRENT]: [],
        [ARCHIVE]: [
          project({
            id: 'old',
            slug: 'rover-24',
            title: 'Rover 24',
            season: 'Season-long',
            termYear: 2024,
            termSeason: 'SPRING',
          }),
        ],
      }),
    )

    renderSection()
    showPast()

    expect(await screen.findByText('Spring 2024')).toBeInTheDocument()
    expect(screen.queryByText('Season-long')).not.toBeInTheDocument()
  })

  it('hides the archive again on a second press', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        [CURRENT]: [project()],
        [ARCHIVE]: [project({ id: 'old', slug: 'rover-24', title: 'Rover 24' })],
      }),
    )

    renderSection()
    await screen.findByText('Project S.T.O.R.M.')

    showPast()
    await screen.findByText('Rover 24')

    fireEvent.click(screen.getByRole('button', { name: /hide past projects/i }))
    expect(screen.queryByText('Rover 24')).not.toBeInTheDocument()
  })

  it('hides the tag line for a project with no competition', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ [CURRENT]: [project({ competition: null })] }),
    )

    renderSection()
    await screen.findByText('Project S.T.O.R.M.')

    expect(
      screen.queryByText('UNIVERSITY ROVER CHALLENGE'),
    ).not.toBeInTheDocument()
    // The card itself still renders — a missing tag is not a missing project.
    expect(screen.getByText('June 2026')).toBeInTheDocument()
  })

  /**
   * An empty term is a real state — the week before a semester starts — and it
   * has to point at the archive rather than reading as a broken page.
   */
  it('says so when nothing is running this semester', async () => {
    vi.stubGlobal('fetch', stubFetch({ [CURRENT]: [] }))

    renderSection()

    expect(
      await screen.findByText(/nothing is running this semester yet/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /show past projects/i }),
    ).toBeInTheDocument()
  })

  it('explains itself when the API is unreachable', async () => {
    vi.stubGlobal('fetch', stubFetchNetworkError())
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderSection()

    expect(
      await screen.findByText(/couldn't load the projects/i),
    ).toBeInTheDocument()
    consoleError.mockRestore()
  })

  /** The archive fails on its own, under the button that asked for it. */
  it('explains an archive that fails without touching the page above it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) =>
        urlOf(input).includes(ARCHIVE)
          ? Promise.reject(new TypeError('Failed to fetch'))
          : Promise.resolve(
              new Response(JSON.stringify([project()]), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }),
            ),
      ),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderSection()
    await screen.findByText('Project S.T.O.R.M.')
    showPast()

    expect(
      await screen.findByText(/couldn't load the earlier projects/i),
    ).toBeInTheDocument()
    expect(screen.getByText('Project S.T.O.R.M.')).toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('shows placeholder cards while loading, and no error', () => {
    vi.stubGlobal('fetch', stubFetchPending())

    const { container } = renderSection()

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument()
  })

  it('links each card to its project page', async () => {
    vi.stubGlobal('fetch', stubFetch({ [CURRENT]: [project()] }))

    renderSection()
    await screen.findByText('Project S.T.O.R.M.')

    expect(
      screen.getByRole('link', { name: 'Project S.T.O.R.M.' }),
    ).toHaveAttribute('href', '/projects/project-storm')
    expect(
      screen.getByRole('link', { name: 'View Project S.T.O.R.M.' }),
    ).toHaveAttribute('href', '/projects/project-storm')
  })
})
