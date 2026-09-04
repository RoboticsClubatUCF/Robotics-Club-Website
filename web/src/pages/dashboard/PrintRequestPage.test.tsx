import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PrintRequestPage } from './PrintRequestPage'
import type {
  ApiMyProject,
  ApiPrintAllowance,
  ApiPrintRequest,
  ApiTerm,
  UserRole,
} from '../../lib/api/api'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import {
  bodyOf,
  stubFetch,
  stubFetchNetworkError,
  stubFetchStatus,
  urlOf,
} from '../../test/stubFetch'

/**
 * What this page has to get right is the file rule, the storage rule and the budget rule.
 *
 * The file rule: a wrong extension is refused here, before anything is uploaded, because the
 * alternative is thirty megabytes and then a 400.
 *
 * The storage rule: a settled request has had its model deleted, so its row must not offer a
 * withdraw or imply the file is still there. The API says so by returning `fileId: null`.
 *
 * The budget rule: resin has no infill, so choosing it has to take those fields off the form and
 * out of the body — the server refuses a resin request that carries them.
 */

const request = (over: Partial<ApiPrintRequest> = {}): ApiPrintRequest => ({
  id: 'r1',
  fileName: 'bracket.stl',
  fileSize: 2_400_000,
  quantity: 1,
  notes: 'Black if there is any',
  status: 'PENDING',
  startedAt: null,
  officerNote: null,
  fileId: 'f1',
  process: 'FDM',
  material: 'PLA',
  infillPattern: 'GRID',
  infillDensity: 20,
  printedProcess: null,
  printedMaterial: null,
  printedInfillPattern: null,
  printedInfillDensity: null,
  gramsUsed: null,
  project: null,
  createdAt: '2026-08-01T12:00:00.000Z',
  updatedAt: '2026-08-01T12:00:00.000Z',
  ...over,
})

const allowance = (
  over: Partial<ApiPrintAllowance> = {},
): ApiPrintAllowance => ({
  limitGrams: 500,
  usedGrams: 0,
  remainingGrams: 500,
  term: {
    year: 2026,
    season: 'FALL',
    startsAt: '2026-08-24T04:00:00.000Z',
    endsAt: '2026-12-14T04:59:59.999Z',
    fromCalendar: true,
  },
  ...over,
})

/** The two reads the page makes on mount, so a stub only has to say what the
    test is about. */
const pageData = (over: Record<string, unknown> = {}) => ({
  '/me/print-requests': [],
  '/me/print-allowance': allowance(),
  ...over,
})

/** A file the browser would hand the form. Contents are never read here. */
const modelFile = (name: string) =>
  new File([new Uint8Array([1, 2, 3])], name, { type: 'application/octet-stream' })

const attach = (name: string) => {
  const input = screen.getByLabelText(/the model/i)
  fireEvent.change(input, { target: { files: [modelFile(name)] } })
}

