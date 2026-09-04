import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfficerPrintQueuePage } from './OfficerPrintQueuePage'
import type {
  ApiPrintAllowance,
  ApiPrintQueueItem,
  ApiTerm,
  UserRole,
} from '../../lib/api/api'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { bodyOf, stubFetch, urlOf } from '../../test/stubFetch'

/**
 * The officer's half of the material budget, and the three ways a job ends.
 *
 * Four things have to be right, and all four are about not doing damage by
 * accident. The grams have to reach the server. Going past somebody's allowance
 * has to be a deliberate press with the numbers in view. A project print has to
 * show no balance at all — weighing one against a budget it does not come out
 * of is exactly the mistake a stray number would cause. And every irreversible
 * act has to be confirmed in a box that says what it is about to destroy.
 *
 * The fifth is the correction: officers print in whatever is on the shelf, so
 * the controls start on what was asked for and only send `printed` when the
 * officer actually changed something.
 */

const term: ApiTerm = {
  year: 2026,
  season: 'FALL',
  startsAt: '2026-08-24T04:00:00.000Z',
  endsAt: '2026-12-14T04:59:59.999Z',
  fromCalendar: true,
}

const allowance = (over: Partial<ApiPrintAllowance> = {}): ApiPrintAllowance => ({
  limitGrams: 500,
  usedGrams: 0,
  remainingGrams: 500,
  term,
  ...over,
})

const item = (over: Partial<ApiPrintQueueItem> = {}): ApiPrintQueueItem => ({
  id: 'r1',
  fileName: 'bracket.stl',
  fileSize: 2_400_000,
  quantity: 1,
  notes: null,
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
  createdAt: '2026-09-01T12:00:00.000Z',
  updatedAt: '2026-09-01T12:00:00.000Z',
  user: { fullName: 'Rowan Chen', email: null, discordUsername: null },
  decidedBy: null,
  allowance: allowance(),
  ...over,
})

/** A job already on a printer, which is what turns DECLINE into a cancel. */
const printing = (over: Partial<ApiPrintQueueItem> = {}) =>
  item({ status: 'PRINTING', startedAt: '2026-09-01T13:00:00.000Z', ...over })

const context = (role: UserRole = 'OFFICER'): DashboardContext => ({
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
  },
  reloadMembership: () => Promise.resolve(),
})

