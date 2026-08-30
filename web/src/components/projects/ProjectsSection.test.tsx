import { fireEvent, render, screen, within } from '@testing-library/react'
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
  // Null, because that is what it is on all 53 of the club's projects — the
  // column meant for a list has never once been filled in, and the page has to
  // read right in the state the data is actually in.
  summary: null,
  description: 'Research, design, build and test a Mars rover.',
  season: 'June 2026',
  // Every project carries the term it is built for, and this page splits on
  // it. Pinned rather than left to today's date.
  termYear: 2035,
  termSeason: 'FALL',
  competition: 'UNIVERSITY ROVER CHALLENGE',
  status: 'IN_PROGRESS',
  coverUrl: null,
  repoUrl: null,
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
    expect(url).toContain('images=true')
    expect(url).toContain('description=true')
    expect(url).toContain('limit=100')

    expect(screen.getByText('Fall 2035')).toBeInTheDocument()
  })

  /**
   * The gallery is why the listing carries images at all. A project with
   * pictures gets the slideshow; one without gets its text and no empty frame.
   */
  it('draws a slideshow for a project with pictures', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        [CURRENT]: [
          project({
            images: [
              { id: 'i1', url: '/api/files/i1', caption: 'Chassis', ...DEFAULT_FRAMING },
              { id: 'i2', url: '/api/files/i2', caption: 'Arm', ...DEFAULT_FRAMING },
            ],
          }),
        ],
      }),
    )

    renderSection()
    await screen.findByText('Project S.T.O.R.M.')

    // Named for the project, not "Project images" — the page draws one of these
    // per project and identical names tell a reader nothing apart.
    const frame = screen.getByRole('group', {
      name: 'Project S.T.O.R.M. images',
    })
    expect(within(frame).queryAllByRole('img', { hidden: true })).toHaveLength(2)
    expect(
      screen.getByRole('button', { name: 'Next image' }),
    ).toBeInTheDocument()
  })

  /**
   * The club has no summaries — the column meant for a list has never been
   * filled in on any project — so the write-up is the only prose a card has,
   * and a page that printed `summary` alone printed a title over nothing.
   */
  it('prints the write-up on a card, a paragraph at a time', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        [CURRENT]: [
          project({
            description: 'First paragraph.\n\nSecond paragraph.',
          }),
        ],
      }),
    )

    renderSection()

    expect(await screen.findByText('First paragraph.')).toBeInTheDocument()
    expect(screen.getByText('Second paragraph.')).toBeInTheDocument()
  })

  /** Both, in the order a project's own page draws them, if a summary ever
      does get written. */
  it('prints a summary above the write-up when there is one', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        [CURRENT]: [
          project({ summary: 'A one-liner.', description: 'The long form.' }),
        ],
      }),
    )

    renderSection()

    expect(await screen.findByText('A one-liner.')).toBeInTheDocument()
    expect(screen.getByText('The long form.')).toBeInTheDocument()
  })

  /**
   * The archive's third column is one blurb wide, so it runs the paragraphs
   * together and clamps in CSS — nothing is dropped from the DOM, which is what
   * keeps the whole write-up available to a screen reader.
   */
  it('runs the write-up together into one blurb on an archived row', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        [CURRENT]: [],
        [ARCHIVE]: [
          project({
            id: 'old',
            slug: 'rover-24',
            title: 'Rover 24',
            description: 'First paragraph.\n\nSecond paragraph.',
          }),
        ],
      }),
    )

    renderSection()
    showPast()

    expect(
      await screen.findByText('First paragraph. Second paragraph.'),
    ).toBeInTheDocument()
  })

  it('asks the archive for the write-up too', async () => {
    const fetchStub = stubFetch({ [CURRENT]: [], [ARCHIVE]: [] })
    vi.stubGlobal('fetch', fetchStub)

    renderSection()
    showPast()
    await screen.findByText(/nothing here yet/i)

    expect(urlOf(fetchStub.mock.calls[1]![0])).toContain('description=true')
  })

  it('draws no frame for a project with no pictures', async () => {
    vi.stubGlobal('fetch', stubFetch({ [CURRENT]: [project()] }))

    renderSection()
    await screen.findByText('Project S.T.O.R.M.')

    expect(screen.queryByRole('group')).not.toBeInTheDocument()
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
