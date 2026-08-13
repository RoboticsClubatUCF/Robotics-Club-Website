import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfficerProjectsPage } from './OfficerProjectsPage'
import type { DashboardContext } from '../components/dashboard/DashboardLayout'
import type {
  ApiManagedProject,
  ApiMyProject,
  ApiTerm,
  UserRole,
} from '../lib/api'
import { urlOf } from '../test/stubFetch'

/**
 * The projects desk.
 *
 * Creating one is two steps, and it is two steps because it has to be: a
 * picture and a link both hang off a project id that does not exist until the
 * project does. The tests that matter are about the seam that creates — the
 * project is live between the steps, and somebody who stops halfway has to be
 * told so and given a way out.
 *
 * The second thing under test is who gets what. Officers see the create panel
 * and the appointment panel; somebody carrying the `PROJECT_LEAD` roster label
 * sees the create panel alone, and only until they lead something. That cap is
 * `requireProjectCreator` on the server and the page only mirrors it, so what
 * these check is that the mirror says the same thing.
 */

const term: ApiTerm = {
  year: 2026,
  season: 'FALL',
  startsAt: '2026-08-24T04:00:00.000Z',
  endsAt: '2026-12-14T04:59:59.999Z',
  fromCalendar: true,
}

const created: ApiManagedProject = {
  id: 'p-new',
  slug: 'mars-rover',
  title: 'Mars Rover',
  summary: 'Research, design, build and test a Mars rover.',
  season: null,
  competition: null,
  status: 'IN_PROGRESS',
  coverUrl: null,
  repoUrl: null,
  featured: false,
  startedAt: null,
  completedAt: null,
  meetingWeekday: null,
  meetingTime: null,
  meetingLocation: null,
}

const mine = (rank: ApiMyProject['rank']): ApiMyProject => ({
  rank,
  title: null,
  team: null,
  project: { ...created, id: 'p-old', slug: 'rover-one', title: 'Rover One' },
})

const context = (
  role: UserRole = 'OFFICER',
  projects: ApiMyProject[] = [],
): DashboardContext => ({
  user: {
    id: 'u1',
    fullName: 'Officer Test',
    email: null,
    slug: null,
    role,
    discordUsername: null,
  },
  projects: { status: 'ready', data: projects },
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
    },
  },
  reloadMembership: () => Promise.resolve(),
})

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

