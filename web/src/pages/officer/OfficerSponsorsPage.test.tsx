import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfficerSponsorsPage } from './OfficerSponsorsPage'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import type {
  ApiManagedSponsor,
  ApiMembership,
  ApiSponsorDesk,
  ApiTerm,
  UserRole,
} from '../../lib/api/api'
import { MAX_IN_KIND } from '../../lib/sponsorship'
import { bodyOf, urlOf } from '../../test/stubFetch'

/**
 * The desk behind `/sponsors`.
 *
 * What is worth pinning here is not the form plumbing:
 *
 * **That every tier gets a block, published or not.** The row an officer needs
 * in order to publish a level is exactly the one a filtered list would hide, and
 * a desk that only showed written tiers would make the club's first sponsorship
 * sheet impossible to write.
 *
 * **That hiding and deleting are different buttons with different weights.**
 * HIDE writes `active: false` and keeps the record of who backed the club;
 * ✕ asks first and is for a typo. A confirmation on both would teach officers to
 * click through it.
 *
 * **That the desk refuses a non-officer before it fetches anything**, and that a
 * lapsed officer is told about a payment rather than about permission — the
 * order every other desk uses.
 *
 * **That nothing published is drawn as a state rather than as an error.** An
 * officer who thinks an empty sheet is a broken page will not take a stale tier
 * down.
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

/**
 * The same officer, with the dues run out. Derived from `context` rather than
 * written out, so a field added to `ApiMembership` cannot leave this one a
 * partial object that only a cast makes compile.
 */
const lapsed = (): DashboardContext => {
  const base = context('OFFICER')
  const { data } = base.membership as { status: 'ready'; data: ApiMembership }

  return {
    ...base,
    membership: {
      status: 'ready',
      data: {
        ...data,
        status: 'EXPIRED',
        hasAccess: false,
        duesRequired: true,
        paidThrough: null,
      },
    },
  }
}

const sponsor = (over: Partial<ApiManagedSponsor> = {}): ApiManagedSponsor => ({
  id: 's1',
  name: 'Northgate Manufacturing',
  tier: 'PROCESSOR_PATRON',
  logoUrl: null,
  websiteUrl: 'https://example.com',
  blurb: 'Machining for every chassis.',
  active: true,
  createdAt: '2035-09-01T00:00:00.000Z',
  ...over,
})

/**
 * The four levels as the server sends them: **one entry per tier whether or not
 * anybody has written it**, which is the property half these cases lean on.
 */
const desk = (over: Partial<ApiSponsorDesk> = {}): ApiSponsorDesk => ({
  sponsors: [sponsor()],
  tiers: [
    {
      tier: 'PROCESSOR_PATRON',
      offer: {
        tier: 'PROCESSOR_PATRON',
        amount: '$2,500 a season',
        blurb: 'Underwrites a season.',
        benefits: ['Logo on the rover'],
      },
    },
    { tier: 'CIRCUIT_SUPPORTER', offer: null },
    { tier: 'BOLT_BACKER', offer: null },
    { tier: 'ALUMINUM_ALLY', offer: null },
  ],
  inKind: [],
  footnotes: null,
  ...over,
})

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

/**
 * One desk read, and every write answered with the row the server would have
 * sent back — so the stub branches on the method rather than the path, the way
 * the front-page desk's does.
 */
const stubApi = (data: ApiSponsorDesk = desk(), written: unknown = sponsor()) =>
  vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input)

    if (!url.includes('/officer/sponsors')) {
      return Promise.reject(new Error(`no stub for ${url}`))
    }

    if (init?.method !== undefined && init.method !== 'GET') return json(written)

    return json(data)
  })

