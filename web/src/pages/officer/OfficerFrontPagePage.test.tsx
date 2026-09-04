import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfficerFrontPagePage } from './OfficerFrontPagePage'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import type {
  ApiFaq,
  ApiFrontPage,
  ApiHeroSlide,
  ApiPartnerProgram,
  ApiTerm,
  UserRole,
} from '../../lib/api/api'
import { MAX_HERO_SLIDES } from '../../lib/heroSlides'
import { bodyOf, urlOf } from '../../test/stubFetch'

/**
 * The desk behind the front page.
 *
 * Two halves and two reads: the slideshow, and the words beside it — the headline, the FAQ and the
 * partner programs. They fetch separately so neither waits on the other, which is why the stub
 * answers two paths and why the unreachable case expects both halves to say so.
 *
 * What's worth pinning isn't the form plumbing:
 *
 * That the read asks for a fresh answer. The list it edits is the public endpoint, which is
 * `s-maxage=300` for everybody — so without a cache-skipping read an officer who adds a photograph
 * and reloads is handed the answer from before they did.
 *
 * `cache: 'reload'` rather than `'no-store'`, and the desk wants the difference: both skip the
 * cache on the way out, only `reload` replaces what's in it. With `no-store` this page would be
 * right while the landing page an officer checks next still drew the old slideshow.
 *
 * That deleting an upload asks first and deleting a link doesn't. The bytes are gone for good; a
 * link can be pasted back in.
 *
 * That an empty slideshow is described as a fine thing to leave, because an officer who thinks
 * removing the last photograph leaves a hole won't remove a bad one.
 *
 * That the headline is a form and the lists aren't: the two lines read as one sentence, so they're
 * written together by one SAVE; a question and its answer are independent facts.
 *
 * And that emptying the partner list is described as taking the section off the page.
 */

const term: ApiTerm = {
  year: 2035,
  season: 'FALL',
  startsAt: '2035-08-24T04:00:00.000Z',
  endsAt: '2035-12-14T04:59:59.999Z',
  fromCalendar: true,
}

const context = (
  role: UserRole = 'OFFICER',
  over: Partial<DashboardContext['membership']> = {},
): DashboardContext => ({
  user: {
    id: 'u1',
    fullName: 'Officer Test',
    email: null,
    slug: null,
    role,
    discordUsername: null,
    photoUrl: null,
    photoFocalX: 50,
    photoFocalY: 50,
    photoZoom: 1,
  },
  projects: { status: 'ready', data: [] },
  reloadProjects: () => Promise.resolve(),
  membership: {
    status: 'ready',
    data: {
      status: 'ACTIVE',
      hasAccess: true,
      duesRequired: false,
      paidThrough: term.endsAt,
      freeThrough: null,
      term,
      billable: term,
      freeActive: false,
      canActivate: false,
      surveyPending: false,
      surveyPromptDismissed: false,
    },
    ...over,
  } as DashboardContext['membership'],
  reloadMembership: () => Promise.resolve(),
})

const slide = (
  id: string,
  caption: string | null,
  url = `https://photos.invalid/${id}.jpg`,
): ApiHeroSlide => ({ id, url, caption, focalX: 50, focalY: 50, zoom: 1 })

const LINKED = slide('a', 'Rover on the field')
const UPLOADED = slide('b', 'Build night', '/api/files/f1')

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

const FAQ: ApiFaq = {
  id: 'q1',
  question: 'Do I need experience to join?',
  answer: 'No.',
  steps: [],
}

const PROGRAM: ApiPartnerProgram = {
  id: 'p1',
  name: 'VEX Robotics',
  audience: 'SCHOOL TEAMS',
  blurb: 'What RCCF does with VEX.',
  href: 'https://www.vexrobotics.com/',
  linkLabel: 'Visit VEX Robotics',
  imageUrl: null,
}

const PAGE: ApiFrontPage = {
  headline: 'Building Our Future,',
  headlineAccent: 'One Robot at a Time.',
  lede: 'A paragraph under the headline.',
  partnersIntro: 'Club membership is UCF students only.',
  faqs: [FAQ],
  partners: [PROGRAM],
}

/**
 * Both lists, each read from its public path and written to its officer one — so
 * the stub branches on the method as well as the path, and a write is answered
 * with the row the server would have sent back.
 */
