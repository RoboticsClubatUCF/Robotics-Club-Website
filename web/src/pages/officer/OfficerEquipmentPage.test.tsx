import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfficerEquipmentPage } from './OfficerEquipmentPage'
import type {
  ApiOfficerEquipment,
  ApiOfficerLoan,
  ApiTerm,
  UserRole,
} from '../../lib/api/api'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { dateInputValue, endOfDay } from '../../lib/equipment/borrowing'
import { bodyOf, stubFetch, urlOf } from '../../test/stubFetch'

/**
 * The lending desk: adding something, and moving a loan along.
 *
 * Two rules are worth a test each because both are about what an officer can do by accident.
 * Nothing may leave the lab without an approval, so a requested loan offers no way to hand it over.
 * And a partial edit — ticking "retire" — must not carry the rest of the form's defaults with it;
 * that one was a real bug, and it silently reset an item's quantity to one.
 *
 * The rest is the form itself. Every box has a label above it rather than a placeholder inside it,
 * which is what these are asserting when they ask for a field by its name.
 */

const term: ApiTerm = {
  year: 2026,
  season: 'FALL',
  startsAt: '2026-08-24T04:00:00.000Z',
  endsAt: '2026-12-14T04:59:59.999Z',
  fromCalendar: true,
}

const gear = (over: Partial<ApiOfficerEquipment> = {}): ApiOfficerEquipment => ({
  id: 'e1',
  name: 'Cordless drill',
  description: 'Battery and charger in the case.',
  quantity: 2,
  available: 2,
  maxLoanDays: 7,
  active: true,
  out: 0,
  loanCount: 0,
  ...over,
})

/** Six of them, so the five-at-a-time cut has something to hide. */
const shelf = () =>
  ['Anvil', 'Bandsaw', 'Calipers', 'Drill press', 'Extruder', 'File set'].map(
    (name, index) =>
      gear({ id: `e${index + 1}`, name, description: `${name} description` }),
  )