const renderPage = (dashboard = context()) =>
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={dashboard} />}>
          <Route path="/" element={<OfficerProjectsPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

/**
 * The create panel, scoped — the appoint-a-lead panel below it carries a second
 * people-picker with the same label, so an unscoped query finds two.
 */
const createPanel = () =>
  within(screen.getByText('CREATE A PROJECT').closest('div')!)

/**
 * Fills the create form and submits it. No lead is picked: the field is
 * optional now, and the flows these tests are about do not turn on it.
 */
async function createProject() {
  const panel = createPanel()

  fireEvent.change(panel.getByLabelText('TITLE'), {
    target: { value: 'Mars Rover' },
  })
  fireEvent.change(panel.getByLabelText(/SLUG/), {
    target: { value: 'mars-rover' },
  })
  fireEvent.change(panel.getByLabelText(/ONE-LINE SUMMARY/), {
    target: { value: 'Research, design, build and test a Mars rover.' },
  })

  await act(async () => {
    fireEvent.click(panel.getByRole('button', { name: 'CREATE PROJECT' }))
  })
}

/**
 * A desk that answers like the real one — which the publish sequence needs, not
 * just the create call: the links route answers with the set it stored and the
 * gallery route with the row it made, and the panel puts both straight into the
 * editor rather than re-reading them.
 */
function stubDesk(over: Record<string, unknown> = {}) {
  let images = 0

  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input)
    const sent = () =>
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {}

    if (url.includes('/officer/members')) {
      return json([
        {
          id: 'u2',
          fullName: 'Rowan Chen',
          email: 'rowan@ucf.edu',
          discordUsername: null,
          role: 'MEMBER',
        },
      ])
    }
    if (url.includes('/officer/projects') && init?.method === 'POST') {
      return json(over.create ?? created, 201)
    }
    if (url.endsWith('/links')) {
      const body = sent() as { links: { label: string; url: string }[] }
      return json(
        body.links.map((link, index) => ({ id: `l${index}`, ...link })),
        200,
      )
    }
    if (url.endsWith('/images') || url.endsWith('/images/upload')) {
      const body = sent()
      images += 1
      return json(
        {
          id: `i${images}`,
          url: (body.url as string) ?? '/api/files/stored',
          caption: (body.caption as string) ?? null,
          focalX: 50,
          focalY: 50,
          zoom: 1,
          ...body,
        },
        201,
      )
    }
    if (url.includes('/projects?')) return json([])
    if (init?.method === 'DELETE') return json({ deleted: true })
    return json({})
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OfficerProjectsPage', () => {
  /**
   * The desk is officers only, all of it. It briefly had a second audience —
   * somebody carrying a `PROJECT_LEAD` roster label could start one project of
   * their own — and both that label and the delegation are gone. **Leading a
   * project confers nothing here**, which is the row worth keeping: authority
   * inside a project and permission to make another are different things.
   */
  it.each([
    ['a plain member', [] as ApiMyProject[]],
    ['somebody who already leads a project', [mine('PROJECT_LEAD')]],
  ])('refuses %s', (_who, projects) => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage(context('MEMBER', projects))

    expect(screen.queryByText('CREATE A PROJECT')).toBeNull()
    expect(screen.queryByText('APPOINT OR STAND DOWN A PROJECT LEAD')).toBeNull()
    expect(screen.getByText('This desk belongs to the officers.')).toBeInTheDocument()
  })

  /**
   * The whole project is fillable before it exists, and **nothing on the page
   * is gated**. Links and pictures cannot be stored yet, so they are held in
   * the browser and sent by the same press — which is what stops anything typed
   * here being lost by not getting far enough.
   */
  it('offers every section before the project exists', () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage()

    const panel = createPanel()
    expect(panel.getByLabelText('THE WRITE-UP')).toBeInTheDocument()
    expect(panel.getByLabelText('SOURCE CODE')).toBeInTheDocument()
    expect(panel.getByText('/ RESOURCES')).toBeInTheDocument()
    expect(panel.getByText('+ ADD A LINK')).toBeInTheDocument()
    expect(panel.getByText('/ GALLERY')).toBeInTheDocument()
    expect(panel.getByLabelText('ADD FROM YOUR COMPUTER')).toBeInTheDocument()
    expect(panel.getByLabelText('OR ADD BY LINK')).toBeInTheDocument()
  })

  /**
   * Neither of these needs an id, so neither waits for one — that is what makes
   * the gate narrow enough to be honest. `POST /officer/projects` takes both.
   */
  it('sends the write-up and the repository with the project itself', async () => {
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    const panel = createPanel()
    fireEvent.change(panel.getByLabelText('THE WRITE-UP'), {
      target: { value: 'Two years of chassis work.' },
    })
    fireEvent.change(panel.getByLabelText('SOURCE CODE'), {
      target: { value: 'https://github.com/rccf/rover' },
    })

    await createProject()

    const posted = fetchMock.mock.calls.find(
      ([, init]) => init?.method === 'POST',
    )
    expect(JSON.parse(posted![1]!.body as string)).toMatchObject({
      description: 'Two years of chassis work.',
      repoUrl: 'https://github.com/rccf/rover',
    })

    // And it is still there afterwards, rather than blank because the create
    // response does not carry it.
    expect(screen.getByLabelText('THE WRITE-UP')).toHaveValue(
      'Two years of chassis work.',
    )
    expect(screen.queryByText('Unsaved changes.')).toBeNull()
  })

  /**
   * The load-bearing one. Links and pictures are filled in before the project
   * exists, and one press lands the lot — in order, because the gallery route
   * appends and a parallel publish would shuffle it.
   */
  it('sends the links and the pictures with the same press', async () => {
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    const panel = createPanel()

    fireEvent.click(panel.getByText('+ ADD A LINK'))
    fireEvent.change(panel.getByLabelText('LABEL'), {
      target: { value: 'Design doc' },
    })
    fireEvent.change(panel.getByLabelText('LINK'), {
      target: { value: 'https://www.notion.so/doc' },
    })

    for (const url of ['https://example.test/a.png', 'https://example.test/b.png']) {
      fireEvent.change(panel.getByLabelText('OR ADD BY LINK'), {
        target: { value: url },
      })
      fireEvent.click(panel.getByRole('button', { name: 'ADD' }))
    }
    expect(createPanel().getByText(/2 \/ 12 IMAGES/)).toBeInTheDocument()

    await createProject()

    const sent = fetchMock.mock.calls.map(([input, init]) => ({
      url: urlOf(input),
      body: init?.body,
    }))

    // The project first — nothing below it has anywhere to go until it exists.
    // Indices rather than position zero: the appointment panel below fetches
    // the project list on mount, and that call is nothing to do with this.
    const madeAt = sent.findIndex((call) => call.url.includes('/officer/projects'))
    expect(madeAt).toBeGreaterThanOrEqual(0)
    expect(
      sent.findIndex((call) => call.url.endsWith('/links')),
    ).toBeGreaterThan(madeAt)

    const links = sent.find((call) => call.url.endsWith('/links'))
    expect(JSON.parse(links!.body as string)).toEqual({
      links: [{ label: 'Design doc', url: 'https://www.notion.so/doc' }],
    })

    const pictures = sent.filter((call) => call.url.endsWith('/images'))
    expect(pictures).toHaveLength(2)
    // In the order they were added, which is the order they will show in.
    expect(pictures.map((call) => JSON.parse(call.body as string).url)).toEqual([
      'https://example.test/a.png',
      'https://example.test/b.png',
    ])
  })

  /** Framing travels with the picture rather than as a second request. */
  it('sends the framing a picture was given, with the picture', async () => {
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    const panel = createPanel()
    fireEvent.change(panel.getByLabelText('OR ADD BY LINK'), {
      target: { value: 'https://example.test/a.png' },
    })
    fireEvent.click(panel.getByRole('button', { name: 'ADD' }))

    // Adding opens the framer on the new row; zoom in and keep it.
    fireEvent.change(createPanel().getByLabelText('ZOOM'), {
      target: { value: '2' },
    })
    fireEvent.click(createPanel().getByRole('button', { name: 'DONE' }))

    await createProject()

    const picture = fetchMock.mock.calls.find(([input]) =>
      urlOf(input).endsWith('/images'),
    )
    expect(JSON.parse(picture![1]!.body as string)).toMatchObject({
      url: 'https://example.test/a.png',
      zoom: 2,
    })
  })

  /**
   * By the time a picture fails the project is already live, so silence would
   * read as everything having worked. Named, above the editor that can fix it.
   */
  it('says what did not go up, and keeps what did', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = urlOf(input)
        if (url.endsWith('/images')) return json({ error: 'Nope' }, 500)
        if (url.includes('/officer/projects') && init?.method === 'POST') {
          return json(created, 201)
        }
        return json([])
      }),
    )
    renderPage()

    const panel = createPanel()
    fireEvent.change(panel.getByLabelText('OR ADD BY LINK'), {
      target: { value: 'https://example.test/a.png' },
    })
    fireEvent.click(panel.getByRole('button', { name: 'ADD' }))
    fireEvent.click(createPanel().getByRole('button', { name: 'CANCEL' }))

    await createProject()

    expect(screen.getByText(/The project was created, but not all of it/)).toBeInTheDocument()
    expect(screen.getByText(/Picture 1 could not be added/)).toBeInTheDocument()
    // Still landed in the editor, which is where the retry goes.
    expect(screen.getByText('SET UP · MARS ROVER')).toBeInTheDocument()
  })

  it('hands straight into setting the new project up', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage()

    await createProject()

    expect(screen.getByText('SET UP · MARS ROVER')).toBeInTheDocument()
    // The editor itself, not a second copy of it.
    expect(screen.getByText('/ GALLERY')).toBeInTheDocument()
    expect(screen.getByLabelText('THE WRITE-UP')).toBeInTheDocument()
    expect(screen.getByText('+ ADD A LINK')).toBeInTheDocument()
  })

  /**
   * The point of the chosen shape: nothing the create form asked for is left
   * behind on the way to the editor. Season and competition were create-only
   * fields until now, which made a season rolling over a job for Prisma Studio.
   */
  it('carries every create field into the editor below', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage()

    await createProject()

    expect(screen.getByLabelText('TITLE')).toHaveValue('Mars Rover')
    expect(screen.getByLabelText('SUMMARY')).toHaveValue(
      'Research, design, build and test a Mars rover.',
    )
    expect(screen.getByLabelText('SEASON')).toBeInTheDocument()
    expect(screen.getByLabelText('COMPETITION')).toBeInTheDocument()
  })

  /**
   * The surprising half of a two-step flow, and the reason the step says it out
   * loud: the project is public from the moment it is created, not from the
   * moment somebody finishes filling it in.
   */
  it('says the project is already live', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage()

    await createProject()

    expect(screen.getByText(/Mars Rover is live/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'its own page' })).toHaveAttribute(
      'href',
      '/projects/mars-rover',
    )
  })

  /** Without this, an abandoned project just sits on the public list. */
  it('offers to delete a project made by mistake, after confirming', async () => {
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await createProject()

    fireEvent.click(screen.getByRole('button', { name: 'DELETE THIS PROJECT' }))
    expect(screen.getByText('Delete Mars Rover?')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'DELETE IT' }))
    })

    const deleted = fetchMock.mock.calls.find(
      ([, init]) => init?.method === 'DELETE',
    )
    expect(deleted).toBeDefined()
    expect(urlOf(deleted![0])).toContain('/projects/p-new')

    // And the desk goes back to a fresh form.
    expect(screen.getByText('CREATE A PROJECT')).toBeInTheDocument()
  })

  it('goes back to a fresh form when the setup is finished', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage()

    await createProject()
    fireEvent.click(
      screen.getByRole('button', { name: 'FINISH — CREATE ANOTHER' }),
    )

    expect(screen.getByText('CREATE A PROJECT')).toBeInTheDocument()
    expect(screen.queryByText('SET UP · MARS ROVER')).toBeNull()
  })

  /**
   * The write-up waits for SAVE, so finishing with it unsaved would throw it
   * away — which is exactly the complaint this guard exists for.
   */
  it('asks before finishing with the write-up unsaved', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage()

    await createProject()

    fireEvent.change(screen.getByLabelText('THE WRITE-UP'), {
      target: { value: 'Half a sentence' },
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'FINISH — CREATE ANOTHER' }),
    )

    expect(screen.getByText('Leave without saving?')).toBeInTheDocument()
    expect(screen.getByText('SET UP · MARS ROVER')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'KEEP EDITING' }))
    expect(screen.queryByText('Leave without saving?')).toBeNull()
    expect(screen.getByText('SET UP · MARS ROVER')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'FINISH — CREATE ANOTHER' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'DISCARD THEM' }))

    expect(screen.getByText('CREATE A PROJECT')).toBeInTheDocument()
  })

  /** A taken slug is one word to change, not the whole form to type again. */
  it('keeps what was typed when creation is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = urlOf(input)
        if (url.includes('/officer/projects') && init?.method === 'POST') {
          return json({ error: 'A project already has that slug.' }, 409)
        }
        return json([])
      }),
    )
    renderPage()

    await createProject()

    expect(
      screen.getByText('A project already has that slug.'),
    ).toBeInTheDocument()
    expect(createPanel().getByLabelText('TITLE')).toHaveValue('Mars Rover')
    expect(createPanel().getByLabelText(/SLUG/)).toHaveValue('mars-rover')
  })
})

