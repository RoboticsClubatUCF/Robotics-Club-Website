import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfficerFrontPagePage } from './OfficerFrontPagePage'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import type { ApiHeroSlide, ApiTerm, UserRole } from '../../lib/api/api'
import { MAX_HERO_SLIDES } from '../../lib/heroSlides'
import { bodyOf, urlOf } from '../../test/stubFetch'

/**
 * The desk behind the front page's slideshow.
 *
 * What is worth pinning here is not the form plumbing:
 *
 * **That the read asks for a fresh answer.** The list it edits is the *public*
 * endpoint, and that one is `s-maxage=300` for everybody — so without
 * `cache: 'no-store'` an officer who adds a photograph and reloads is handed the
 * answer from before they did, which looks exactly like a save that failed.
 *
 * **That deleting an upload asks first and deleting a link does not.** The bytes
 * are gone for good; a link can be pasted back in. A confirmation on both would
 * teach officers to click through it.
 *
 * **That an empty slideshow is described as a fine thing to leave**, because an
 * officer who thinks removing the last photograph leaves a hole in the front
 * page will not remove a bad photograph.
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
      surveyRequired: false,
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

/**
 * One list, read from the public path and written to the officer one — so the
 * stub branches on the method rather than the path, and a write is answered with
 * the row the server would have sent back.
 */
const stubApi = (
  slides: ApiHeroSlide[] = [LINKED, UPLOADED],
  written: unknown = slide('new', null, 'https://photos.invalid/new.jpg'),
) =>
  vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input)

    if (!url.includes('/hero-slides')) {
      return Promise.reject(new Error(`no stub for ${url}`))
    }

    if (init?.method !== undefined && init.method !== 'GET') return json(written)

    return json(slides)
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
    expect(init?.cache).toBe('no-store')
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

    expect(
      await screen.findByText("We couldn't reach the server."),
    ).toBeInTheDocument()
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
          surveyRequired: false,
        },
      } as Partial<DashboardContext['membership']>),
    )

    expect(screen.getByText('Your dues have lapsed.')).toBeInTheDocument()
  })
})
