import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectsSection } from './ProjectsSection'
import type { ApiProject } from '../../lib/api'
import {
  stubFetch,
  stubFetchNetworkError,
  stubFetchPending,
  urlOf,
} from '../../test/stubFetch'

const project = (over: Partial<ApiProject> = {}): ApiProject => ({
  id: 'p1',
  slug: 'project-storm',
  title: 'Project S.T.O.R.M.',
  summary: 'Research, design, build and test a Mars rover.',
  season: 'June 2026',
  // Every project carries the term it is built for, and the dashboard
  // splits on it. Pinned rather than left to today's date.
  termYear: 2035,
  termSeason: 'FALL',
  competition: 'UNIVERSITY ROVER CHALLENGE',
  status: 'IN_PROGRESS',
  coverUrl: null,
  repoUrl: null,
  featured: true,
  startedAt: null,
  completedAt: null,
  ...over,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// The rows are `<Link>`s now, and a Link outside a router is a crash rather
// than a degraded render.
const renderSection = () =>
  render(
    <MemoryRouter>
      <ProjectsSection />
    </MemoryRouter>,
  )

describe('ProjectsSection', () => {
  it('renders a row per project, with its competition and season', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/projects': [
          project(),
          project({
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
    expect(screen.getByText('PROMOTION OF ELECTRIC PROPULSION')).toBeInTheDocument()
  })

  it('numbers rows by display position, not by anything in the payload', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/projects': [
          project({ slug: 'a', title: 'First' }),
          project({ slug: 'b', title: 'Second' }),
        ],
      }),
    )

    renderSection()
    await screen.findByText('First')

    expect(screen.getByText('01')).toBeInTheDocument()
    expect(screen.getByText('02')).toBeInTheDocument()
  })

  it('hides the tag line for a project with no competition', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/projects': [project({ competition: null })] }))

    renderSection()
    await screen.findByText('Project S.T.O.R.M.')

    expect(screen.queryByText('UNIVERSITY ROVER CHALLENGE')).not.toBeInTheDocument()
    // The row itself still renders — a missing tag is not a missing project.
    expect(screen.getByText('June 2026')).toBeInTheDocument()
  })

  it('says so when the list is empty rather than rendering nothing', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/projects': [] }))

    renderSection()

    expect(await screen.findByText(/no projects are listed yet/i)).toBeInTheDocument()
  })

  it('explains itself when the API is unreachable', async () => {
    vi.stubGlobal('fetch', stubFetchNetworkError())
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderSection()

    expect(await screen.findByText(/couldn't load the projects/i)).toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('shows placeholder rows while loading, and no error', () => {
    vi.stubGlobal('fetch', stubFetchPending())

    const { container } = renderSection()

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument()
  })

  it('asks for the full list in one page', async () => {
    const fetchStub = stubFetch({ '/projects': [project()] })
    vi.stubGlobal('fetch', fetchStub)

    renderSection()
    await screen.findByText('Project S.T.O.R.M.')

    expect(urlOf(fetchStub.mock.calls[0]![0])).toContain('limit=100')
  })

  it('links each row to its project page', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/projects': [project()] }))

    renderSection()
    await screen.findByText('Project S.T.O.R.M.')

    expect(
      screen.getByRole('link', { name: /project s\.t\.o\.r\.m\./i }),
    ).toHaveAttribute('href', '/projects/project-storm')
  })
})
