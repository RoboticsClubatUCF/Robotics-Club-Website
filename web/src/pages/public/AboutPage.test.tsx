import { render as renderBare, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AboutPage } from './AboutPage'
import type { ApiSubteam } from '../../lib/api/api'
import { stubFetch, stubFetchNetworkError } from '../../test/stubFetch'

const render = (ui: ReactNode = <AboutPage />) =>
  renderBare(<MemoryRouter>{ui}</MemoryRouter>)

const subteam = (over: Partial<ApiSubteam> = {}): ApiSubteam => ({
  id: 'st1',
  slug: 'software',
  name: 'Software',
  description: 'Autonomy, vision and everything that runs on the robot.',
  color: '#4f8cff',
  memberCount: 3,
  ...over,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AboutPage', () => {
  it('draws the subteams the API sends', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/subteams': [subteam()] }))

    render()

    expect(await screen.findByText('Software')).toBeInTheDocument()
    expect(screen.getByText(/autonomy, vision/i)).toBeInTheDocument()
  })

  /** The count is of the active roster, which is exactly what `/members` shows
      — so following it has to land on the list the number described. */
  it('links a subteam count at the roster, already narrowed', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/subteams': [subteam()] }))

    render()

    expect(await screen.findByRole('link', { name: '3 MEMBERS' })).toHaveAttribute(
      'href',
      '/members?subteam=software',
    )
  })

  it('says member rather than members when there is one of them', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/subteams': [subteam({ memberCount: 1 })] }))

    render()

    expect(await screen.findByRole('link', { name: '1 MEMBER' })).toBeInTheDocument()
  })

  /**
   * The one thing this page could actually do harm with: history nobody has
   * written yet, printed under the club's name as though it were checked.
   */
  it('marks the history as placeholder text, in the open', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/subteams': [subteam()] }))

    render()

    expect(await screen.findByText(/placeholder text/i)).toBeInTheDocument()
  })

  /**
   * The founding year is the one date here that is real, and the stat strip's
   * "ESTABLISHED 1972" cell is what brings people to this page.
   */
  it('prints the founding year in the heading', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/subteams': [subteam()] }))

    render()

    expect(
      await screen.findByRole('heading', { name: /since 1972/i }),
    ).toBeInTheDocument()
  })

  /**
   * The lab's hours are a promise only an officer can make — the front page's
   * sign answers "open right now", and this page forwards the question rather
   * than committing somebody to a time.
   */
  it('forwards the open question to the lab sign instead of printing hours', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/subteams': [subteam()] }))

    render()

    expect(await screen.findByText(/3100 Technology Pkwy/)).toBeInTheDocument()
    expect(screen.getByText(/says whether it is open right now/i)).toBeInTheDocument()
    expect(screen.queryByText(/8am/i)).not.toBeInTheDocument()
  })

  /** The club's address and story do not depend on the API being up. */
  it('still tells you where the lab is when the API is unreachable', async () => {
    vi.stubGlobal('fetch', stubFetchNetworkError())
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render()

    expect(await screen.findByText(/couldn’t load the subteams/i)).toBeInTheDocument()
    expect(screen.getByText(/3100 Technology Pkwy/)).toBeInTheDocument()
    consoleError.mockRestore()
  })
})
