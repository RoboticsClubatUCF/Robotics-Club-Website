import {
  fireEvent,
  render as renderBare,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AboutPage } from './AboutPage'
import { SessionProvider } from '../../lib/auth/auth'
import type { ApiAboutPage, ApiMilestone } from '../../lib/api/api'
import { apiBaseUrl } from '../../lib/api/api'
import { stubFetch, stubFetchNetworkError } from '../../test/stubFetch'

/**
 * `/about`.
 *
 * The page is a row now and the / WHAT WE DO list is gone from it, so what this suite is about has
 * moved: it used to check a list the API sent and a placeholder panel the component hardcoded, and
 * both of those facts are different. What matters here is the three things the page can get wrong
 * in a way nothing else would notice.
 *
 * - The placeholder warning is printed when there is one and absent when there is not. It is a
 *   field now, and emptying it is how the club retires the admission — a panel that stayed would
 *   call a written history invented, and one that never drew would put invented history under the
 *   club's name.
 * - The address panel comes off the page rather than printing half of one.
 * - The EDIT button is drawn for an officer and for nobody else. It decides nothing —
 *   `requireOfficer` on the route is the gate — but a button offered to a member is a 403 somebody
 *   had to walk into to find.
 */
const page = (over: Partial<ApiAboutPage> = {}): ApiAboutPage => ({
  heading: 'Building robots at UCF since 1972.',
  lede: 'A student organisation at UCF.',
  storyNotice: 'The history below is placeholder text.',
  story: ['One.', 'Two.'],
  labBuilding: 'UCF Institute for Simulation & Training',
  labStreet: '3100 Technology Pkwy',
  labCity: 'Orlando, FL 32826',
  labMapUrl: 'https://maps.example.com/ist',
  onlineBlurb: 'Discord is where the club actually talks.',
  updatedAt: '2026-09-30T12:00:00.000Z',
  stats: [
    { id: 's1', figure: '50+ years', label: 'of robotics at UCF' },
    { id: 's2', figure: '$15,000 annually', label: 'in funding from our sponsors' },
  ],
  milestones: [line({ id: 'm1', when: '1972', what: 'The club is founded.' })],
  ...over,
})

function line(over: Partial<ApiMilestone> & Pick<ApiMilestone, 'id' | 'when' | 'what'>): ApiMilestone {
  return {
    imageUrl: null,
    imageCaption: null,
    focalX: 50,
    focalY: 50,
    zoom: 1,
    ...over,
  }
}

const officer = {
  id: 'u1',
  fullName: 'Rowan Test',
  email: 'rowan@ucf.edu',
  slug: null,
  role: 'OFFICER',
  discordUsername: null,
}

const member = { ...officer, role: 'MEMBER' }

/**
 * The page asks the API for its words and the session for whether to draw the
 * button, so both are stubbed on every render. `user` is what decides which bar
 * of this suite a case is in.
 */