// Submitted on the form itself: jsdom does not carry a click on a submit
// button through to the form's submit event, and `required` on the file input
// makes its own validation refuse one besides.
const send = () => {
  const button = screen.getByRole('button', { name: /send the request/i })
  fireEvent.submit(button.closest('form')!)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The multipart body the page sent, as plain fields. */
const sentFields = (fetchStub: ReturnType<typeof stubFetch>) => {
  // By method, not by path: `/me/print-requests` contains "print" too, and
  // matching on that finds the list GET instead of the upload.
  const upload = fetchStub.mock.calls.find((call) => call[1]?.method === 'POST')!
  const body = upload[1]?.body as FormData

  return Object.fromEntries(
    [...body.entries()].filter(([, value]) => typeof value === 'string'),
  ) as Record<string, string>
}

describe('PrintRequestPage', () => {
  it('lists what you have already asked for, each with where it has got to', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch(
        pageData({
          '/me/print-requests': [
            request(),
            request({ id: 'r2', fileName: 'gear.step', status: 'PRINTING' }),
          ],
        }),
      ),
    )

    render(<PrintRequestPage />)

    expect(await screen.findByText('bracket.stl')).toBeInTheDocument()
    expect(screen.getByText('gear.step')).toBeInTheDocument()
    expect(screen.getByText('WAITING')).toBeInTheDocument()
    expect(screen.getByText('PRINTING')).toBeInTheDocument()
  })

  it('says so when there is nothing yet rather than rendering an empty box', async () => {
    vi.stubGlobal('fetch', stubFetch(pageData()))

    render(<PrintRequestPage />)

    expect(await screen.findByText(/nothing yet/i)).toBeInTheDocument()
  })

  it('refuses a file the printers cannot take, without uploading it', async () => {
    const fetchStub = stubFetch(pageData())
    vi.stubGlobal('fetch', fetchStub)

    render(<PrintRequestPage />)
    await screen.findByText(/nothing yet/i)

    const before = fetchStub.mock.calls.length
    attach('homework.pdf')
    send()

    expect(await screen.findByText(/\.stl, \.step, \.stp/i)).toBeInTheDocument()
    // Nothing left the browser — that is the whole point of checking here.
    expect(fetchStub.mock.calls).toHaveLength(before)
  })

  it('uploads an accepted file as multipart, and says it landed', async () => {
    const fetchStub = stubFetch(pageData({ '/print': request() }))
    vi.stubGlobal('fetch', fetchStub)

    render(<PrintRequestPage />)
    await screen.findByText(/nothing yet/i)

    attach('bracket.stl')
    send()

    expect(await screen.findByText(/it's in your list below/i)).toBeInTheDocument()

    const upload = fetchStub.mock.calls.find((call) => call[1]?.method === 'POST')!
    expect(urlOf(upload[0])).toContain('/print')
    // FormData, not JSON — and crucially no Content-Type header, or the
    // multipart boundary the browser generates would be overwritten.
    expect(upload[1]?.body).toBeInstanceOf(FormData)
    expect(bodyOf(upload[1])).toBeUndefined()
    expect(upload[1]?.headers).toBeUndefined()

    // The settings ride along with it, defaulted to the everyday print —
    // 15% infill, one of it.
    expect(sentFields(fetchStub)).toMatchObject({
      process: 'FDM',
      material: 'PLA',
      infillPattern: 'GRID',
      infillDensity: '15',
      quantity: '1',
    })
  })

  /**
   * How many is a field rather than a line in the notes, because it is the one
   * thing in there an officer has to act on — four of something is sliced
   * differently from one.
   */
  it('sends how many, and shows the count back on the row', async () => {
    const fetchStub = stubFetch(
      pageData({
        '/print': request({ quantity: 4 }),
        '/me/print-requests': [request({ quantity: 4 })],
      }),
    )
    vi.stubGlobal('fetch', fetchStub)

    render(<PrintRequestPage />)
    await screen.findByText('bracket.stl')

    fireEvent.change(screen.getByLabelText(/how many/i), { target: { value: '4' } })
    attach('bracket.stl')
    send()

    await screen.findByText(/it's in your list below/i)
    expect(sentFields(fetchStub).quantity).toBe('4')
    expect(screen.getByText('×4')).toBeInTheDocument()
  })

  /** One of a thing is what almost every request is, so "×1" on every row
      would be noise on all of them to make the rare one legible. */
  it('does not label a request for a single item', async () => {
    vi.stubGlobal('fetch', stubFetch(pageData({ '/me/print-requests': [request()] })))

    render(<PrintRequestPage />)
    await screen.findByText('bracket.stl')

    expect(screen.queryByText('×1')).not.toBeInTheDocument()
  })

  it('offers special requests as prose, now the fields have taken the rest', async () => {
    vi.stubGlobal('fetch', stubFetch(pageData()))

    render(<PrintRequestPage />)
    await screen.findByText(/nothing yet/i)

    expect(screen.getByLabelText(/special requests/i)).toBeInTheDocument()
  })

  /**
   * The pairing rule as the member meets it. Resin has one material and no infill at all, so
   * choosing it has to take those controls away — and, more importantly, take the fields out of
   * the body, since the server refuses a resin request carrying infill.
   */
  it('drops the infill controls and fields when the resin printer is chosen', async () => {
    const fetchStub = stubFetch(pageData({ '/print': request() }))
    vi.stubGlobal('fetch', fetchStub)

    render(<PrintRequestPage />)
    await screen.findByText(/nothing yet/i)

    expect(screen.getByLabelText(/infill pattern/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: /resin/i }))

    expect(screen.queryByLabelText(/infill pattern/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/infill density/i)).not.toBeInTheDocument()

    attach('bracket.stl')
    send()
    await screen.findByText(/it's in your list below/i)

    const fields = sentFields(fetchStub)
    expect(fields).toMatchObject({ process: 'SLA', material: 'ABS_LIKE_RESIN' })
    expect(fields.infillPattern).toBeUndefined()
    expect(fields.infillDensity).toBeUndefined()
  })

  it('offers only the materials the chosen printer takes', async () => {
    vi.stubGlobal('fetch', stubFetch(pageData()))

    render(<PrintRequestPage />)
    await screen.findByText(/nothing yet/i)

    const material = () => screen.getByLabelText(/^material$/i)
    expect([...(material() as HTMLSelectElement).options].map((o) => o.value)).toEqual(
      ['PLA', 'PETG'],
    )

    fireEvent.click(screen.getByRole('radio', { name: /resin/i }))

    expect([...(material() as HTMLSelectElement).options].map((o) => o.value)).toEqual(
      ['ABS_LIKE_RESIN'],
    )
  })

  it('explains a rate limit differently from a rejection', async () => {
    vi.stubGlobal('fetch', stubFetchStatus(429, {}))

    render(<PrintRequestPage />)
    await waitFor(() => {
      expect(screen.getByText(/couldn't load your requests/i)).toBeInTheDocument()
    })

    attach('bracket.stl')
    send()

    expect(await screen.findByText(/a few requests in a row/i)).toBeInTheDocument()
  })

  it('passes the server’s own sentence through when it has one', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetchStatus(400, {
        error: "That doesn't look like a printable model.",
      }),
    )

    render(<PrintRequestPage />)
    attach('bracket.stl')
    send()

    expect(
      await screen.findByText(/doesn't look like a printable model/i),
    ).toBeInTheDocument()
  })

  it('names an unreachable API rather than blaming the file', async () => {
    vi.stubGlobal('fetch', stubFetchNetworkError())
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<PrintRequestPage />)
    attach('bracket.stl')
    send()

    expect(await screen.findByText(/couldn't reach the server/i)).toBeInTheDocument()
    consoleError.mockRestore()
  })

  /**
   * The storage rule as the member meets it: a finished job keeps its name and
   * size, and offers nothing to withdraw — there is no file left to withdraw.
   */
  it('keeps a settled request readable but offers no withdraw', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch(
        pageData({
          '/me/print-requests': [
            request({
              status: 'DONE',
              fileId: null,
              gramsUsed: 42,
              officerNote: 'On the shelf by the door.',
            }),
          ],
        }),
      ),
    )

    render(<PrintRequestPage />)

    expect(await screen.findByText('bracket.stl')).toBeInTheDocument()
    expect(screen.getByText('DONE')).toBeInTheDocument()
    expect(screen.getByText(/on the shelf by the door/i)).toBeInTheDocument()
    expect(screen.getByText(/42 g/)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /withdraw/i }),
    ).not.toBeInTheDocument()
  })

  it('offers withdraw only while a request is still waiting', async () => {
    vi.stubGlobal('fetch', stubFetch(pageData({ '/me/print-requests': [request()] })))

    render(<PrintRequestPage />)
    await screen.findByText('bracket.stl')

    expect(screen.getByRole('button', { name: /withdraw/i })).toBeInTheDocument()
  })

  /** "Why is this PETG when I asked for PLA" is a question worth answering
      before it is asked. */
  it('says so when what was printed differed from what was asked for', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch(
        pageData({
          '/me/print-requests': [
            request({
              status: 'DONE',
              fileId: null,
              gramsUsed: 42,
              printedMaterial: 'PETG',
            }),
          ],
        }),
      ),
    )

    render(<PrintRequestPage />)

    expect(await screen.findByText(/asked for .*PLA/i)).toBeInTheDocument()
  })
})

