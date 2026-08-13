import { fireEvent, render as renderBare, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DuesPage } from './DuesPage'
import { SessionProvider } from '../lib/auth'
import type { ApiDuesStatus, ApiTerm } from '../lib/api'
import { bodyOf, urlOf } from '../test/stubFetch'

/**
 * The dues page.
 *
 * What this suite is really for is one club rule that is easy to lose: **the
 * option to pay is offered in every state**, including the two where nothing is
 * owed. Somebody on the free trial, or reading this in the middle of a free
 * summer, has to be able to settle the term ahead now rather than being told to
 * come back later — and the states where that is most tempting to hide are
 * exactly the ones where the page has good news to deliver.
 *
 * `lib/stripe` is stubbed rather than a publishable key being put in the test
 * environment. Without it `stripeKeyConfigured` is false and the page correctly
 * renders "card payments are not switched on", which would mean none of the
 * assertions below could see a plan at all.
 */
vi.mock('../lib/stripe', () => ({
  // Never reached: nothing here gets as far as opening a payment form, which
  // would need Stripe's iframe and a real client secret.
  stripePromise: null,
  stripeKeyConfigured: true,
}))

const fall: ApiTerm = {
  year: 2026,
  season: 'FALL',
  startsAt: '2026-08-24T04:00:00.000Z',
  endsAt: '2026-12-14T04:59:59.999Z',
  fromCalendar: true,
}

const spring: ApiTerm = {
  year: 2027,
  season: 'SPRING',
  startsAt: '2027-01-11T05:00:00.000Z',
  endsAt: '2027-05-06T03:59:59.999Z',
  fromCalendar: true,
}

const summer: ApiTerm = {
  year: 2026,
  season: 'SUMMER',
  startsAt: '2026-05-18T04:00:00.000Z',
  endsAt: '2026-08-08T03:59:59.999Z',
  fromCalendar: true,
}

function duesStatus(over: Partial<ApiDuesStatus> = {}): ApiDuesStatus {
  return {
    membership: {
      status: 'EXPIRED',
      hasAccess: false,
      duesRequired: true,
      paidThrough: null,
      freeThrough: null,
      term: fall,
      billable: fall,
      freeActive: false,
      canActivate: false,
    },
    plans: [
      {
        plan: 'SEMESTER',
        amountCents: 2_500,
        covers: [fall],
        through: fall.endsAt,
      },
      {
        plan: 'YEAR',
        amountCents: 5_000,
        covers: [fall, spring],
        through: spring.endsAt,
      },
    ],
    paymentsEnabled: true,
    history: [],
    ...over,
  }
}

function stubApi(status: ApiDuesStatus, sync?: unknown) {
  // `_init` is declared even though it is ignored: without it `mock.calls`
  // types as a one-element tuple and the assertion on what was posted to
  // `/dues/sync` could only reach the body through a cast. Same reason every
  // stub in `test/stubFetch.ts` declares it.
  const stub = vi.fn((input: string | URL | Request, _init?: RequestInit) => {
    const url = urlOf(input)

    const body = url.includes('/auth/me')
      ? { user: { id: 'u1', fullName: 'Knightro', email: 'k@ucf.edu' } }
      : url.includes('/dues/sync')
        ? (sync ?? {
            status: 'SUCCEEDED',
            paidThrough: spring.endsAt,
            receiptUrl: 'https://pay.stripe.com/receipts/test',
          })
        : status

    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  vi.stubGlobal('fetch', stub)
  return stub
}

const render = (at = '/dues') =>
  renderBare(<DuesPage />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[at]}>
        <SessionProvider>{children}</SessionProvider>
      </MemoryRouter>
    ),
  })

const syncCalls = (stub: ReturnType<typeof stubApi>) =>
  stub.mock.calls.filter(([input]) => urlOf(input).includes('/dues/sync'))

const meCalls = (stub: ReturnType<typeof stubApi>) =>
  stub.mock.calls.filter(([input]) => urlOf(input).includes('/auth/me'))