const stubApi = (
  slides: ApiHeroSlide[] = [LINKED, UPLOADED],
  written: unknown = slide('new', null, 'https://photos.invalid/new.jpg'),
  page: ApiFrontPage = PAGE,
  wrote?: unknown,
) =>
  vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input)
    const writing = init?.method !== undefined && init.method !== 'GET'

    if (url.includes('/hero-slides')) return json(writing ? written : slides)

    if (url.includes('/front-page')) {
      if (!writing) return json(page)
      if (wrote !== undefined) return json(wrote)

      // A write is answered with the whole row, not with what was sent. These routes answer with
      // the full shape, and a stub that echoed the patch would hand the desk a question with no
      // `steps` on it — which throws where the real thing doesn't.
      const sent = bodyOf(init) as Record<string, unknown>
      if (url.includes('/order')) return json(url.includes('/faqs') ? page.faqs : page.partners)
      if (url.includes('/faqs')) return json({ ...FAQ, ...sent })
      if (url.includes('/partners')) return json({ ...PROGRAM, ...sent })
      return json({ ...page, ...sent })
    }

    return Promise.reject(new Error(`no stub for ${url}`))
  })

const renderPage = (dashboard = context()) =>
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={dashboard} />}>
          <Route path="/" element={<OfficerFrontPagePage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

const callsOf = (stub: ReturnType<typeof stubApi>, method: string) =>
  stub.mock.calls.filter(([, init]) => init?.method === method)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OfficerFrontPagePage', () => {
  it('lists the photos, with a caption box for each', async () => {
    vi.stubGlobal('fetch', stubApi())

    renderPage()

    expect(
      await screen.findByLabelText('Caption for photo 1'),
    ).toHaveValue('Rover on the field')
    expect(screen.getByLabelText('Caption for photo 2')).toHaveValue('Build night')
    expect(screen.getByText(`2 / ${MAX_HERO_SLIDES} PHOTOS`)).toBeInTheDocument()
  })

  it('asks the server not to answer that read from a cache', async () => {
    const stub = stubApi()
    vi.stubGlobal('fetch', stub)

    renderPage()

    await screen.findByLabelText('Caption for photo 1')

    const [, init] = stub.mock.calls[0]
    expect(init?.cache).toBe('reload')
  })

  it('adds a photo by link and puts it on the end', async () => {
    const stub = stubApi([LINKED])
    vi.stubGlobal('fetch', stub)

    renderPage()

    await screen.findByLabelText('Caption for photo 1')

    fireEvent.change(screen.getByLabelText('OR ADD BY LINK'), {
      target: { value: 'https://photos.invalid/new.jpg' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ADD' }))

    await waitFor(() => {
      expect(callsOf(stub, 'POST')).toHaveLength(1)
    })

    const [path, init] = callsOf(stub, 'POST')[0]
    expect(urlOf(path)).toContain('/officer/hero-slides')
    expect(bodyOf(init)).toEqual({ url: 'https://photos.invalid/new.jpg' })
    expect(await screen.findByLabelText('Caption for photo 2')).toBeInTheDocument()
  })

  /** A link can be pasted back in. The bytes cannot, which is the whole rule. */
  it('deletes a linked photo outright and asks before deleting an upload', async () => {
    const stub = stubApi()
    vi.stubGlobal('fetch', stub)

    renderPage()

    await screen.findByLabelText('Caption for photo 1')

    fireEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }))
    await waitFor(() => {
      expect(callsOf(stub, 'DELETE')).toHaveLength(1)
    })
    expect(screen.queryByText('Delete this photo?')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }))
    expect(screen.getByText('Delete this photo?')).toBeInTheDocument()
    // Still one: the dialog is up and nothing has been sent yet.
    expect(callsOf(stub, 'DELETE')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'DELETE IT' }))
    await waitFor(() => {
      expect(callsOf(stub, 'DELETE')).toHaveLength(2)
    })
  })

  it('moves a photo without waiting for the server to say so', async () => {
    vi.stubGlobal('fetch', stubApi())

    renderPage()

    await screen.findByLabelText('Caption for photo 1')

    fireEvent.click(screen.getByRole('button', { name: 'Move photo 2 earlier' }))

    // The list is the officer's to arrange; the write is debounced behind it,
    // because five arrow presses are one order and not five of them.
    expect(screen.getByLabelText('Caption for photo 1')).toHaveValue('Build night')
    expect(screen.getByLabelText('Caption for photo 2')).toHaveValue(
      'Rover on the field',
    )
  })

  it('says that an empty slideshow is a fine thing to leave', async () => {
    vi.stubGlobal('fetch', stubApi([]))

    renderPage()

    expect(await screen.findByText('[ NO PHOTOS YET ]')).toBeInTheDocument()
    expect(screen.getByText(/rings and the wireframe mark/)).toBeInTheDocument()
  })

  it('stops offering to add once the slideshow is full', async () => {
    const full = Array.from({ length: MAX_HERO_SLIDES }, (_, at) =>
      slide(`s${at}`, `Photo ${at}`),
    )
    vi.stubGlobal('fetch', stubApi(full))

    renderPage()

    await screen.findByLabelText('Caption for photo 1')

    expect(screen.getByText(/REMOVE ONE TO ADD ANOTHER/)).toBeInTheDocument()
    expect(screen.getByLabelText('OR ADD BY LINK')).toBeDisabled()
    expect(screen.getByLabelText('ADD FROM YOUR COMPUTER')).toBeDisabled()
  })

  it('says so rather than blanking when the photos will not load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )

    renderPage()

    // Both halves, because both read and both failed — one message with the
    // other half of the desk silently blank would be worse than two.
    expect(
      await screen.findAllByText("We couldn't reach the server."),
    ).toHaveLength(2)
  })

  it('writes the headline as one sentence, on a SAVE', async () => {
    const stub = stubApi()
    vi.stubGlobal('fetch', stub)

    renderPage()

    const first = await screen.findByLabelText('FIRST LINE')
    fireEvent.change(first, { target: { value: 'Building Something,' } })

    // Nothing goes out until SAVE: the second line is still the old one, and a
    // headline written half way is a headline on the front page.
    expect(callsOf(stub, 'PUT')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'SAVE THE WORDS' }))

    await waitFor(() => {
      expect(callsOf(stub, 'PUT')).toHaveLength(1)
    })

    const [, init] = callsOf(stub, 'PUT')[0]!
    expect(bodyOf(init)).toMatchObject({
      headline: 'Building Something,',
      headlineAccent: 'One Robot at a Time.',
      lede: 'A paragraph under the headline.',
    })
  })

  /** The preview is the one thing the two boxes cannot show on their own. */
  it('shows where the headline breaks and which half is gold', async () => {
    vi.stubGlobal('fetch', stubApi())

    renderPage()

    const accent = await screen.findByText('One Robot at a Time.')
    expect(accent.tagName).toBe('EM')
    expect(accent.className).toContain('text-primary')
  })

  it('saves a question when the box is left, not as it is typed', async () => {
    const stub = stubApi()
    vi.stubGlobal('fetch', stub)

    renderPage()

    const question = await screen.findByLabelText('Question 1')
    fireEvent.change(question, { target: { value: 'Do I need any experience?' } })
    expect(callsOf(stub, 'PATCH')).toHaveLength(0)

    fireEvent.blur(question)

    await waitFor(() => {
      expect(callsOf(stub, 'PATCH')).toHaveLength(1)
    })
    expect(bodyOf(callsOf(stub, 'PATCH')[0]![1])).toEqual({
      question: 'Do I need any experience?',
    })
  })

  /** A blank box is a mistake rather than an edit, and the row is put back
      instead of a question being wiped off the front page. */
  it('will not save an emptied question', async () => {
    const stub = stubApi()
    vi.stubGlobal('fetch', stub)

    renderPage()

    const question = await screen.findByLabelText('Question 1')
    fireEvent.change(question, { target: { value: '   ' } })
    fireEvent.blur(question)

    expect(callsOf(stub, 'PATCH')).toHaveLength(0)
    expect(question).toHaveValue(FAQ.question)
  })

  it('asks before deleting a question, because the answer goes with it', async () => {
    const stub = stubApi()
    vi.stubGlobal('fetch', stub)

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'Remove question 1' }))

    expect(screen.getByText('Delete this question?')).toBeInTheDocument()
    expect(callsOf(stub, 'DELETE')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'DELETE IT' }))

    await waitFor(() => {
      expect(callsOf(stub, 'DELETE')).toHaveLength(1)
    })
  })

  it('says that emptying the partner list takes the section off the page', async () => {
    vi.stubGlobal('fetch', stubApi())

    renderPage()

    expect(
      await screen.findByText(/comes off the front page altogether/i),
    ).toBeInTheDocument()
  })

  it('holds the artwork well open for a program that has none', async () => {
    vi.stubGlobal('fetch', stubApi())

    renderPage()

    expect(await screen.findByText('[ IMAGE ]')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'TAKE THE ARTWORK OFF' }),
    ).not.toBeInTheDocument()
  })

  it('is closed to anybody who is not an officer', () => {
    vi.stubGlobal('fetch', stubApi())

    renderPage(context('MEMBER'))

    expect(screen.getByText('This desk belongs to the officers.')).toBeInTheDocument()
  })

  /** Dues before role, the order every other desk uses: a lapsed officer is
      still an officer, and the sentence they need is about a payment. */
  it('sends a lapsed officer to dues before it mentions the desk', () => {
    vi.stubGlobal('fetch', stubApi())

    renderPage(
      context('OFFICER', {
        data: {
          status: 'LAPSED',
          hasAccess: false,
          duesRequired: true,
          paidThrough: null,
          freeThrough: null,
          term,
          billable: term,
          freeActive: false,
          canActivate: false,
          surveyPending: false,
          surveyPromptDismissed: false,
        },
      } as Partial<DashboardContext['membership']>),
    )

    expect(screen.getByText('Your dues have lapsed.')).toBeInTheDocument()
  })
})