const renderPage = (dashboard = context()) =>
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={dashboard} />}>
          <Route path="/" element={<OfficerPrintQueuePage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

const typeGrams = (value: string) => {
  fireEvent.change(screen.getByLabelText(/grams used for bracket\.stl/i), {
    target: { value },
  })
}

/** Press a button in the row itself. Safe only before a dialog is open. */
const press = (name: RegExp) => {
  fireEvent.click(screen.getByRole('button', { name }))
}

const dialog = () => screen.getByRole('dialog')

/**
 * Agree to whatever the dialog is asking. Scoped to the dialog because its
 * confirm button deliberately repeats the row's wording — "MARK DONE" exists
 * twice on screen while it is open, and a page-wide query would find both.
 */
const agree = (name: RegExp) => {
  fireEvent.click(within(dialog()).getByRole('button', { name }))
}

/** The JSON of the one PATCH the page sent. */
const sent = (stub: ReturnType<typeof stubFetch>) =>
  bodyOf(stub.mock.calls.find((call) => call[1]?.method === 'PATCH')?.[1]) as
    | Record<string, unknown>
    | undefined

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Finding one request among a term's worth of them.
 *
 * The rule that needs a test is the widening: a search typed into LIVE has to
 * reach a print that was finished last month, and the only way it can is if
 * the page asks the server for every status. Inside a named section it must
 * *not* — widening there would quietly undo the filter just pressed.
 */
describe('searching the queue', () => {
  const people = [
    item({ id: 'r1', fileName: 'bracket.stl', user: { fullName: 'Rowan Chen', email: null, discordUsername: 'rowan_c' } }),
    item({ id: 'r2', fileName: 'gear.step', user: { fullName: 'Sam Okafor', email: null, discordUsername: 'okafor99' } }),
    item({
      id: 'r3',
      fileName: 'vat-lid.stl',
      process: 'SLA',
      material: 'ABS_LIKE_RESIN',
      infillPattern: null,
      infillDensity: null,
      project: { id: 'p1', slug: 'rover', title: 'Mars Rover' },
      allowance: null,
      user: { fullName: 'Alex Rowan', email: null, discordUsername: null },
    }),
  ]

  const search = (value: string) => {
    fireEvent.change(screen.getByLabelText(/search the print queue/i), {
      target: { value },
    })
  }

  const urls = (stub: ReturnType<typeof stubFetch>) =>
    stub.mock.calls.map((call) => urlOf(call[0]))

  it('finds a request by first name, surname, handle, file or project', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/print-queue': people }))

    renderPage()
    await screen.findByText('bracket.stl')

    search('okafor')
    expect(screen.getByText('gear.step')).toBeInTheDocument()
    expect(screen.queryByText('bracket.stl')).not.toBeInTheDocument()

    search('rowan_c')
    expect(screen.getByText('bracket.stl')).toBeInTheDocument()
    // The handle belongs to one of the two Rowans, and only that one.
    expect(screen.queryByText('vat-lid.stl')).not.toBeInTheDocument()

    search('mars rover')
    expect(screen.getByText('vat-lid.stl')).toBeInTheDocument()

    search('gear')
    expect(screen.getByText('gear.step')).toBeInTheDocument()

    search('chen rowan')
    expect(screen.getByText('bracket.stl')).toBeInTheDocument()
  })

  it('says so when nothing matches, rather than looking empty', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/print-queue': people }))

    renderPage()
    await screen.findByText('bracket.stl')

    search('submarine')

    expect(screen.getByText(/nothing matches/i)).toBeInTheDocument()
  })

  it('widens to every status when searching from LIVE', async () => {
    const stub = stubFetch({ '/officer/print-queue': people })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('bracket.stl')

    expect(urls(stub).at(-1)).not.toContain('all=1')
    expect(screen.getByText(/searches every request/i)).toBeInTheDocument()

    search('rowan')
    await waitFor(() => {
      expect(urls(stub).at(-1)).toContain('all=1')
    })

    // And back to the live set when the box is cleared.
    search('')
    await waitFor(() => {
      expect(urls(stub).at(-1)).not.toContain('all=1')
    })
  })

  it('stays inside a section when one is chosen', async () => {
    const stub = stubFetch({ '/officer/print-queue': people })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('bracket.stl')

    fireEvent.click(screen.getByRole('button', { name: /^done$/i }))
    await waitFor(() => {
      expect(urls(stub).at(-1)).toContain('status=DONE')
    })
    expect(screen.getByText(/searches done requests only/i)).toBeInTheDocument()

    search('rowan')

    // One more fetch would be a widening, which is exactly what must not
    // happen here — the section is the question.
    await waitFor(() => {
      expect(urls(stub).at(-1)).toContain('status=DONE')
    })
    expect(urls(stub).at(-1)).not.toContain('all=1')
  })

  it('narrows by machine and by whose budget it comes out of', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/print-queue': people }))

    renderPage()
    await screen.findByText('bracket.stl')

    fireEvent.click(screen.getByRole('button', { name: /^resin$/i }))
    expect(screen.getByText('vat-lid.stl')).toBeInTheDocument()
    expect(screen.queryByText('bracket.stl')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /any machine/i }))
    fireEvent.click(screen.getByRole('button', { name: /for a project/i }))
    expect(screen.getByText('vat-lid.stl')).toBeInTheDocument()
    expect(screen.queryByText('gear.step')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^personal$/i }))
    expect(screen.getByText('gear.step')).toBeInTheDocument()
    expect(screen.queryByText('vat-lid.stl')).not.toBeInTheDocument()
  })
})