const renderPage = (dashboard = context()) =>
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={dashboard} />}>
          <Route path="/" element={<OfficerSponsorsPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

const callsOf = (stub: ReturnType<typeof stubApi>, method: string) =>
  stub.mock.calls.filter(([, init]) => init?.method === method)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OfficerSponsorsPage', () => {
  it('lists the sponsors with their tier and their words', async () => {
    vi.stubGlobal('fetch', stubApi())

    renderPage()

    expect(
      await screen.findByLabelText('Name of Northgate Manufacturing'),
    ).toHaveValue('Northgate Manufacturing')
    expect(
      screen.getByLabelText('Tier for Northgate Manufacturing'),
    ).toHaveValue('PROCESSOR_PATRON')
    expect(
      screen.getByLabelText('Blurb for Northgate Manufacturing'),
    ).toHaveValue('Machining for every chassis.')
  })

  /**
   * The one that would be quietly wrong if the desk filtered: three of the four
   * levels here are unwritten, and those three are the whole reason an officer
   * opened this page.
   */
  it('draws a block for every tier, published or not', async () => {
    vi.stubGlobal('fetch', stubApi())

    renderPage()

    expect(
      await screen.findByRole('heading', { name: 'PROCESSOR PATRON' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'ALUMINUM ALLY' }),
    ).toBeInTheDocument()

    // And the button says which of the two it is about to do.
    expect(screen.getByRole('button', { name: 'SAVE' })).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: 'PUBLISH THIS TIER' }),
    ).toHaveLength(3)
    expect(screen.getByText('1 / 4 TIERS PUBLISHED')).toBeInTheDocument()
  })

  it('publishes a tier as one write, benefits and all', async () => {
    const stub = stubApi()
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByRole('heading', { name: 'BOLT BACKER' })

    // Each tier is a region named by its own heading, which is what makes
    // "the amount box for BOLT BACKER" reachable at all — there are four boxes
    // labelled WHAT IT COSTS on this page.
    const block = within(screen.getByRole('region', { name: 'BOLT BACKER' }))

    fireEvent.change(block.getByLabelText('WHAT IT COSTS'), {
      target: { value: '$500' },
    })
    fireEvent.change(block.getByLabelText('WHO THE TIER IS FOR (OPTIONAL)'), {
      target: { value: 'Local shops.' },
    })
    fireEvent.change(
      block.getByLabelText('WHAT THE CLUB GIVES BACK — ONE PER LINE'),
      { target: { value: 'Logo on the shirt\n\nNamed in the write-up\n' } },
    )
    fireEvent.click(
      block.getByRole('button', { name: 'PUBLISH THIS TIER' }),
    )

    await waitFor(() => {
      expect(callsOf(stub, 'PUT')).toHaveLength(1)
    })

    const [path, init] = callsOf(stub, 'PUT')[0]
    expect(urlOf(path)).toContain('/officer/sponsors/tiers/BOLT_BACKER')
    // Blank lines dropped rather than refused: pressing enter twice while
    // typing a list is not a mistake worth an error message.
    expect(bodyOf(init)).toEqual({
      amount: '$500',
      blurb: 'Local shops.',
      benefits: ['Logo on the shirt', 'Named in the write-up'],
    })
  })

  /** Hiding keeps the record; the ✕ is the one that asks. */
  it('hides a sponsor in one press and asks before deleting one', async () => {
    const stub = stubApi()
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByLabelText('Name of Northgate Manufacturing')

    fireEvent.click(screen.getByRole('button', { name: 'HIDE' }))

    await waitFor(() => {
      expect(callsOf(stub, 'PATCH')).toHaveLength(1)
    })
    expect(bodyOf(callsOf(stub, 'PATCH')[0][1])).toEqual({ active: false })

    fireEvent.click(
      screen.getByRole('button', { name: 'Delete Northgate Manufacturing' }),
    )

    expect(
      await screen.findByText('Delete Northgate Manufacturing?'),
    ).toBeInTheDocument()
    expect(callsOf(stub, 'DELETE')).toHaveLength(0)
  })

  it('adds a sponsor and opens the box for their logo', async () => {
    const stub = stubApi(
      desk({ sponsors: [] }),
      sponsor({ id: 's9', name: 'Lakeside Additive', logoUrl: null }),
    )
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByText('[ NOBODY LISTED YET ]')

    fireEvent.change(screen.getByLabelText('NAME'), {
      target: { value: 'Lakeside Additive' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add a sponsor' }))

    await waitFor(() => {
      expect(callsOf(stub, 'POST')).toHaveLength(1)
    })

    expect(bodyOf(callsOf(stub, 'POST')[0][1])).toEqual({
      name: 'Lakeside Additive',
      tier: 'ALUMINUM_ALLY',
      websiteUrl: null,
      blurb: null,
    })
    // The logo panel, open on the row that was just added — a company that has
    // just signed is a company whose logo is in somebody's downloads folder.
    expect(
      await screen.findByLabelText('LOGO FROM YOUR COMPUTER'),
    ).toBeInTheDocument()
  })

  /**
   * The club's sheet is an amount over a list of what you get. A blurb the desk
   * insisted on is a sentence somebody invents to get past a disabled button —
   * which is the failure this whole feature exists to end.
   */
  it('publishes a tier with the blurb left empty', async () => {
    const stub = stubApi()
    vi.stubGlobal('fetch', stub)

    renderPage()
    await screen.findByRole('heading', { name: 'BOLT BACKER' })

    const block = within(screen.getByRole('region', { name: 'BOLT BACKER' }))

    fireEvent.change(block.getByLabelText('WHAT IT COSTS'), {
      target: { value: 'Up to $1,000' },
    })
    fireEvent.click(block.getByRole('button', { name: 'PUBLISH THIS TIER' }))

    await waitFor(() => {
      expect(callsOf(stub, 'PUT')).toHaveLength(1)
    })

    expect(bodyOf(callsOf(stub, 'PUT')[0][1])).toEqual({
      amount: 'Up to $1,000',
      blurb: null,
      benefits: [],
    })
  })

  it('writes the fine print under the grid', async () => {
    const stub = stubApi(desk({ footnotes: '* old' }))
    vi.stubGlobal('fetch', stub)

    renderPage()

    const box = await screen.findByLabelText('PRINTED UNDER THE TIERS')
    expect(box).toHaveValue('* old')

    fireEvent.change(box, { target: { value: '* new\n\nNOTE: tax-deductible.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save the fine print' }))

    await waitFor(() => {
      expect(callsOf(stub, 'PUT')).toHaveLength(1)
    })

    const [path, init] = callsOf(stub, 'PUT')[0]
    expect(urlOf(path)).toContain('/officer/sponsors/sheet')
    expect(bodyOf(init)).toEqual({ footnotes: '* new\n\nNOTE: tax-deductible.' })
  })

  it('counts the ways to help against the cap', async () => {
    vi.stubGlobal(
      'fetch',
      stubApi(
        desk({
          inKind: [{ id: 'k1', title: 'Machine time', blurb: 'An afternoon.' }],
        }),
      ),
    )

    renderPage()

    expect(await screen.findByLabelText('Title of way 1')).toHaveValue(
      'Machine time',
    )
    expect(screen.getByText(`1 / ${MAX_IN_KIND}`)).toBeInTheDocument()
  })

  it('refuses a member without asking the server anything', async () => {
    const stub = stubApi()
    vi.stubGlobal('fetch', stub)

    renderPage(context('MEMBER'))

    expect(
      screen.getByText('This desk belongs to the officers.'),
    ).toBeInTheDocument()
    expect(stub).not.toHaveBeenCalled()
  })

  /** Dues before role: a lapsed officer is still an officer. */
  it('sends a lapsed officer to the dues page rather than refusing them', async () => {
    const stub = stubApi()
    vi.stubGlobal('fetch', stub)
    renderPage(lapsed())

    expect(screen.getByText('Your dues have lapsed.')).toBeInTheDocument()
    // Not the other sentence, which would be the wrong answer to the right
    // refusal — a lapsed officer is still an officer.
    expect(
      screen.queryByText('This desk belongs to the officers.'),
    ).not.toBeInTheDocument()
    expect(stub).not.toHaveBeenCalled()
  })

  it('says so when the desk cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderPage()

    expect(
      await screen.findByText("We couldn't reach the server."),
    ).toBeInTheDocument()
    consoleError.mockRestore()
  })
})
