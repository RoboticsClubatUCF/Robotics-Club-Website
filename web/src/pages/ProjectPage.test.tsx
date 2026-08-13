import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectPage } from './ProjectPage'
import type { ApiProjectDetail, ApiUser, UserRole } from '../lib/api'
import { SessionProvider } from '../lib/auth'
import { urlOf } from '../test/stubFetch'

const project = (over: Partial<ApiProjectDetail> = {}): ApiProjectDetail => ({
  id: 'p1',
  slug: 'project-storm',
  title: 'Project S.T.O.R.M.',
  summary: 'Research, design, build and test a Mars rover.',
  description: null,
  season: 'June 2026',
  competition: 'UNIVERSITY ROVER CHALLENGE',
  status: 'IN_PROGRESS',
  coverUrl: null,
  repoUrl: null,
  featured: true,
  startedAt: null,
  completedAt: null,
  members: [],
  images: [],
  links: [],
  ...over,
})

const user = (role: UserRole): ApiUser =>
  ({ id: 'u1', fullName: 'Rowan Chen', role }) as ApiUser

const json = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

/**
 * A `fetch` that answers each route, and remembers what was asked — the
 * signed-out test asserts on the *number* of calls, not just their answers.
 */
function stubRoutes(routes: Record<string, unknown>) {
  return vi.fn((input: string | URL | Request, _init?: RequestInit) => {
    const url = urlOf(input)
    const match = Object.keys(routes).find((path) => url.includes(path))
    if (!match) return Promise.reject(new Error(`no stub for ${url}`))
    return json(routes[match])
  })
}