const json = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DuesPage', () => {
  it('prices the plans from the server rather than from the page', async () => {
    stubApi(duesStatus())
    render()

    // Both the card and the button carry the price, so these are the amounts
    // the server sent and not a number written into the markup.
    expect(await screen.findByText('$25')).toBeInTheDocument()
    expect(screen.getByText('$50')).toBeInTheDocument()
  })

  /** "$50 gives you access to fall and spring", and the card has to say which. */
  it('says which terms each plan covers', async () => {
    stubApi(duesStatus())
    render()

    expect(await screen.findByText(/Fall 2026 and Spring 2027/)).toBeInTheDocument()
  })

  /**
   * The requirement this file exists for, in the state where it is easiest to
   * get wrong: nothing is owed, so there is nothing forcing the page to show a
   * way to pay — and it has to anyway.
   */
  it('still offers both plans to somebody on the free trial', async () => {
    stubApi(
      duesStatus({
        membership: {
          status: 'TRIAL',
          hasAccess: true,
          duesRequired: false,
          paidThrough: null,
          freeThrough: '2026-09-07T04:00:00.000Z',
          term: fall,
          billable: fall,
          freeActive: false,
          canActivate: false,
        },
      }),
    )
    render()

    expect(await screen.findByText(/pay now and have it done with/i)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /one semester/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /academic year/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled()
  })

  /**
   * The one state where "you can pay" needs qualifying.
   *
   * The server has always quoted a paid-up member the *next* uncovered term —
   * `coverageFor` walks past `duesPaidThrough` — but the page said nothing about
   * it, and the reading that invites is that the club is charging twice for the
   * semester you are sitting in. Somebody who believes that either doesn't pay
   * or pays and then asks an officer where the money went.
   */
  it('tells a paid-up member they are buying a term ahead', async () => {
    const fall2027: ApiTerm = {
      year: 2027,
      season: 'FALL',
      startsAt: '2027-08-23T04:00:00.000Z',
      endsAt: '2027-12-13T04:59:59.999Z',
      fromCalendar: true,
    }

    stubApi(
      duesStatus({
        membership: {
          status: 'ACTIVE',
          hasAccess: true,
          duesRequired: false,
          paidThrough: spring.endsAt,
          freeThrough: null,
          term: fall,
          billable: fall,
          freeActive: false,
          canActivate: false,
        },
        // What the server actually returns to somebody covered through spring:
        // the plans start at the term *after* what they already hold.
        plans: [
          {
            plan: 'SEMESTER',
            amountCents: 2_500,
            covers: [fall2027],
            through: fall2027.endsAt,
          },
          {
            plan: 'YEAR',
            amountCents: 5_000,
            covers: [fall2027],
            through: fall2027.endsAt,
          },
        ],
      }),
    )
    render()

    const note = await screen.findByText(/nothing here pays for the semester/i)
    // Both halves: what they already have, and where the money would start.
    expect(note).toHaveTextContent('May 5, 2027')
    expect(note).toHaveTextContent('Fall 2027')
    expect(screen.getByText(/pay ahead for the next term/i)).toBeInTheDocument()
  })

  /** And not said to anybody who is not paid — there it would just be wrong. */
  it('says nothing of the sort to somebody who owes for this term', async () => {
    stubApi(duesStatus())
    render()

    expect(await screen.findByText(/pay your dues/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/nothing here pays for the semester/i),
    ).not.toBeInTheDocument()
  })

  /**
   * The free summer, and the button that claims it.
   *
   * Summer used to be free *silently* — the calendar covered everybody,
   * including every account that has not been near the club in three years.
   * Claiming makes "active over the summer" something a person did, and it
   * spares the backend flipping the whole roster twice a year. What this suite
   * pins is that the section is offered only when there is something to claim,
   * that it is plainly not a payment, and that it re-reads afterwards.
   */
  describe('the free summer', () => {
    const freeSummer = (over: Partial<ApiDuesStatus['membership']> = {}) =>
      duesStatus({
        membership: {
          status: 'FREE',
          hasAccess: true,
          duesRequired: false,
          paidThrough: null,
          freeThrough: '2026-09-07T04:00:00.000Z',
          term: summer,
          billable: fall,
          freeActive: false,
          canActivate: true,
          ...over,
        },
      })

    it('offers to switch the membership on, for nothing', async () => {
      stubApi(freeSummer())
      render()

      // On "switch it on" rather than "summer is free" — the membership panel
      // above says the latter too, and a matcher that hits both is a matcher
      // that proves neither.
      expect(await screen.findByText(/summer is free . switch it on/i)).toBeInTheDocument()
      expect(screen.getByText('SUMMER MEMBERSHIP')).toBeInTheDocument()
      // It sits on a page of prices, so it has to say what it does not do.
      expect(screen.getByText(/no charge and no card/i)).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /activate my membership/i }),
      ).toBeEnabled()
    })

    it('claims it and re-reads where that leaves them', async () => {
      const stub = stubApi(freeSummer())
      render()

      fireEvent.click(
        await screen.findByRole('button', { name: /activate my membership/i }),
      )

      await vi.waitFor(() => {
        const posts = stub.mock.calls.filter(
          ([input, init]) =>
            urlOf(input).includes('/dues/activate') && init?.method === 'POST',
        )
        expect(posts).toHaveLength(1)
      })

      // The page owns one source of truth for its own state, so it asks again
      // rather than patching the membership out of the response.
      await vi.waitFor(() => {
        const status = stub.mock.calls.filter(([input]) =>
          urlOf(input).includes('/dues/status'),
        )
        expect(status.length).toBeGreaterThan(1)
      })
    })

    /**
     * The bug this exists to keep dead.
     *
     * `ACTIVE` used to mean exactly "paid through a date in the future", and
     * the paying-ahead note read `paidThrough` on the strength of it. Claiming
     * a free window broke that assumption: it makes somebody active while their
     * *old* `paidThrough` sits in the past. A member who lapsed in December and
     * claimed the summer was told "you are already paid through December 10,
     * 2025" — their own lapsed date read back to them as current cover.
     */
    it('never reads a lapsed date back as cover to a claimed free member', async () => {
      stubApi(
        freeSummer({
          status: 'ACTIVE',
          freeActive: true,
          canActivate: false,
          // Paid for last fall, lapsed, and now active on the claim instead.
          paidThrough: '2025-12-10T04:59:59.999Z',
        }),
      )
      render()

      await screen.findByText(/your membership is active/i)

      expect(screen.queryByText(/already paid through/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/December 10, 2025/)).not.toBeInTheDocument()
      expect(screen.queryByText(/your dues are paid/i)).not.toBeInTheDocument()
    })

    /**
     * And the note still fires for the state it was written for — somebody
     * covered by a payment that has not run out.
     */
    it('still tells a genuinely paid member they are buying ahead', async () => {
      stubApi(
        duesStatus({
          membership: {
            status: 'ACTIVE',
            hasAccess: true,
            duesRequired: false,
            paidThrough: spring.endsAt,
            freeThrough: null,
            term: fall,
            billable: fall,
            freeActive: false,
            canActivate: false,
          },
        }),
      )
      render()

      expect(await screen.findByText(/already paid through/i)).toBeInTheDocument()
    })

    /** Claimed already: nothing left to press, and it must not say "paid". */
    it('says the membership is active without claiming a payment', async () => {
      stubApi(
        freeSummer({ status: 'ACTIVE', freeActive: true, canActivate: false }),
      )
      render()

      expect(await screen.findByText(/your membership is active/i)).toBeInTheDocument()
      expect(screen.getByText('ACTIVE')).toBeInTheDocument()
      expect(screen.queryByText(/your dues are paid/i)).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /activate my membership/i }),
      ).not.toBeInTheDocument()
    })

    /** Mid-term there is no window to claim, so the section stays away. */
    it('is not offered when dues are actually owed', async () => {
      stubApi(duesStatus())
      render()

      await screen.findByText('$25')
      expect(
        screen.queryByRole('button', { name: /activate my membership/i }),
      ).not.toBeInTheDocument()
    })

    /** The plans stay on the page throughout — the club rule this file is for. */
    it('still offers both plans while the summer is free', async () => {
      stubApi(freeSummer())
      render()

      expect(await screen.findByRole('button', { name: /continue/i })).toBeEnabled()
      expect(screen.getByRole('radio', { name: /academic year/i })).toBeInTheDocument()
    })
  })

  /** The same, in the middle of a free summer. */
  it('still offers both plans over the free summer', async () => {
    stubApi(
      duesStatus({
        membership: {
          status: 'FREE',
          hasAccess: true,
          duesRequired: false,
          paidThrough: null,
          freeThrough: '2026-09-07T04:00:00.000Z',
          term: summer,
          billable: fall,
          freeActive: false,
          canActivate: false,
        },
      }),
    )
    render()

    expect(await screen.findByRole('button', { name: /continue/i })).toBeEnabled()
    expect(screen.getByRole('radio', { name: /academic year/i })).toBeInTheDocument()
  })

  /**
   * Unconfigured Stripe is a supported state, not a broken one. Dues were
   * collected in person for the whole life of the previous site, and a member
   * trying a dead button three times before giving up is worse than being told.
   */
  it('says so rather than showing a dead button when payments are off', async () => {
    stubApi(duesStatus({ paymentsEnabled: false }))
    render()

    expect(
      await screen.findByText(/card payments aren't switched on yet/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  /**
   * Coming back from the bank.
   *
   * A card the bank wants to authenticate takes the member off this site
   * entirely and returns them to `/dues?payment_intent=…` in a *fresh page
   * load* — none of the state that was here before survives it. The query
   * string is the only thing left to go on, and everything below is about
   * handling it exactly once.
   *
   * This is as far as the payment can be followed without a real browser: the
   * hop out to the bank and Stripe's own iframe need one. The server half of
   * the same path is covered in `server/src/routes/dues.test.ts`.
   */
  describe('landing back from a redirect', () => {
    const RETURNED =
      '/dues?payment_intent=pi_returned&payment_intent_client_secret=pi_returned_secret&redirect_status=succeeded'

    it('asks the server what became of the payment named in the URL', async () => {
      const stub = stubApi(duesStatus())
      render(RETURNED)

      expect(await screen.findByText(/you're all set/i)).toBeInTheDocument()

      const [, init] = syncCalls(stub)[0]!
      expect(bodyOf(init)).toEqual({ paymentIntentId: 'pi_returned' })
    })

    /**
     * The effect clears the query string it just read, which re-runs it, and
     * StrictMode double-invokes besides. Confirming twice is not merely
     * wasteful — it is the page telling the server about a payment it has
     * already been told about, which is the exact shape of a double-credit bug.
     */
    it('confirms it once, not once per render', async () => {
      const stub = stubApi(duesStatus())
      render(RETURNED)

      await screen.findByText(/you're all set/i)

      expect(syncCalls(stub)).toHaveLength(1)
    })

    it('shows what the membership now runs to', async () => {
      stubApi(duesStatus())
      render(RETURNED)

      expect(await screen.findByText(/May 5, 2027/)).toBeInTheDocument()
    })

    /**
     * This screen used to claim Stripe had emailed a receipt. It hadn't:
     * Stripe sends one automatically in live mode only, and only when the
     * account has "Successful payments" switched on — never for a test payment.
     * The hosted receipt it *does* create for every successful charge is the
     * thing to link to, and the page must not go back to promising an inbox.
     */
    it('links the receipt rather than claiming one was emailed', async () => {
      stubApi(duesStatus())
      render(RETURNED)

      const receipt = await screen.findByRole('link', { name: /here/i })
      expect(receipt).toHaveAttribute(
        'href',
        'https://pay.stripe.com/receipts/test',
      )
      expect(screen.queryByText(/emailed/i)).not.toBeInTheDocument()
    })

    /** No receipt to link is not a reason to invent one. */
    it('says nothing about a receipt it does not have', async () => {
      stubApi(duesStatus(), {
        status: 'SUCCEEDED',
        paidThrough: spring.endsAt,
        receiptUrl: null,
      })
      render(RETURNED)

      expect(await screen.findByText(/you're all set/i)).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /here/i })).not.toBeInTheDocument()
      expect(screen.queryByText(/emailed/i)).not.toBeInTheDocument()
    })

    /**
     * `redirect_status=succeeded` in the URL is the *browser's* account of what
     * happened, and the browser is not a source of truth about money. Only the
     * server's answer is shown.
     */
    it('believes the server over the query string', async () => {
      stubApi(duesStatus(), { status: 'FAILED', paidThrough: null })
      render(RETURNED)

      expect(await screen.findByText(/did not go through/i)).toBeInTheDocument()
      expect(screen.queryByText(/you're all set/i)).not.toBeInTheDocument()
    })

    /** Some methods clear in minutes. Saying either "paid" or "failed" would be a guess. */
    it('says a still-clearing payment is still clearing', async () => {
      stubApi(duesStatus(), { status: 'PENDING', paidThrough: null })
      render(RETURNED)

      expect(await screen.findByText(/still going through/i)).toBeInTheDocument()
    })

    /**
     * A first payment is not only a date — it takes the account off GUEST and
     * onto the roster ladder. The session context is the single copy of that
     * the nav and the dashboard sidebar read, and it was fetched before any of
     * this happened, so the page has to ask again. Without this the member
     * pays, lands on the dashboard, and is still shown a guest's view of it
     * until they reload by hand.
     */
    it('re-reads who is signed in, because paying changes it', async () => {
      const stub = stubApi(duesStatus())
      render(RETURNED)

      await screen.findByText(/you're all set/i)

      // Once on mount, once after the payment was confirmed.
      expect(meCalls(stub)).toHaveLength(2)
    })

    /** And it does not, on a payment that did not happen. */
    it('does not re-read the session when the payment failed', async () => {
      const stub = stubApi(duesStatus(), { status: 'FAILED', paidThrough: null })
      render(RETURNED)

      await screen.findByText(/did not go through/i)

      expect(meCalls(stub)).toHaveLength(1)
    })

    /**
     * The re-read is housekeeping and the payment is not.
     *
     * Somebody who has just been charged must not be shown "we can't reach the
     * server" because the *follow-up* request failed — which is exactly what
     * happens if the confirmation screen sits behind the page's error gate
     * rather than in front of it.
     */
    it('keeps the confirmation when the re-read then fails', async () => {
      const status = duesStatus()
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      let seenMe = 0

      vi.stubGlobal(
        'fetch',
        vi.fn((input: string | URL | Request, _init?: RequestInit) => {
          const url = urlOf(input)

          if (url.includes('/auth/me')) {
            // The first answers. The second — the one made after the payment
            // was confirmed — does not.
            return seenMe++ === 0
              ? json({ user: { id: 'u1', fullName: 'Knightro', email: 'k@ucf.edu' } })
              : Promise.reject(new TypeError('Failed to fetch'))
          }

          return json(
            url.includes('/dues/sync')
              ? {
                  status: 'SUCCEEDED',
                  paidThrough: spring.endsAt,
                  receiptUrl: null,
                }
              : status,
          )
        }),
      )

      render(RETURNED)

      expect(await screen.findByText(/you're all set/i)).toBeInTheDocument()
      expect(screen.queryByText(/can't reach the server/i)).not.toBeInTheDocument()
      consoleError.mockRestore()
    })

    it('does not confirm anything when there is no payment in the URL', async () => {
      const stub = stubApi(duesStatus())
      render()

      await screen.findByText('$25')

      expect(syncCalls(stub)).toHaveLength(0)
    })
  })

  it('lists what has already been paid', async () => {
    stubApi(
      duesStatus({
        history: [
          {
            id: 'p1',
            plan: 'YEAR',
            amountCents: 5_000,
            termYear: 2026,
            termSeason: 'FALL',
            coversThrough: spring.endsAt,
            paidAt: '2026-08-30T15:00:00.000Z',
            receiptUrl: 'https://pay.stripe.com/receipts/test',
          },
        ],
      }),
    )
    render()

    expect(await screen.findByText(/what you have paid/i)).toBeInTheDocument()
    expect(screen.getByText(/academic year/)).toBeInTheDocument()
    // Reachable again later, not only on the screen that appeared once.
    expect(screen.getByRole('link', { name: 'RECEIPT' })).toHaveAttribute(
      'href',
      'https://pay.stripe.com/receipts/test',
    )
  })
})