const render = (about: ApiAboutPage | 'down' = page(), user: unknown = null) => {
  vi.stubGlobal(
    'fetch',
    about === 'down'
      ? stubFetchNetworkError()
      : stubFetch({ '/about': about, '/auth/me': { user } }),
  )

  return renderBare(<AboutPage />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter>
        <SessionProvider>{children}</SessionProvider>
      </MemoryRouter>
    ),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AboutPage', () => {
  it('prints the heading, the story and the timeline the API sends', async () => {
    render()

    expect(
      await screen.findByRole('heading', { name: /since 1972/i }),
    ).toBeInTheDocument()
    expect(screen.getByText('One.')).toBeInTheDocument()
    expect(screen.getByText('The club is founded.')).toBeInTheDocument()
  })

  /**
   * The one thing this page could actually do harm with: history nobody has
   * written yet, printed under the club's name as though it were checked.
   */
  it('marks the history as placeholder text, in the open', async () => {
    render()

    expect(await screen.findByText(/placeholder text/i)).toBeInTheDocument()
  })

  /** And the other half of it, which is the half that was impossible before. */
  it('drops the placeholder panel once the notice is emptied', async () => {
    render(page({ storyNotice: null }))

    expect(await screen.findByText('One.')).toBeInTheDocument()
    expect(screen.queryByText(/placeholder text/i)).not.toBeInTheDocument()
  })

  /** The club's standing divisions were the live half of this page and are
      gone from the club entirely; nothing replaced the section. */
  it('does not draw the / WHAT WE DO list any more', async () => {
    render()

    expect(await screen.findByText('One.')).toBeInTheDocument()
    expect(screen.queryByText(/what we do/i)).not.toBeInTheDocument()
  })

  /**
   * The lab's hours are a promise only an officer can make — the front page's
   * sign answers "open right now", and this page forwards the question rather
   * than committing somebody to a time.
   */
  it('forwards the open question to the lab sign instead of printing hours', async () => {
    render()

    expect(await screen.findByText(/3100 Technology Pkwy/)).toBeInTheDocument()
    expect(screen.getByText(/says whether it is open right now/i)).toBeInTheDocument()
    expect(screen.queryByText(/8am/i)).not.toBeInTheDocument()
  })

  /** A club between homes prints no address rather than a panel with a gap in
      it, and the online half stays where it is. */
  it('takes the address panel off when there is no address', async () => {
    render(
      page({
        labBuilding: null,
        labStreet: null,
        labCity: null,
        labMapUrl: null,
      }),
    )

    expect(await screen.findByText(/Discord is where/i)).toBeInTheDocument()
    expect(screen.queryByText('THE LAB')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /open in maps/i })).not.toBeInTheDocument()
  })

  it('says so when the page could not be loaded', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render('down')

    expect(await screen.findByText(/couldn't reach the server/i)).toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('offers no way in to somebody who is not an officer', async () => {
    render(page(), member)

    expect(await screen.findByText('One.')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /edit this page/i }),
    ).not.toBeInTheDocument()
  })

  it('opens the editor for an officer, on the page itself', async () => {
    render(page(), officer)

    fireEvent.click(
      await screen.findByRole('button', { name: /edit this page/i }),
    )

    // The whole page, in boxes: the heading, the story, the timeline and the
    // address are all in the one form that SAVE writes.
    expect(
      screen.getByLabelText(/heading/i, { selector: 'input' }),
    ).toHaveValue('Building robots at UCF since 1972.')
    expect(screen.getByLabelText(/date for timeline line 1/i)).toHaveValue('1972')
    expect(screen.getByRole('button', { name: /save the page/i })).toBeInTheDocument()
  })

  /** CANCEL is a real discard, which is the reason the timeline is saved with
      the prose rather than writing itself as it is dragged. */
  it('puts the page back untouched when the editor is cancelled', async () => {
    render(page(), officer)

    fireEvent.click(
      await screen.findByRole('button', { name: /edit this page/i }),
    )

    const heading = screen.getByLabelText(/heading/i, { selector: 'input' })
    fireEvent.change(heading, { target: { value: 'Something else entirely.' } })

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(
      screen.getByRole('heading', { name: /since 1972/i }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Something else entirely.')).not.toBeInTheDocument()
  })
})