/**
 * The lead picker, which answers as it is typed rather than on a button.
 *
 * Fake timers for the debounce, and `advanceTimersByTimeAsync` inside `act` to
 * flush it — never `findBy*` or `waitFor` under fake timers, which would sit
 * there advancing nothing until the test times out.
 */
describe('the lead picker', () => {
  const type = async (value: string) => {
    fireEvent.change(createPanel().getByLabelText('FIND A MEMBER'), {
      target: { value },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('searches without being asked to, and picks from what it finds', async () => {
    vi.useFakeTimers()
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await type('rowan')

    expect(fetchMock.mock.calls.map(([input]) => urlOf(input))).toContainEqual(
      expect.stringContaining('/officer/members?query=rowan'),
    )
    fireEvent.click(createPanel().getByRole('button', { name: /Rowan Chen/ }))
    expect(createPanel().getByText('Rowan Chen')).toBeInTheDocument()
  })

  /** The route's own validator refuses one letter, so asking is a 400 a keystroke. */
  it('asks nothing until there are two letters', async () => {
    vi.useFakeTimers()
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await type('r')

    expect(
      fetchMock.mock.calls.filter(([input]) =>
        urlOf(input).includes('/officer/members'),
      ),
    ).toHaveLength(0)
    expect(screen.getByText('Two letters or more.')).toBeInTheDocument()
  })

  /** Five keystrokes are one request, not five. */
  it('waits for the typing to stop', async () => {
    vi.useFakeTimers()
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    const field = createPanel().getByLabelText('FIND A MEMBER')
    for (const value of ['ro', 'row', 'rowa', 'rowan']) {
      fireEvent.change(field, { target: { value } })
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    expect(
      fetchMock.mock.calls.filter(([input]) =>
        urlOf(input).includes('/officer/members'),
      ),
    ).toHaveLength(1)
  })
})