/**
 * The budget the club asked for: 500 g a term for your own prints, and nothing
 * counted against you for a project's.
 */
describe('the material allowance', () => {
  it('shows what is left, and says project prints do not count', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch(
        pageData({
          '/me/print-allowance': allowance({ usedGrams: 320, remainingGrams: 180 }),
        }),
      ),
    )

    render(<PrintRequestPage />)

    expect(await screen.findByText(/320 g of 500 g used/i)).toBeInTheDocument()
    // Exact: the "of 500 g used" line above contains other gram figures, and a
    // loose match would pass on the wrong one.
    expect(screen.getByText('180 g')).toBeInTheDocument()
    expect(screen.getByText(/do not come out of this/i)).toBeInTheDocument()
  })

  /**
   * An officer can knowingly print past somebody's allowance, so the balance
   * is allowed to go negative — and the page has to say that plainly rather
   * than rendering "-20 g left", which reads as a bug.
   */
  it('says how far over somebody is rather than printing a negative', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch(
        pageData({
          '/me/print-allowance': allowance({ usedGrams: 520, remainingGrams: -20 }),
        }),
      ),
    )

    render(<PrintRequestPage />)

    expect(await screen.findByText(/past your allowance/i)).toBeInTheDocument()
    // The overage as a positive number: "-20 g left" would read as a bug.
    expect(screen.getByText('20 g')).toBeInTheDocument()
  })

  it('names the inappropriate-print rule before anything is uploaded', async () => {
    vi.stubGlobal('fetch', stubFetch(pageData()))

    render(<PrintRequestPage />)

    expect(
      await screen.findByText(/officers decline anything against club/i),
    ).toBeInTheDocument()
  })
})