const loan = (over: Partial<ApiOfficerLoan> = {}): ApiOfficerLoan => ({
  id: 'l1',
  status: 'REQUESTED',
  note: 'For the chassis.',
  officerNote: null,
  dueAt: null,
  startAt: null,
  requestedDueAt: '2026-09-08T23:59:00.000Z',
  requestedAt: '2026-09-01T12:00:00.000Z',
  decidedAt: null,
  checkedOutAt: null,
  returnedAt: null,
  equipment: { id: 'e1', name: 'Cordless drill' },
  user: { fullName: 'Rowan Chen', email: null, discordUsername: null },
  decidedBy: null,
  ...over,
})

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
          <Route path="/" element={<OfficerEquipmentPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

/** The one write the page sent, whichever verb it used. */
const wrote = (stub: ReturnType<typeof stubFetch>) => {
  const call = stub.mock.calls.find(
    ([, init]) => init?.method === 'PATCH' || init?.method === 'POST',
  )
  return call ? { url: urlOf(call[0]), body: bodyOf(call[1]) } : null
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OfficerEquipmentPage', () => {
  it('will not offer to hand over something nobody has approved', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/officer/loans': [loan()], '/officer/equipment': [gear()] }),
    )

    renderPage()
    await screen.findByText('Rowan Chen', { exact: false })

    expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /hand over/i }),
    ).not.toBeInTheDocument()
  })

  it('offers the hand-over only once it is approved, and check-in after that', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/officer/loans': [loan({ status: 'APPROVED' })],
        '/officer/equipment': [gear()],
      }),
    )

    renderPage()

    expect(
      await screen.findByRole('button', { name: /hand over/i }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /check it in/i })).not.toBeInTheDocument()
  })

  /**
   * The date box starts on the member's own answer rather than empty, so an
   * officer approving in a hurry sends a deadline they have at least seen.
   */
  it("starts the due date on the member's own, and sends it on approval", async () => {
    const stub = stubFetch({
      '/officer/loans': [loan()],
      '/officer/equipment': [gear()],
    })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('Rowan Chen', { exact: false })

    const asked = dateInputValue('2026-09-08T23:59:00.000Z')
    expect(screen.getByLabelText(/due date for cordless drill/i)).toHaveValue(asked)

    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }))

    expect(wrote(stub)).toMatchObject({
      body: { status: 'APPROVED', dueAt: endOfDay(asked) },
    })
  })

  /**
   * The same trap the member's form has: a date box takes a year of four or
   * more digits, and turning `12345-08-14` into an instant throws a
   * `RangeError` — here, out of a click handler, where the queue would simply
   * stop responding with nothing in the console to explain it.
   */
  it('refuses a due date with an over-long year rather than throwing', async () => {
    const stub = stubFetch({
      '/officer/loans': [loan()],
      '/officer/equipment': [gear()],
    })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('Rowan Chen', { exact: false })

    fireEvent.change(screen.getByLabelText(/due date for cordless drill/i), {
      target: { value: '12345-08-14' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }))

    expect(screen.getByText(/isn't a date — check the year/i)).toBeInTheDocument()
    expect(wrote(stub)).toBeNull()
  })

  it('shows what the member actually asked for, booking included', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/officer/loans': [loan({ startAt: '2026-09-20T04:00:00.000Z' })],
        '/officer/equipment': [gear()],
      }),
    )

    renderPage()

    expect(await screen.findByText(/wants it/i)).toBeInTheDocument()
  })

  it('sends every labelled field when something is added', async () => {
    const stub = stubFetch({
      '/officer/loans': [],
      '/officer/equipment': [gear()],
    })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('Cordless drill')

    fireEvent.change(screen.getByLabelText(/what it is/i), {
      target: { value: 'Heat gun' },
    })
    fireEvent.change(screen.getByLabelText(/how many the club has/i), {
      target: { value: '3' },
    })
    fireEvent.change(screen.getByLabelText(/longest borrow, in days/i), {
      target: { value: '2' },
    })
    fireEvent.change(screen.getByLabelText(/anything worth knowing/i), {
      target: { value: 'Lives by the door.' },
    })
    fireEvent.submit(screen.getByRole('button', { name: /add to the list/i }).closest('form')!)

    expect(wrote(stub)).toMatchObject({
      body: {
        name: 'Heat gun',
        quantity: 3,
        maxLoanDays: 2,
        description: 'Lives by the door.',
      },
    })
  })

  it('defaults a new item to one unit for a week', async () => {
    const stub = stubFetch({ '/officer/loans': [], '/officer/equipment': [gear()] })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('Cordless drill')

    fireEvent.change(screen.getByLabelText(/what it is/i), {
      target: { value: 'Bench vice' },
    })
    fireEvent.submit(screen.getByRole('button', { name: /add to the list/i }).closest('form')!)

    expect(wrote(stub)).toMatchObject({
      body: { name: 'Bench vice', quantity: 1, maxLoanDays: 7 },
    })
  })

  /**
   * The bug this is here for: a patch that carried the create form's defaults
   * reset an item's quantity to one every time somebody retired it.
   */
  it('sends only what was changed when retiring an item', async () => {
    const stub = stubFetch({ '/officer/loans': [], '/officer/equipment': [gear()] })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('Cordless drill')

    fireEvent.click(screen.getByRole('button', { name: /^retire$/i }))

    expect(wrote(stub)?.body).toEqual({ active: false })
  })

  it('changes an item’s borrow cap from the list', async () => {
    const stub = stubFetch({ '/officer/loans': [], '/officer/equipment': [gear()] })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('Cordless drill')

    const days = screen.getByLabelText(/longest borrow of cordless drill/i)
    fireEvent.change(days, { target: { value: '30' } })
    fireEvent.blur(days)

    expect(wrote(stub)).toMatchObject({
      url: expect.stringContaining('/officer/equipment/e1'),
      body: { maxLoanDays: 30 },
    })
  })

  /**
   * The list opens cut and says so. A list that quietly stops at five looks
   * like the whole inventory — which is the misreading that has an officer
   * adding a second drill the club already owns.
   */
  it('shows five at a time until asked for the rest', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/officer/loans': [], '/officer/equipment': shelf() }),
    )

    renderPage()
    await screen.findByText('Anvil')

    expect(screen.getByText('Extruder')).toBeInTheDocument()
    expect(screen.queryByText('File set')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /show all — 1 more/i }))

    expect(screen.getByText('File set')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /show fewer/i }))
    expect(screen.queryByText('File set')).not.toBeInTheDocument()
  })

  it('searches the list so an officer can check before adding', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/officer/loans': [], '/officer/equipment': shelf() }),
    )

    renderPage()
    await screen.findByText('Anvil')

    fireEvent.change(screen.getByLabelText(/search the lending list/i), {
      target: { value: 'file' },
    })

    // Past the cut, and found anyway — which is the point of searching.
    expect(screen.getByText('File set')).toBeInTheDocument()
    expect(screen.queryByText('Anvil')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/search the lending list/i), {
      target: { value: 'submarine' },
    })
    expect(screen.getByText(/nothing on the list matches/i)).toBeInTheDocument()
  })

  /**
   * The server refuses a duplicate either way, but a 409 arrives after four
   * boxes have been filled in. What the officer nearly always wanted was to
   * change the number on the row that already exists.
   */
  it('warns about a name already on the list, whatever its capitals', async () => {
    const stub = stubFetch({
      '/officer/loans': [],
      '/officer/equipment': [gear({ quantity: 2 })],
    })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('Cordless drill')

    fireEvent.change(screen.getByLabelText(/what it is/i), {
      target: { value: 'CORDLESS DRILL' },
    })

    expect(screen.getByText(/already on the list, with 2 of them/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add to the list/i })).toBeDisabled()

    const before = stub.mock.calls.length
    fireEvent.submit(
      screen.getByRole('button', { name: /add to the list/i }).closest('form')!,
    )
    expect(stub.mock.calls).toHaveLength(before)

    // A name of its own, and the form comes back.
    fireEvent.change(screen.getByLabelText(/what it is/i), {
      target: { value: 'Impact driver' },
    })
    expect(screen.getByRole('button', { name: /add to the list/i })).toBeEnabled()
  })

  it('deletes only behind a warning that names what it destroys', async () => {
    const stub = stubFetch({
      '/officer/loans': [],
      '/officer/equipment': [gear({ loanCount: 14 })],
      '/officer/equipment/e1': { deleted: true },
    })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('Cordless drill')

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))

    const box = screen.getByRole('dialog')
    expect(within(box).getByText(/all 14 of its borrowing records/i)).toBeInTheDocument()
    expect(within(box).getByText(/retire it instead/i)).toBeInTheDocument()

    // Nothing has gone yet — opening the box is not the act.
    expect(
      stub.mock.calls.find(([, init]) => init?.method === 'DELETE'),
    ).toBeUndefined()

    fireEvent.click(within(box).getByRole('button', { name: /delete for good/i }))

    const sent = stub.mock.calls.find(([, init]) => init?.method === 'DELETE')
    expect(sent && urlOf(sent[0])).toContain('/officer/equipment/e1')
  })

  it('lets the warning be walked away from', async () => {
    const stub = stubFetch({
      '/officer/loans': [],
      '/officer/equipment': [gear()],
    })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('Cordless drill')

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /go back/i }),
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      stub.mock.calls.find(([, init]) => init?.method === 'DELETE'),
    ).toBeUndefined()
  })

  /** The same widening rule the print queue has, on the same reasoning. */
  it('searches the whole ledger from LIVE and only the section otherwise', async () => {
    const stub = stubFetch({
      '/officer/loans': [
        loan({
          id: 'l1',
          user: { fullName: 'Rowan Chen', email: null, discordUsername: 'rowan_c' },
        }),
        loan({
          id: 'l2',
          equipment: { id: 'e2', name: 'Heat gun' },
          user: { fullName: 'Sam Okafor', email: null, discordUsername: null },
        }),
      ],
      // Named apart from anything on a loan below: both lists are on this
      // page at once, and a query for "Cordless drill" would find the
      // inventory row as well as the queue row it is about.
      '/officer/equipment': [gear({ name: 'Anvil' })],
    })
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('Rowan Chen', { exact: false })

    const urls = () => stub.mock.calls.map((call) => urlOf(call[0]))
    const search = (value: string) => {
      fireEvent.change(screen.getByLabelText(/search the borrowing queue/i), {
        target: { value },
      })
    }

    search('okafor')
    await waitFor(() => {
      expect(urls().filter((u) => u.includes('/officer/loans')).at(-1)).toContain(
        'all=1',
      )
    })
    expect(screen.getByText('Heat gun')).toBeInTheDocument()
    expect(screen.queryByText('Cordless drill')).not.toBeInTheDocument()

    // Handle, surname-first, and the item's own name all reach it.
    search('rowan_c')
    expect(screen.getByText('Cordless drill')).toBeInTheDocument()
    search('chen rowan')
    expect(screen.getByText('Cordless drill')).toBeInTheDocument()
    search('heat')
    expect(screen.getByText('Heat gun')).toBeInTheDocument()

    search('')
    fireEvent.click(screen.getByRole('button', { name: /^out$/i }))
    await waitFor(() => {
      expect(urls().filter((u) => u.includes('/officer/loans')).at(-1)).toContain(
        'status=CHECKED_OUT',
      )
    })

    search('rowan')
    await waitFor(() => {
      expect(urls().filter((u) => u.includes('/officer/loans')).at(-1)).not.toContain(
        'all=1',
      )
    })
  })

  it('picks out what is overdue', async () => {
    const past = new Date(Date.now() - 3 * 86_400_000).toISOString()
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString()

    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/officer/loans': [
          loan({ id: 'l1', status: 'CHECKED_OUT', dueAt: past }),
          loan({
            id: 'l2',
            status: 'CHECKED_OUT',
            dueAt: soon,
            equipment: { id: 'e2', name: 'Heat gun' },
          }),
        ],
        '/officer/equipment': [gear({ name: 'Anvil' })],
      }),
    )

    renderPage()
    // The item names are what differ between these two rows — both are
    // borrowed by the fixture's default member.
    await screen.findByText('Cordless drill')

    fireEvent.click(screen.getByRole('button', { name: /^overdue$/i }))
    expect(screen.getByText('Cordless drill')).toBeInTheDocument()
    expect(screen.queryByText('Heat gun')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /due this week/i }))
    expect(screen.getByText('Heat gun')).toBeInTheDocument()
    expect(screen.queryByText('Cordless drill')).not.toBeInTheDocument()
  })

  it('narrows the inventory to what is retired', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/officer/loans': [],
        '/officer/equipment': [
          gear(),
          gear({ id: 'e2', name: 'Heat gun', active: false }),
        ],
      }),
    )

    renderPage()
    await screen.findByText('Cordless drill')

    fireEvent.click(screen.getByRole('button', { name: /^retired$/i }))

    expect(screen.getByText('Heat gun')).toBeInTheDocument()
    expect(screen.queryByText('Cordless drill')).not.toBeInTheDocument()
  })

  it('keeps the desk shut to anybody who is not an officer', () => {
    vi.stubGlobal('fetch', stubFetch({}))

    renderPage(context('MEMBER'))

    expect(screen.getByText(/belongs to the officers/i)).toBeInTheDocument()
  })
})