describe('OUR IMPACT', () => {
  /** jsdom has no `IntersectionObserver`, so the numbers never count and land as written. */
  it('prints each figure and the line under it', async () => {
    render()

    const section = (
      await screen.findByRole('heading', { name: /our impact/i })
    ).closest('section') as HTMLElement

    expect(within(section).getAllByRole('listitem')).toHaveLength(2)
    expect(within(section).getByText('$15,000 annually')).toBeInTheDocument()
    expect(within(section).getByText('in funding from our sponsors')).toBeInTheDocument()
  })

  it('takes the section off the page when there are no numbers', async () => {
    render(page({ stats: [] }))

    expect(await screen.findByText('One.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /our impact/i })).not.toBeInTheDocument()
  })

  /** A deploy puts the bundle up before the API restarts, and the old API sends no `stats`. */
  it('still draws the page for an API that sends no numbers', async () => {
    const { stats, ...older } = page()
    void stats
    render(older as ApiAboutPage)

    expect(await screen.findByText('One.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /our impact/i })).not.toBeInTheDocument()
  })
})

describe('timeline photos', () => {
  const withPhoto = page({
    milestones: [
      line({
        id: 'm1',
        when: '1972',
        what: 'The club is founded.',
        imageUrl: '/api/files/abc',
        imageCaption: 'The first meeting',
      }),
      line({ id: 'm2', when: '1998', what: 'Something else happens.' }),
    ],
  })

  it('draws a line’s photo from the API’s origin, with its caption as the alt', async () => {
    render(withPhoto)

    const photo = await screen.findByRole('img', { name: 'The first meeting' })

    expect(photo).toHaveAttribute('src', `${apiBaseUrl}/api/files/abc`)
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('offers to add a photo to each line in the editor', async () => {
    render(withPhoto, officer)

    fireEvent.click(await screen.findByRole('button', { name: /edit this page/i }))

    expect(screen.getByLabelText(/caption for the photo on line 1/i)).toHaveValue(
      'The first meeting',
    )
    expect(screen.getByRole('button', { name: /add a photo to line 2/i })).toBeInTheDocument()
  })
})

describe('saving', () => {
  const saveWith = async (about: ApiAboutPage) => {
    const fetch = stubFetch({
      '/officer/about': about,
      '/about': about,
      '/auth/me': { user: officer },
    })
    vi.stubGlobal('fetch', fetch)

    renderBare(<AboutPage />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <MemoryRouter>
          <SessionProvider>{children}</SessionProvider>
        </MemoryRouter>
      ),
    })

    fireEvent.click(await screen.findByRole('button', { name: /edit this page/i }))

    return fetch
  }

  /** The page as JSON in `page`, sent the way the server reads it. */
  const sentPage = (fetch: ReturnType<typeof stubFetch>) => {
    const put = fetch.mock.calls.find(([, init]) => init?.method === 'PUT')
    const form = put?.[1]?.body as FormData
    return JSON.parse(form.get('page') as string) as {
      version: string | null
      stats: { figure: string; label: string }[]
      milestones: { photo: unknown; imageCaption?: string | null }[]
    }
  }

  it('sends the numbers and keeps a stored photo by its address', async () => {
    const about = page({
      milestones: [
        line({
          id: 'm1',
          when: '1972',
          what: 'The club is founded.',
          imageUrl: '/api/files/abc',
          imageCaption: 'The first meeting',
        }),
      ],
    })
    const fetch = await saveWith(about)

    fireEvent.change(screen.getByLabelText(/figure for number 1/i), {
      target: { value: '55+ years' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save the page/i }))

    await waitFor(() => {
      expect(fetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true)
    })

    const sent = sentPage(fetch)
    // The version it loaded, so a save over somebody else's is refused.
    expect(sent.version).toBe('2026-09-30T12:00:00.000Z')
    expect(sent.stats[0]).toEqual({ figure: '55+ years', label: 'of robotics at UCF' })
    expect(sent.milestones[0]?.photo).toEqual({ keep: '/api/files/abc' })
    expect(sent.milestones[0]?.imageCaption).toBe('The first meeting')
  })

  it('refuses a number with its figure but not the line under it', async () => {
    const fetch = await saveWith(page())

    fireEvent.click(screen.getByRole('button', { name: /add a number/i }))
    fireEvent.change(screen.getByLabelText(/figure for number 3/i), {
      target: { value: '12 robots' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save the page/i }))

    expect(
      await screen.findByText(/every number needs its figure and the line under it/i),
    ).toBeInTheDocument()
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('sends a removed photo as no photo at all', async () => {
    const fetch = await saveWith(
      page({
        milestones: [
          line({
            id: 'm1',
            when: '1972',
            what: 'The club is founded.',
            imageUrl: '/api/files/abc',
          }),
        ],
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: /remove the photo from line 1/i }))

    // The pressed button is gone, so focus goes to the one that replaced it.
    expect(screen.getByRole('button', { name: /add a photo to line 1/i })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: /save the page/i }))

    await waitFor(() => {
      expect(fetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true)
    })
    expect(sentPage(fetch).milestones[0]?.photo).toBeNull()
  })

  /** The framer hands its framing over only on DONE, so a SAVE past it would drop the change. */
  it('won’t save while a photo is being framed', async () => {
    const fetch = await saveWith(
      page({
        milestones: [
          line({
            id: 'm1',
            when: '1972',
            what: 'The club is founded.',
            imageUrl: '/api/files/abc',
          }),
        ],
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: /frame the photo on line 1/i }))
    fireEvent.click(screen.getByRole('button', { name: /save the page/i }))

    expect(await screen.findByText(/press done or cancel/i)).toBeInTheDocument()
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })
})