/**
 * The two gates in front of this page, and the context they read.
 *
 * Shared rather than scoped to one describe, because the page has two ways of being shut and
 * they're only meaningful next to each other: `hasAccess` false is a lapsed member, and
 * `role: 'GUEST'` is somebody who never joined.
 */
const term: ApiTerm = {
  year: 2035,
  season: 'FALL',
  startsAt: '2035-08-24T04:00:00.000Z',
  endsAt: '2035-12-14T04:59:59.999Z',
  fromCalendar: true,
}

const context = (
  hasAccess: boolean,
  projects: ApiMyProject[] = [],
  over: {
    role?: UserRole
    paidThrough?: string | null
    /** A free window is running and unclaimed — the third lock reason. */
    canActivate?: boolean
  } = {},
): DashboardContext => ({
  user: {
    id: 'u1',
    fullName: 'Rowan Test',
    email: null,
    slug: null,
    role: over.role ?? 'MEMBER',
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
      status: hasAccess ? 'ACTIVE' : over.canActivate ? 'FREE' : 'EXPIRED',
      hasAccess,
      duesRequired: !hasAccess && !over.canActivate,
      // Explicitly overridable, and `null` is the case that matters: it is
      // what says the site never promoted this person, which is how a
      // newcomer is told apart from a member the sweep demoted.
      paidThrough: over.paidThrough === undefined ? term.endsAt : over.paidThrough,
      freeThrough: null,
      term,
      billable: term,
      freeActive: false,
      canActivate: over.canActivate ?? false,
      // Not overridable, and there is nothing to override: the survey used to
      // be a fourth lock reason in front of these three, and it locks nothing
      // now. Every lock asserted below is the dues lock.
      surveyPending: false,
      surveyPromptDismissed: false,
    },
  },
  reloadMembership: () => Promise.resolve(),
})