describe('the print queue', () => {
  it('shows the settings, who it is for, and what they have left', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/officer/print-queue': [
          item({ allowance: allowance({ usedGrams: 320, remainingGrams: 180 }) }),
        ],
      }),
    )

    renderPage()

    expect(await screen.findByText('bracket.stl')).toBeInTheDocument()
    expect(screen.getByText(/FDM · PLA · 20% Grid/i)).toBeInTheDocument()
    expect(screen.getByText('Personal')).toBeInTheDocument()
    expect(screen.getByText(/180 g left of 500 g/i)).toBeInTheDocument()
  })

  /** Beside the filename, because it changes how the job is sliced and has to
      be seen before the file is opened. */
  it('puts the count next to the filename when there is more than one', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/officer/print-queue': [item({ quantity: 6 })] }),
    )

    renderPage()

    expect(await screen.findByText('×6')).toBeInTheDocument()
  })

  it('says nothing about the count for a single item', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/print-queue': [item()] }))

    renderPage()
    await screen.findByText('bracket.stl')

    expect(screen.queryByText('×1')).not.toBeInTheDocument()
  })

  /** Uncapped by the club's decision, so there is no balance to show. */
  it('shows no balance on a print for a project', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/officer/print-queue': [
          item({
            project: { id: 'p1', slug: 'mars-rover', title: 'Mars Rover' },
            allowance: null,
          }),
        ],
      }),
    )

    renderPage()

    expect(await screen.findByText('Mars Rover')).toBeInTheDocument()
    expect(screen.queryByText(/left of 500 g/i)).not.toBeInTheDocument()
  })

  it('sends the grams with the status', async () => {
    const stub = stubFetch({
      '/officer/print-queue': [item()],
      '/officer/print/r1': item({ status: 'DONE' }),
    })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('bracket.stl')

    typeGrams('42')
    press(/mark done/i)
    agree(/mark done/i)

    expect(sent(stub)).toMatchObject({ status: 'DONE', gramsUsed: 42 })
  })

  /**
   * Caught here rather than at the server's 400: the officer is standing at a
   * printer, and a round trip to be told to fill in a box is a round trip too
   * many. Nothing is even asked — the dialog does not open.
   */
  it('will not finish a personal print with no figure typed', async () => {
    const stub = stubFetch({ '/officer/print-queue': [item()] })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('bracket.stl')

    press(/mark done/i)

    expect(await screen.findByText(/say how much/i)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(sent(stub)).toBeUndefined()
  })

  it('leaves the printed settings off when nothing was changed', async () => {
    const stub = stubFetch({
      '/officer/print-queue': [item()],
      '/officer/print/r1': item({ status: 'DONE' }),
    })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('bracket.stl')

    typeGrams('42')
    press(/mark done/i)
    agree(/mark done/i)

    // Null in those columns is what says "printed as asked" — filling them in
    // on every job would lose the distinction.
    expect(sent(stub)).not.toHaveProperty('printed')
  })

  it('sends what was actually printed when the officer corrects it', async () => {
    const stub = stubFetch({
      '/officer/print-queue': [item()],
      '/officer/print/r1': item({ status: 'DONE' }),
    })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('bracket.stl')

    fireEvent.change(screen.getByLabelText(/material used for bracket\.stl/i), {
      target: { value: 'PETG' },
    })
    typeGrams('42')
    press(/mark done/i)
    agree(/mark done/i)

    expect(sent(stub)).toMatchObject({
      printed: { process: 'FDM', material: 'PETG' },
    })
  })

  /** Resin has no infill, so correcting a job to SLA has to take those fields
      out of the body — the server refuses a resin correction carrying them. */
  it('drops the infill fields when corrected to the resin printer', async () => {
    const stub = stubFetch({
      '/officer/print-queue': [item()],
      '/officer/print/r1': item({ status: 'DONE' }),
    })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('bracket.stl')

    fireEvent.change(screen.getByLabelText(/printer used for bracket\.stl/i), {
      target: { value: 'SLA' },
    })

    expect(screen.queryByLabelText(/infill pattern used/i)).not.toBeInTheDocument()

    typeGrams('42')
    press(/mark done/i)
    agree(/mark done/i)

    const printed = sent(stub)?.printed as Record<string, unknown>
    expect(printed).toMatchObject({ process: 'SLA', material: 'ABS_LIKE_RESIN' })
    expect(printed.infillPattern).toBeUndefined()
  })

  /** Putting a job on a printer is a step forward that can be walked back, so
      it is the one move that does not stop to ask. */
  it('starts a print without asking first', async () => {
    const stub = stubFetch({
      '/officer/print-queue': [item()],
      '/officer/print/r1': item({ status: 'PRINTING' }),
    })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('bracket.stl')

    press(/start printing/i)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(sent(stub)).toMatchObject({ status: 'PRINTING' })
  })
})

