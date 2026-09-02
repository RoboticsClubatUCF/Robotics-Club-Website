import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfficerProjectsPage } from './OfficerProjectsPage'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import type {
  ApiManagedProject,
  ApiMyProject,
  ApiTerm,
  UserRole,
} from '../../lib/api/api'
import { urlOf } from '../../test/stubFetch'

/**
 * The projects desk.
 *
 * Creating one is two steps, and it is two steps because it has to be: a
 * picture and a link both hang off a project id that does not exist until the
 * project does. The tests that matter are about the seam that creates — the
 * project is live between the steps, and somebody who stops halfway has to be
 * told so and given a way out.
 *
 * The second panel is duplication, which exists because the dashboard became
 * term-scoped: a build that runs for years is one row per term now, and this is
 * how the next row gets made.
 *
 * Appointing a lead used to be tested here and is not any more — it moved to
 * the roles desk, and so did its tests. What is left on this page is entirely
 * about projects.
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
  // Every project carries the term it is built for, and the dashboard
  // splits on it. Pinned rather than left to today's date.
  termYear: 2035,
  termSeason: 'FALL',
  competition: null,
  status: 'IN_PROGRESS',
  coverUrl: null,
  repoUrl: null,
  featured: false,
  startedAt: null,
  completedAt: null,
  meetingWeekdays: [],
  meetingStartTime: null,
  meetingEndTime: null,
  meetingLocation: null,
  meetingsPublic: true,
  discordRoleId: null,
}

/** A project already on the books, for the duplicate panel to copy from. */
const existing: ApiManagedProject = {
  ...created,
  id: 'p-old',
  slug: 'rover-one',
  title: 'Rover One',
  termYear: 2034,
  termSeason: 'SPRING',
}