const renderIn = (dashboard: DashboardContext) =>
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={dashboard} />}>
          <Route path="/" element={<PrintRequestPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

/**
 * The dues gate in front of the page.
 *
 * Printing is the club spending money on somebody, so a lapsed account gets the notice rather
 * than the form — and, because the gate is a wrapper, the page underneath never mounts and never
 * fires the requests the server would only refuse. That absence is the second assertion here.
 */
describe('when dues have lapsed', () => {
  it('shows the notice instead of the form, and asks the server nothing', async () => {
    const stub = stubFetch({})
    vi.stubGlobal('fetch', stub)

    renderIn(context(false))

    expect(await screen.findByText(/dues have lapsed/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /send it/i })).not.toBeInTheDocument()
    expect(stub).not.toHaveBeenCalled()
  })

  it('renders the form normally for somebody paid up', async () => {
    vi.stubGlobal('fetch', stubFetch(pageData()))

    renderIn(context(true))

    expect(await screen.findByText(/ask for a print/i)).toBeInTheDocument()
    expect(screen.queryByText(/dues have lapsed/i)).not.toBeInTheDocument()
  })

  /**
   * The project list comes from outlet context rather than a fetch of its own:
   * `DashboardLayout` has already loaded it for the rail, and asking twice
   * would be a second round trip for something already on the page.
   */
  it('builds the project picker from the projects already in context', async () => {
    const fetchStub = stubFetch(pageData({ '/print': request() }))
    vi.stubGlobal('fetch', fetchStub)

    const membership = {
      rank: 'MEMBER',
      role: null,
      team: null,
      project: { id: 'p1', slug: 'mars-rover', title: 'Mars Rover' },
    } as unknown as ApiMyProject

    renderIn(context(true, [membership]))
    await screen.findByText(/nothing yet/i)

    const picker = screen.getByLabelText(/what it is for/i) as HTMLSelectElement
    expect([...picker.options].map((option) => option.textContent)).toEqual([
      'Personal print',
      'Mars Rover',
    ])
    // Nothing was fetched for it — the two page reads are the only calls.
    expect(
      fetchStub.mock.calls.filter((call) => urlOf(call[0]).includes('/me/projects')),
    ).toHaveLength(0)

    fireEvent.change(picker, { target: { value: 'p1' } })
    attach('bracket.stl')
    send()
    await screen.findByText(/it's in your list below/i)

    expect(sentFields(fetchStub).projectId).toBe('p1')
  })
})

/**
 * The stricter of the two gates: the printers want a member, not merely somebody with an account.
 *
 * `hasAccess` is the whole of it now. These fixtures used to pass `hasAccess: true` alongside a
 * guest role, because the summer reported everybody covered and a second, stricter check refused
 * a guest anyway. Both are gone: access is the dues date, and the only question left is which of
 * the three sentences it gets.
 */
describe('when there is no cover', () => {
  it('offers membership instead of the form, and asks the server nothing', async () => {
    const stub = stubFetch({})
    vi.stubGlobal('fetch', stub)

    renderIn(context(false, [], { role: 'GUEST', paidThrough: null }))

    expect(await screen.findByText(/printers are for members/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/the model/i)).not.toBeInTheDocument()
    // The wrapper is what makes this true: nothing under it ever mounted.
    expect(stub).not.toHaveBeenCalled()
  })

  it('does not tell them their dues lapsed, because they never had any', async () => {
    vi.stubGlobal('fetch', stubFetch({}))

    renderIn(context(false, [], { role: 'GUEST', paidThrough: null }))

    await screen.findByText(/printers are for members/i)
    expect(screen.queryByText(/dues have lapsed/i)).not.toBeInTheDocument()
  })

  /**
   * The third sentence, and the one that did not exist before. Being shut out
   * while the club is charging nothing reads as a bug unless the page says the
   * fix is free — so this one must not mention money at all.
   */
  it('tells somebody in a free window to claim it, and quotes no price', async () => {
    const stub = stubFetch({})
    vi.stubGlobal('fetch', stub)

    renderIn(context(false, [], { paidThrough: null, canActivate: true }))

    expect(await screen.findByText(/one press away/i)).toBeInTheDocument()
    expect(screen.getByText(/free right now/i)).toBeInTheDocument()
    expect(screen.queryByText(/printers are for members/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/dues have lapsed/i)).not.toBeInTheDocument()
    expect(stub).not.toHaveBeenCalled()
  })

  /**
   * A lapsed member *is* a guest — the sweep demotes them — and being told they
   * have not joined, after two years in the club, would be both wrong and
   * unkind. `paidThrough` is what tells the two apart.
   */
  it('shows a demoted member the dues wording instead', async () => {
    vi.stubGlobal('fetch', stubFetch({}))

    // A date that has genuinely gone by, not the 2035 one the rest of this
    // file uses: "were they ever a member" is read against the wall clock, so
    // a future date would read as somebody who never joined.
    renderIn(
      context(false, [], {
        role: 'GUEST',
        paidThrough: '2024-01-15T00:00:00.000Z',
      }),
    )

    expect(await screen.findByText(/dues have lapsed/i)).toBeInTheDocument()
    expect(screen.queryByText(/for members/i)).not.toBeInTheDocument()
  })
})
