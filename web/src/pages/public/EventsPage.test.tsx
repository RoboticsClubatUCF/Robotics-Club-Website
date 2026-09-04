import { fireEvent, render as renderPage, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventsPage } from './EventsPage'
import type { ApiEvent } from '../../lib/api/api'
import { stubFetch, stubFetchNetworkError, urlOf } from '../../test/stubFetch'

/**
 * No router here, unlike the other three new pages: the one link that leaves this page carries a
 * hash and is therefore a plain `<a>`, which is the rule in `.claude/docs/frontend.md`. If that
 * ever becomes a `<Link>` this suite needs a `MemoryRouter` — see `AboutPage.test.tsx`.
 */
const render = () => renderPage(<EventsPage />)

const event = (over: Partial<ApiEvent> = {}): ApiEvent => ({
  id: 'e1',
  slug: 'open-build-night',
  title: 'Open Build Night',
  description: 'Lab open, projects running. Drop in and work on something.',
  type: 'MEETING',
  location: 'Institute for Simulation & Training',
  startsAt: '2026-09-02T22:00:00.000Z',
  endsAt: '2026-09-03T01:00:00.000Z',
  allDay: false,
  registrationUrl: null,
  ...over,
})

const competition = event({
  id: 'e2',
  slug: 'regional-qualifier',
  title: 'Regional Qualifier',
  description: 'The first qualifier of the season.',
  type: 'COMPETITION',
  location: 'Tampa',
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('EventsPage', () => {
  it('opens on what is coming up', async () => {
    const fetchStub = stubFetch({ '/events': [event()] })
    vi.stubGlobal('fetch', fetchStub)

    render()

    expect(await screen.findByText('Open Build Night')).toBeInTheDocument()
    expect(urlOf(fetchStub.mock.calls[0]![0])).toContain('when=upcoming')
  })

  /**
   * Past and upcoming are different rows in a different order, so the chip has
   * to be a request rather than a filter over what is already here.
   */
  it('asks the server for the past rather than reversing the list', async () => {
    const fetchStub = stubFetch({ '/events': [event()] })
    vi.stubGlobal('fetch', fetchStub)

    render()
    await screen.findByText('Open Build Night')
    fireEvent.click(screen.getByRole('button', { name: 'PAST' }))

    await vi.waitFor(() => {
      expect(
        fetchStub.mock.calls.some(([input]) => urlOf(input).includes('when=past')),
      ).toBe(true)
    })
  })

  /** A chip for a type nothing on the page has can only ever show an empty
      list, which reads as broken. */
  it('offers only the types the response actually contains', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/events': [event(), competition] }))

    render()
    await screen.findByText('Open Build Night')

    expect(screen.getByRole('button', { name: 'MEETING' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'COMPETITION' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'FUNDRAISER' })).not.toBeInTheDocument()
  })

  it('narrows to one type without asking the server again', async () => {
    const fetchStub = stubFetch({ '/events': [event(), competition] })
    vi.stubGlobal('fetch', fetchStub)

    render()
    await screen.findByText('Open Build Night')
    const before = fetchStub.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'COMPETITION' }))

    expect(screen.getByText('Regional Qualifier')).toBeInTheDocument()
    expect(screen.queryByText('Open Build Night')).not.toBeInTheDocument()
    expect(fetchStub.mock.calls).toHaveLength(before)
  })

  /** The row is the calendar's, which is what carries the add-to-calendar menu
      — the point of sharing it rather than writing a second one. */
  it('draws the calendar row, menu and all', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/events': [event()] }))

    render()
    await screen.findByText('Open Build Night')

    expect(
      screen.getByRole('button', { name: /add to calendar/i }),
    ).toBeInTheDocument()
  })

  it('says so when nothing is scheduled', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/events': [] }))

    render()

    expect(await screen.findByText(/nothing is scheduled yet/i)).toBeInTheDocument()
  })

  it('degrades to a message when the API is unreachable', async () => {
    vi.stubGlobal('fetch', stubFetchNetworkError())
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render()

    expect(await screen.findByText(/couldn’t load the schedule/i)).toBeInTheDocument()
    consoleError.mockRestore()
  })
})