const mine = (rank: ApiMyProject['rank']): ApiMyProject => ({
  rank,
  title: null,
  team: null,
  current: true,
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
    photoUrl: null,
    photoFocalX: 50,
    photoFocalY: 50,
    photoZoom: 1,
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
      surveyRequired: false,
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
 * The create panel, scoped — the duplicate panel below it is on screen at the
 * same time, and both are forms about a project. Its fields are labelled NEW
 * TITLE and NEW SLUG so the two do not collide, but scoping is still what makes
 * these queries say which form they mean.
 */
const createPanel = () =>
  within(screen.getByText('CREATE A PROJECT').closest('div')!)

const duplicatePanel = () =>
  within(screen.getByText('RUN ONE AGAIN NEXT TERM').closest('div')!)

/**
 * Fills the create form and submits it. No lead is picked: the field is
 * optional now, and the flows these tests are about do not turn on it.
 *
 * **The meeting is not optional**, which is why it is filled in here rather
 * than in the two tests that are about it. Every flow below has to get past the
 * form's own refusal to submit without one, so leaving it out of this helper
 * would mean twelve tests failing for a reason none of them is about.
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

  fillMeeting()

  await act(async () => {
    fireEvent.click(panel.getByRole('button', { name: 'CREATE PROJECT' }))
  })
}

/**
 * Tuesdays and Thursdays, 6 till 10 — the club's own example.
 *
 * The days are checkboxes queried by role rather than by label text: the visible
 * chip is a `<label>` wrapping an `sr-only` input, and `getByLabelText` would
 * match the `<legend>` just as readily. `testing.md` names this exact trap.
 */
function fillMeeting() {
  const panel = createPanel()

  for (const day of ['TUE', 'THU']) {
    fireEvent.click(panel.getByRole('checkbox', { name: day }))
  }
  fireEvent.change(panel.getByLabelText('FROM'), {
    target: { value: '18:00' },
  })
  fireEvent.change(panel.getByLabelText('TO'), {
    target: { value: '22:00' },
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
    if (url.includes('/officer/projects') && url.endsWith('/duplicate')) {
      return json(over.duplicate ?? { ...created, id: 'p-copy' }, 201)
    }
    // The duplicate panel's source list. One project, so the select has
    // something to pick and the term suffix has something to print.
    if (url.includes('/projects?')) return json(over.projects ?? [existing])
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

    // Unscoped, and that is the assertion: the duplicate panel is on screen
    // throughout and has fields of the same shape, so these queries only find
    // one each because its labels say NEW TITLE and NEW SEASON.
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
 * Running last term's project again this term.
 *
 * The club's builds outlast a semester, and the dashboard is term-scoped now,
 * so a build that carries on is one row per term. This is the panel that makes
 * the next row.
 */
describe('duplicating a project', () => {
  const pickSource = () => {
    fireEvent.change(duplicatePanel().getByLabelText('COPY FROM'), {
      target: { value: 'p-old' },
    })
  }

  it('names the term beside each project to copy from', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage()
    await act(async () => {})

    // A build run three years running is three rows with one name, so the
    // title alone would not say which one is being copied.
    expect(
      duplicatePanel().getByRole('option', { name: 'Rover One — Spring 2034' }),
    ).toBeInTheDocument()
  })

  it('sends the new slug and the term, and lands in the editor', async () => {
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await act(async () => {})

    pickSource()
    fireEvent.change(duplicatePanel().getByLabelText(/NEW SLUG/), {
      target: { value: 'rover-two' },
    })
    fireEvent.change(duplicatePanel().getByLabelText('TERM'), {
      target: { value: 'FALL' },
    })
    fireEvent.change(duplicatePanel().getByLabelText('YEAR'), {
      target: { value: '2035' },
    })

    await act(async () => {
      fireEvent.click(
        duplicatePanel().getByRole('button', { name: 'DUPLICATE IT' }),
      )
    })

    const call = fetchMock.mock.calls.find(([input]) =>
      urlOf(input).endsWith('/duplicate'),
    )
    expect(call).toBeDefined()
    expect(urlOf(call![0])).toContain('/officer/projects/p-old/duplicate')
    expect(JSON.parse(call![1]!.body as string)).toMatchObject({
      slug: 'rover-two',
      termYear: 2035,
      termSeason: 'FALL',
    })

    // Straight into the editor, because the first thing anybody does after
    // duplicating is change the summary.
    expect(screen.getByText(/is live/)).toBeInTheDocument()
  })

  /** Leaving both blank means "the term we are in", which the server decides. */
  it('sends no term when neither field is filled', async () => {
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await act(async () => {})

    pickSource()
    fireEvent.change(duplicatePanel().getByLabelText(/NEW SLUG/), {
      target: { value: 'rover-two' },
    })

    await act(async () => {
      fireEvent.click(
        duplicatePanel().getByRole('button', { name: 'DUPLICATE IT' }),
      )
    })

    const call = fetchMock.mock.calls.find(([input]) =>
      urlOf(input).endsWith('/duplicate'),
    )
    const body = JSON.parse(call![1]!.body as string) as Record<string, unknown>
    expect(body).not.toHaveProperty('termYear')
    expect(body).not.toHaveProperty('termSeason')
  })

  /** The server's own sentence, printed rather than flattened into an apology. */
  it('keeps what was typed when the slug is taken', async () => {
    const fetchMock = vi.fn((input: string | URL | Request) =>
      urlOf(input).endsWith('/duplicate')
        ? json({ error: 'A project already has that slug.' }, 409)
        : urlOf(input).includes('/projects?')
          ? json([existing])
          : json({}),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await act(async () => {})

    pickSource()
    fireEvent.change(duplicatePanel().getByLabelText(/NEW SLUG/), {
      target: { value: 'rover-one' },
    })

    await act(async () => {
      fireEvent.click(
        duplicatePanel().getByRole('button', { name: 'DUPLICATE IT' }),
      )
    })

    expect(
      screen.getByText('A project already has that slug.'),
    ).toBeInTheDocument()
    expect(duplicatePanel().getByLabelText(/NEW SLUG/)).toHaveValue('rover-one')
  })
})

/**
 * The crew's Discord role, which is the one field on either form that changes
 * something outside this website.
 */
describe('the project Discord role', () => {
  it('sends what was typed into the create form', async () => {
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await act(async () => {})

    fireEvent.change(createPanel().getByLabelText('DISCORD ROLE'), {
      target: { value: '984535585270157362' },
    })
    await createProject()

    const call = fetchMock.mock.calls.find(
      ([input, init]) =>
        urlOf(input).endsWith('/officer/projects') && init?.method === 'POST',
    )
    expect(JSON.parse(call![1]!.body as string)).toMatchObject({
      discordRoleId: '984535585270157362',
    })
  })

  it('says nothing about the role when the duplicate box is left blank', async () => {
    // Blank means "same as the original", the rule NEW TITLE already follows,
    // and the server is what carries it across. Sending an explicit null here
    // would silently strip the crew role off next semester's row.
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await act(async () => {})

    fireEvent.change(duplicatePanel().getByLabelText('COPY FROM'), {
      target: { value: 'p-old' },
    })
    fireEvent.change(duplicatePanel().getByLabelText(/NEW SLUG/), {
      target: { value: 'rover-two' },
    })

    await act(async () => {
      fireEvent.click(
        duplicatePanel().getByRole('button', { name: 'DUPLICATE IT' }),
      )
    })

    const call = fetchMock.mock.calls.find(([input]) =>
      urlOf(input).endsWith('/duplicate'),
    )
    expect(JSON.parse(call![1]!.body as string)).not.toHaveProperty(
      'discordRoleId',
    )
  })

  it('sends a different role when the officer names one', async () => {
    const fetchMock = stubDesk()
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await act(async () => {})

    fireEvent.change(duplicatePanel().getByLabelText('COPY FROM'), {
      target: { value: 'p-old' },
    })
    fireEvent.change(duplicatePanel().getByLabelText(/NEW SLUG/), {
      target: { value: 'rover-two' },
    })
    fireEvent.change(duplicatePanel().getByLabelText('NEW DISCORD ROLE'), {
      target: { value: '1242854709300039781' },
    })

    await act(async () => {
      fireEvent.click(
        duplicatePanel().getByRole('button', { name: 'DUPLICATE IT' }),
      )
    })

    const call = fetchMock.mock.calls.find(([input]) =>
      urlOf(input).endsWith('/duplicate'),
    )
    expect(JSON.parse(call![1]!.body as string)).toMatchObject({
      discordRoleId: '1242854709300039781',
    })
  })

  /**
   * Both panels are on screen together, so the two labels have to differ —
   * the rule that gave the duplicate form NEW TITLE and NEW SLUG. Unscoped
   * queries are the assertion.
   */
  it('labels the two role fields differently', async () => {
    vi.stubGlobal('fetch', stubDesk())
    renderPage()
    await act(async () => {})

    expect(screen.getByLabelText('DISCORD ROLE')).toBeInTheDocument()
    expect(screen.getByLabelText('NEW DISCORD ROLE')).toBeInTheDocument()
  })
})


/**
 * The way into managing a project the officer is not on.
 *
 * The rail lists the projects you are a member of and draws MANAGE under a
 * lead's rank, so an officer who is on nothing had no link to
 * `/dashboard/projects/:slug/manage` at all — the page has always accepted
 * them, and the only way to reach it was to type the address. These cover the
 * link, and that it points at the lead's own URL rather than an officer-only
 * copy of the page.
 */
describe('reaching any project from the desk', () => {
  /** This semester's build. Handed to the stub *second* so the assertions
      below are about the split rather than about the input order. */
  const running: ApiManagedProject = {
    ...created,
    id: 'p-now',
    slug: 'rover-now',
    title: 'Rover Now',
    termYear: term.year,
    termSeason: term.season,
  }

  const everyPanel = () =>
    within(screen.getByText('EVERY PROJECT').closest('div')!)

  const hrefs = () =>
    everyPanel()
      .getAllByRole('link', { name: 'MANAGE' })
      .map((link) => link.getAttribute('href'))

  it('shows this semester and keeps older terms behind the button', async () => {
    vi.stubGlobal('fetch', stubDesk({ projects: [existing, running] }))
    renderPage()
    await act(async () => {})

    // `/dashboard/projects/...`, never `/dashboard/officer/...`: an `officer`
    // segment in a URL a lead is entitled to would be a lie in the address bar.
    expect(hrefs()).toEqual(['/dashboard/projects/rover-now/manage'])
    expect(everyPanel().queryByText('Rover One')).not.toBeInTheDocument()

    // The count is on the button, because "there are more" and "there are
    // fifty-five more" are different things to know before pressing it.
    expect(
      everyPanel().getByRole('button', { name: 'SHOW PAST PROJECTS (1)' }),
    ).toBeInTheDocument()
  })

  it('reveals the older terms on press, and hides them again', async () => {
    vi.stubGlobal('fetch', stubDesk({ projects: [existing, running] }))
    renderPage()
    await act(async () => {})

    fireEvent.click(
      everyPanel().getByRole('button', { name: 'SHOW PAST PROJECTS (1)' }),
    )

    expect(hrefs()).toEqual([
      '/dashboard/projects/rover-now/manage',
      '/dashboard/projects/rover-one/manage',
    ])
    // The term is printed on the archive rows and not on this semester's,
    // where every row carries the same one.
    expect(everyPanel().getByText('Spring 2034')).toBeInTheDocument()

    fireEvent.click(
      everyPanel().getByRole('button', { name: 'HIDE PAST PROJECTS' }),
    )
    expect(hrefs()).toEqual(['/dashboard/projects/rover-now/manage'])
  })

  it('says nothing is running rather than drawing an empty panel', async () => {
    // Only the 2034 project, and the term is FALL 2026.
    vi.stubGlobal('fetch', stubDesk({ projects: [existing] }))
    renderPage()
    await act(async () => {})

    const panel = everyPanel()
    expect(panel.getByText('Nothing is running this semester.')).toBeInTheDocument()
    // Still reachable — it is hidden, not gone.
    expect(
      panel.getByRole('button', { name: 'SHOW PAST PROJECTS (1)' }),
    ).toBeInTheDocument()
  })

  it('hides nothing while the term is still in flight', async () => {
    vi.stubGlobal('fetch', stubDesk({ projects: [existing, running] }))
    renderPage({
      ...context(),
      membership: { status: 'loading' },
    })
    await act(async () => {})

    // An unanswered question must not read as "no projects this semester",
    // which is what splitting on a term nobody has yet would draw.
    expect(hrefs()).toHaveLength(2)
    expect(
      everyPanel().queryByRole('button', { name: /SHOW PAST PROJECTS/ }),
    ).not.toBeInTheDocument()
  })

  it('says so rather than emptying the panel when the list will not load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) =>
        urlOf(input).includes('/projects?')
          ? json({ error: 'nope' }, 500)
          : json({}),
      ),
    )
    renderPage()
    await act(async () => {})

    expect(
      everyPanel().getByText(/couldn’t load the projects just now/i),
    ).toBeInTheDocument()
  })
})