/**
 * Declining is refusing something nobody started. Cancelling is stopping
 * something already running, with a printer to go and clear. One status
 * underneath, two different acts — and the officer pressing the button is
 * looking at a machine in one case and not in the other.
 */
describe('declining versus cancelling', () => {
  it('offers DECLINE on a request nobody has started', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/print-queue': [item()] }))

    renderPage()
    await screen.findByText('bracket.stl')

    expect(screen.getByRole('button', { name: /^decline$/i })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /cancel the print/i }),
    ).not.toBeInTheDocument()
  })

  it('offers CANCEL THE PRINT once it is on a printer', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/print-queue': [printing()] }))

    renderPage()
    await screen.findByText('bracket.stl')

    expect(
      screen.getByRole('button', { name: /cancel the print/i }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^decline$/i })).not.toBeInTheDocument()
    // Nothing to start — it is already running.
    expect(screen.queryByRole('button', { name: /start printing/i })).not
      .toBeInTheDocument()
  })

  it('asks about stopping the machine, which declining has no reason to', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/print-queue': [printing()] }))

    renderPage()
    await screen.findByText('bracket.stl')

    press(/cancel the print/i)

    expect(within(dialog()).getByText(/stop the print of bracket\.stl/i)).toBeInTheDocument()
    expect(within(dialog()).getByText(/clear the bed/i)).toBeInTheDocument()
  })

  /** Nothing was printed, so there is nothing to charge — and the server
      refuses a decline that carries a figure. */
  it('leaves the grams off a decline even when one has been typed', async () => {
    const stub = stubFetch({
      '/officer/print-queue': [item()],
      '/officer/print/r1': item({ status: 'REJECTED' }),
    })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('bracket.stl')

    typeGrams('40')
    press(/^decline$/i)
    agree(/^decline$/i)

    expect(sent(stub)).not.toHaveProperty('gramsUsed')
    expect(sent(stub)).toMatchObject({ status: 'REJECTED' })
  })
})

/**
 * The box that stands between an officer and an irreversible act.
 *
 * Ours rather than the browser's, and this is what that buys: room for the
 * numbers a decision turns on, and a dismissing button that does not have to be
 * called "Cancel" next to a question about cancelling.
 */
describe('the confirmation', () => {
  it('names the file and says the model is about to go', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/print-queue': [item()] }))

    renderPage()
    await screen.findByText('bracket.stl')

    typeGrams('42')
    press(/mark done/i)

    expect(within(dialog()).getByText(/mark bracket\.stl as done/i)).toBeInTheDocument()
    expect(within(dialog()).getByText(/deletes the uploaded model/i)).toBeInTheDocument()
  })

  it('sends nothing while it is only open', async () => {
    const stub = stubFetch({ '/officer/print-queue': [item()] })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('bracket.stl')

    typeGrams('42')
    press(/mark done/i)

    expect(sent(stub)).toBeUndefined()
  })

  it('backs out without sending anything', async () => {
    const stub = stubFetch({ '/officer/print-queue': [item()] })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('bracket.stl')

    typeGrams('42')
    press(/mark done/i)
    agree(/go back/i)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(sent(stub)).toBeUndefined()
  })

  /** A box that can only be dismissed by aiming at a button is one people
      click through. */
  it('closes on Escape, still without sending', async () => {
    const stub = stubFetch({ '/officer/print-queue': [item()] })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('bracket.stl')

    typeGrams('42')
    press(/mark done/i)
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(sent(stub)).toBeUndefined()
  })

  /** Every use of this is destructive, so a stray Enter must do nothing. */
  it('opens with the focus on the way out, not on the way through', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/print-queue': [item()] }))

    renderPage()
    await screen.findByText('bracket.stl')

    typeGrams('42')
    press(/mark done/i)

    expect(within(dialog()).getByRole('button', { name: /go back/i })).toHaveFocus()
  })
})

