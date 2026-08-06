import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StatStrip } from './StatStrip'
import { stubFetch, stubFetchNetworkError, stubFetchPending } from '../../test/stubFetch'

const counts = { projects: 5, members: 6, events: 2 }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('StatStrip', () => {
  it('shows the counts from the API once they arrive', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/stats': counts }))

    render(<StatStrip />)

    expect(await screen.findByText('5')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('links each cell to the page it counts', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/stats': counts }))

    render(<StatStrip />)
    await screen.findByText('5')

    const hrefFor = (label: string) =>
      screen.getByText(label).closest('a')?.getAttribute('href')

    expect(hrefFor('PROJECTS')).toBe('/projects')
    expect(hrefFor('MEMBERS')).toBe('/members')
    expect(hrefFor('OPPORTUNITIES')).toBe('/events')
    expect(hrefFor('ESTABLISHED')).toBe('/about')
  })

  it('shows the founding year immediately — it is not waiting on anything', () => {
    vi.stubGlobal('fetch', stubFetchPending())

    render(<StatStrip />)

    // Rendered on the first paint, while the other three are still skeletons.
    expect(screen.getByText('1972')).toBeInTheDocument()
  })

  it('degrades to an em dash when the API is unreachable, and stays clickable', async () => {
    vi.stubGlobal('fetch', stubFetchNetworkError())
    // useApi logs the failure; keep the test output readable.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<StatStrip />)

    const dashes = await screen.findAllByText('—')
    expect(dashes).toHaveLength(3)
    // The one cell that isn't data is unaffected by the API being down.
    expect(screen.getByText('1972')).toBeInTheDocument()
    // A dead API must not cost you the navigation.
    expect(screen.getByText('PROJECTS').closest('a')).toHaveAttribute('href', '/projects')

    consoleError.mockRestore()
  })

  it('never invents a number while loading', () => {
    vi.stubGlobal('fetch', stubFetchPending())

    const { container } = render(<StatStrip />)

    expect(screen.queryByText('5')).not.toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3)
  })
})
