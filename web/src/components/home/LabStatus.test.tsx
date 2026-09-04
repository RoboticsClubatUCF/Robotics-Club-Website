import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LabStatus } from './LabStatus'
import {
  stubFetch,
  stubFetchNetworkError,
  stubFetchPending,
} from '../../test/stubFetch'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  // A test that left the document hidden would stop the next one polling at
  // all, and it would fail somewhere unrelated.
  setVisibility('visible')
})

/**
 * A `fetch` that answers `/lab` with whatever the caller most recently put in
 * the box — so a test can change what the server says between polls, which is
 * the entire thing being checked here.
 */
function stubLab(first: unknown) {
  const box = { body: first as unknown, fail: false }

  const fetchMock = vi.fn(() =>
    box.fail
      ? Promise.reject(new TypeError('Failed to fetch'))
      : Promise.resolve(
          new Response(JSON.stringify(box.body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
  )

  vi.stubGlobal('fetch', fetchMock)
  return { box, fetchMock }
}

const OPEN = { open: true, changedAt: null, buildingOpen: true }
const CLOSED = { open: false, changedAt: null, buildingOpen: true }

/** Whatever `visibilityState` is told to be, plus the event the browser fires
    with it. jsdom's is a getter on the document. */
function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => value,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('LabStatus', () => {
  it('says the lab is open, and how long that has been true', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/lab': {
          open: true,
          changedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
          buildingOpen: true,
        },
      }),
    )

    render(<LabStatus />)

    expect(await screen.findByText('LAB OPEN')).toBeInTheDocument()
    expect(screen.getByText('20 MIN AGO')).toBeInTheDocument()
  })

  it('says the lab is closed', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/lab': { open: false, changedAt: null, buildingOpen: true } }),
    )

    render(<LabStatus />)

    expect(await screen.findByText('LAB CLOSED')).toBeInTheDocument()
  })

  /**
   * The whole point of the component. Guessing CLOSED because the request
   * failed is inventing a fact, and it invents it in the direction that costs
   * somebody a walk across campus to a locked door — so a failure draws
   * nothing at all.
   */
  it('draws nothing when it could not ask', async () => {
    vi.stubGlobal('fetch', stubFetchNetworkError())

    const { container } = render(<LabStatus />)

    // The row keeps its height whatever happens, because it sits directly above
    // the `<h1>` and anything appearing late would shove the hero down.
    await vi.waitFor(() => {
      expect(container.querySelector('.h-4')).not.toBeNull()
    })
    expect(screen.queryByText('LAB OPEN')).not.toBeInTheDocument()
    expect(screen.queryByText('LAB CLOSED')).not.toBeInTheDocument()
  })

  /** Loading is a skeleton the size of the text it replaces, for the same
      reason: the row must not change height once the page has settled. */
  it('holds its height with a skeleton while it loads', () => {
    vi.stubGlobal('fetch', stubFetchPending())

    const { container } = render(<LabStatus />)

    expect(container.querySelector('.h-4')).not.toBeNull()
    expect(screen.queryByText('LAB OPEN')).not.toBeInTheDocument()
    expect(screen.queryByText('LAB CLOSED')).not.toBeInTheDocument()
  })

  /**
   * The sign says open or closed and nothing else.
   *
   * Two things it deliberately doesn't say overnight. "4 HR AGO" at two in the morning answers a
   * question nobody asked — and OPENS 8AM, which used to stand in its place, was worse: the
   * building being unlocked at eight isn't the lab being staffed at eight, and an officer might
   * come at noon or not at all.
   */
  it('says only that the lab is closed while the building is shut', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/lab': {
          open: false,
          changedAt: new Date(Date.now() - 4 * 3_600_000).toISOString(),
          buildingOpen: false,
        },
      }),
    )

    render(<LabStatus />)

    expect(await screen.findByText('LAB CLOSED')).toBeInTheDocument()
    expect(screen.queryByText(/OPENS/)).not.toBeInTheDocument()
    expect(screen.queryByText('4 HR AGO')).not.toBeInTheDocument()
  })

  /** A club that has never pressed the button has nothing to date the sign
      with, and "CLOSED · JUST NOW" would be a claim nobody made. */
  it('leaves the time off when nobody has ever flipped it', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/lab': { open: false, changedAt: null, buildingOpen: true } }),
    )

    render(<LabStatus />)
    await screen.findByText('LAB CLOSED')

    expect(screen.queryByText(/AGO/)).not.toBeInTheDocument()
  })
})

/**
 * The lab is the one endpoint on this site whose answer changes without the reader doing anything
 * — and increasingly it changes because somebody pressed a button in Discord. A page that only
 * asked on mount would sit saying CLOSED over a channel that had said OPEN for twenty minutes.
 *
 * Fake timers go in before `render`, and that's the whole trick. The polling interval is created
 * by the mount effect, so installing them afterwards leaves a real interval that
 * `advanceTimersByTime` can't move — and the test then passes or fails on nothing at all.
 * Everything is flushed with an explicit `act`, because `waitFor` under fake timers is a second
 * thing to get right for no gain.
 */
describe('LabStatus keeps asking', () => {
  /** Let the mount fetch, or a poll, settle. `act` flushes microtasks on the
      way out, which is what the stubbed `fetch` resolves on. */
  const settle = () => act(async () => {})

  it('picks up a flip that happened somewhere else', async () => {
    vi.useFakeTimers()
    const { box } = stubLab(CLOSED)

    render(<LabStatus />)
    await settle()
    expect(screen.getByText('LAB CLOSED')).toBeInTheDocument()

    // An officer presses the button in Discord.
    box.body = OPEN

    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })
    await settle()

    expect(screen.getByText('LAB OPEN')).toBeInTheDocument()
  })

  /**
   * The mirror of "never invent a state". The page draws nothing rather than
   * CLOSED when it has never had an answer — but throwing away an answer the
   * server gave thirty seconds ago because one poll flaked would be inventing
   * "we don't know" out of a network blip.
   */
  it('keeps the last good answer when a poll fails', async () => {
    vi.useFakeTimers()
    const { box } = stubLab(OPEN)

    render(<LabStatus />)
    await settle()
    expect(screen.getByText('LAB OPEN')).toBeInTheDocument()

    box.fail = true

    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })
    await settle()

    expect(screen.getByText('LAB OPEN')).toBeInTheDocument()
  })

  /**
   * A laptop left open on a lab bench should not spend six hours asking, and
   * somebody switching back to the tab is somebody about to read it — so the
   * useful freshness is at the moment of return, not on a timer nobody is
   * watching.
   */
  it('stops while the tab is hidden and asks again the moment it is back', async () => {
    vi.useFakeTimers()
    const { box, fetchMock } = stubLab(CLOSED)

    render(<LabStatus />)
    await settle()
    expect(screen.getByText('LAB CLOSED')).toBeInTheDocument()

    await act(async () => {
      setVisibility('hidden')
    })

    const onHide = fetchMock.mock.calls.length

    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000)
    })
    await settle()

    // Ten polls' worth of time, and not one request.
    expect(fetchMock.mock.calls.length).toBe(onHide)

    box.body = OPEN
    await act(async () => {
      setVisibility('visible')
    })
    await settle()

    // Straight away, rather than waiting out the rest of an interval.
    expect(screen.getByText('LAB OPEN')).toBeInTheDocument()
  })
})