describe('going past somebody’s allowance', () => {
  const nearlySpent = () =>
    item({ allowance: allowance({ usedGrams: 480, remainingGrams: 20 }) })

  it('warns in the row before the press', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/print-queue': [nearlySpent()] }))

    renderPage()
    await screen.findByText('bracket.stl')

    typeGrams('40')

    expect(await screen.findByText(/20 g past what rowan chen/i)).toBeInTheDocument()
  })

  /** Both numbers in the box, which is the thing `window.confirm` had nowhere
      to put. */
  it('puts the overage in the confirmation too, and sends the override', async () => {
    const stub = stubFetch({
      '/officer/print-queue': [nearlySpent()],
      '/officer/print/r1': item({ status: 'DONE' }),
    })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('bracket.stl')

    typeGrams('40')
    press(/mark done/i)

    expect(within(dialog()).getByText(/puts them 20 g over/i)).toBeInTheDocument()

    agree(/mark done/i)
    expect(sent(stub)).toMatchObject({ gramsUsed: 40, overAllowance: true })
  })

  it('sends nothing at all if the officer backs out', async () => {
    const stub = stubFetch({ '/officer/print-queue': [nearlySpent()] })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('bracket.stl')

    typeGrams('40')
    press(/mark done/i)
    agree(/go back/i)

    expect(sent(stub)).toBeUndefined()
  })

  it('never overrides a print that is within the allowance', async () => {
    const stub = stubFetch({
      '/officer/print-queue': [nearlySpent()],
      '/officer/print/r1': item({ status: 'DONE' }),
    })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('bracket.stl')

    typeGrams('10')
    press(/mark done/i)
    agree(/mark done/i)

    expect(sent(stub)).not.toHaveProperty('overAllowance')
  })
})

/**
 * What was *done*, not where the row ended up.
 *
 * The status is not the event: `REJECTED` is a request somebody declined or a
 * print somebody stopped, and only `startedAt` knows which. Reading "declined
 * the request" about a print you watched come off the bed half-finished is the
 * kind of small wrongness that makes people stop trusting a page.
 */
describe('who did what', () => {
  it.each([
    ['started the print', item({ status: 'PRINTING', startedAt: '2026-09-01T13:00:00.000Z' })],
    ['marked the print as done', item({ status: 'DONE', fileId: null, gramsUsed: 42 })],
    ['declined the request', item({ status: 'REJECTED', fileId: null })],
    [
      'cancelled the print',
      item({
        status: 'REJECTED',
        fileId: null,
        startedAt: '2026-09-01T13:00:00.000Z',
      }),
    ],
  ])('says the officer %s', async (phrase, row) => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/officer/print-queue': [{ ...row, decidedBy: { fullName: 'Sam Okafor' } }],
      }),
    )

    renderPage()

    expect(
      await screen.findByText(new RegExp(`sam okafor ${phrase}`, 'i')),
    ).toBeInTheDocument()
  })

  it('no longer says merely that somebody moved it', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/officer/print-queue': [
          printing({ decidedBy: { fullName: 'Sam Okafor' } }),
        ],
      }),
    )

    renderPage()
    await screen.findByText('bracket.stl')

    expect(screen.queryByText(/last moved by/i)).not.toBeInTheDocument()
  })

  it('keeps the grams on a settled row beside the action', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/officer/print-queue': [
          item({
            status: 'DONE',
            fileId: null,
            gramsUsed: 42,
            decidedBy: { fullName: 'Sam Okafor' },
          }),
        ],
      }),
    )

    renderPage()

    expect(await screen.findByText(/at 42 g/i)).toBeInTheDocument()
    expect(screen.getByText(/model was deleted with it/i)).toBeInTheDocument()
  })
})

describe('the gate', () => {
  it('turns away somebody who is not on the board', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/print-queue': [] }))

    renderPage(context('MEMBER'))

    expect(
      await screen.findByText(/this desk belongs to the officers/i),
    ).toBeInTheDocument()
  })
})