const renderPage = () =>
  render(
    <SessionProvider>
      <MemoryRouter initialEntries={['/projects/project-storm']}>
        <Routes>
          <Route path="/projects/:slug" element={<ProjectPage />} />
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ProjectPage', () => {
  it('renders the project once it lands', async () => {
    vi.stubGlobal(
      'fetch',
      stubRoutes({
        '/auth/me': { user: null },
        '/projects/project-storm': project(),
      }),
    )

    renderPage()

    expect(await screen.findByText('Project S.T.O.R.M.')).toBeInTheDocument()
    expect(screen.getByText(/UNIVERSITY ROVER CHALLENGE/)).toBeInTheDocument()
  })

  /**
   * The contract behind `SignedInBody`, and the reason it exists.
   *
   * `useApi` has no dedupe, so a hook added at the top of the page body would
   * be a request every anonymous visitor pays for — on the one page that is
   * deliberately reachable signed out, so that somebody deciding whether to
   * join can read it. Two calls: the session, and the project. Nothing else.
   *
   * If this fails, look for a `useApi` that moved above the signed-in check.
   */
  it('asks for nothing but the session and the project when signed out', async () => {
    const fetchMock = stubRoutes({
      '/auth/me': { user: null },
      '/projects/project-storm': project(),
    })
    vi.stubGlobal('fetch', fetchMock)

    renderPage()
    await screen.findByText('Project S.T.O.R.M.')

    // Settle anything the render queued before counting.
    await waitFor(() => {
      expect(screen.getByText(/SIGN IN TO JOIN/)).toBeInTheDocument()
    })

    const asked = fetchMock.mock.calls.map(([input]) => urlOf(input))
    expect(asked.filter((url) => url.includes('/dues/status'))).toHaveLength(0)
    expect(asked.filter((url) => url.includes('/me/projects'))).toHaveLength(0)
    expect(asked).toHaveLength(2)
  })

  it('offers no edit button to a signed-in plain member', async () => {
    vi.stubGlobal(
      'fetch',
      stubRoutes({
        '/auth/me': { user: user('MEMBER') },
        '/projects/project-storm': project(),
        '/dues/status': { membership: { hasAccess: true } },
        '/me/projects': [{ rank: 'MEMBER', role: null, team: null, project: { id: 'p1' } }],
      }),
    )

    renderPage()
    await screen.findByText('Project S.T.O.R.M.')

    expect(screen.queryByRole('button', { name: 'EDIT PAGE' })).toBeNull()
  })

  it('offers the edit button to the project lead', async () => {
    vi.stubGlobal(
      'fetch',
      stubRoutes({
        '/auth/me': { user: user('MEMBER') },
        '/projects/project-storm': project(),
        '/dues/status': { membership: { hasAccess: true } },
        '/me/projects': [
          { rank: 'PROJECT_LEAD', role: null, team: null, project: { id: 'p1' } },
        ],
      }),
    )

    renderPage()

    expect(
      await screen.findByRole('button', { name: 'EDIT PAGE' }),
    ).toBeInTheDocument()
  })

  /** An officer edits any project, with no membership row on it at all. */
  it('offers the edit button to an officer who is not on the project', async () => {
    vi.stubGlobal(
      'fetch',
      stubRoutes({
        '/auth/me': { user: user('OFFICER') },
        '/projects/project-storm': project(),
        '/dues/status': { membership: { hasAccess: true } },
        '/me/projects': [],
      }),
    )

    renderPage()

    expect(
      await screen.findByRole('button', { name: 'EDIT PAGE' }),
    ).toBeInTheDocument()
  })

  /**
   * Not silence — a lead who has edited before would look for the button, fail
   * to find it, and conclude the site was broken. And not a blanked page:
   * this is public, and somebody else's unpaid dues are no reason to hide it.
   */
  it('tells a lapsed lead why the button is gone, and leaves the page readable', async () => {
    vi.stubGlobal(
      'fetch',
      stubRoutes({
        '/auth/me': { user: user('MEMBER') },
        '/projects/project-storm': project(),
        '/dues/status': { membership: { hasAccess: false } },
        '/me/projects': [
          { rank: 'PROJECT_LEAD', role: null, team: null, project: { id: 'p1' } },
        ],
      }),
    )

    renderPage()

    expect(await screen.findByText(/DUES LAPSED/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'EDIT PAGE' })).toBeNull()
    expect(screen.getByText('Project S.T.O.R.M.')).toBeInTheDocument()
    expect(
      screen.getByText('Research, design, build and test a Mars rover.'),
    ).toBeInTheDocument()
  })

  /** ADMIN is exempt from the dues lock, here as everywhere. */
  it('keeps the button for an admin whose dues have lapsed', async () => {
    vi.stubGlobal(
      'fetch',
      stubRoutes({
        '/auth/me': { user: user('ADMIN') },
        '/projects/project-storm': project(),
        '/dues/status': { membership: { hasAccess: false } },
        '/me/projects': [],
      }),
    )

    renderPage()

    expect(
      await screen.findByRole('button', { name: 'EDIT PAGE' }),
    ).toBeInTheDocument()
  })

  /**
   * The way out sits in the slot the way in came from, so somebody looking for
   * it looks where they last pressed something rather than scrolling for it.
   */
  it('swaps the edit button for a way back out', async () => {
    vi.stubGlobal(
      'fetch',
      stubRoutes({
        '/auth/me': { user: user('OFFICER') },
        '/projects/project-storm': project(),
        '/dues/status': { membership: { hasAccess: true } },
        '/me/projects': [],
      }),
    )

    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: 'EDIT PAGE' }))

    expect(screen.queryByRole('button', { name: 'EDIT PAGE' })).toBeNull()
    // One in the header, one at the foot of the editor — both real buttons.
    expect(screen.getAllByRole('button', { name: 'DONE EDITING' })).toHaveLength(2)

    fireEvent.click(screen.getAllByRole('button', { name: 'DONE EDITING' })[0])

    expect(
      await screen.findByRole('button', { name: 'EDIT PAGE' }),
    ).toBeInTheDocument()
  })

  /**
   * The write-up waits for SAVE, so leaving with it unsaved used to throw the
   * text away in silence — which reads as the site having eaten the work rather
   * than as a step having been missed.
   */
  it('asks before discarding unsaved writing, from either way out', async () => {
    vi.stubGlobal(
      'fetch',
      stubRoutes({
        '/auth/me': { user: user('OFFICER') },
        '/projects/project-storm': project(),
        '/dues/status': { membership: { hasAccess: true } },
        '/me/projects': [],
      }),
    )

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'EDIT PAGE' }))

    fireEvent.change(screen.getByLabelText('THE WRITE-UP'), {
      target: { value: 'Half a sentence' },
    })
    expect(screen.getByText('Unsaved changes.')).toBeInTheDocument()

    // The header button and the one at the foot of the editor both guard.
    for (const which of [0, 1]) {
      fireEvent.click(screen.getAllByRole('button', { name: 'DONE EDITING' })[which])
      expect(screen.getByText('Leave without saving?')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'KEEP EDITING' }))
      expect(screen.getByLabelText('THE WRITE-UP')).toHaveValue('Half a sentence')
    }

    fireEvent.click(screen.getAllByRole('button', { name: 'DONE EDITING' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'DISCARD THEM' }))

    expect(
      await screen.findByRole('button', { name: 'EDIT PAGE' }),
    ).toBeInTheDocument()
  })

  /** No dialog when there is nothing to lose — pictures save as they change. */
  it('leaves straight away when nothing is unsaved', async () => {
    vi.stubGlobal(
      'fetch',
      stubRoutes({
        '/auth/me': { user: user('OFFICER') },
        '/projects/project-storm': project(),
        '/dues/status': { membership: { hasAccess: true } },
        '/me/projects': [],
      }),
    )

    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'EDIT PAGE' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'DONE EDITING' })[0])

    expect(screen.queryByText('Leave without saving?')).toBeNull()
    expect(
      await screen.findByRole('button', { name: 'EDIT PAGE' }),
    ).toBeInTheDocument()
  })

  it('folds the repository into the resources list', async () => {
    vi.stubGlobal(
      'fetch',
      stubRoutes({
        '/auth/me': { user: null },
        '/projects/project-storm': project({
          repoUrl: 'https://github.com/rccf/storm',
          links: [
            { id: 'l1', label: 'Design doc', url: 'https://www.notion.so/doc' },
          ],
        }),
      }),
    )

    renderPage()

    expect(await screen.findByText('SOURCE CODE')).toBeInTheDocument()
    expect(screen.getByText('Design doc')).toBeInTheDocument()
    // The host, not the whole URL, and without the `www.`
    expect(screen.getByText(/notion\.so ↗/)).toBeInTheDocument()
  })

  it('says so when there is no project at the address', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, _init?: RequestInit) =>
        urlOf(input).includes('/auth/me')
          ? json({ user: null })
          : Promise.resolve(
              new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
            ),
      ),
    )

    renderPage()

    expect(await screen.findByText('There is no project here.')).toBeInTheDocument()
  })
})
