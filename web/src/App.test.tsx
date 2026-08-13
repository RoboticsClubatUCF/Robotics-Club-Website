import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { ApiTerm, ApiUser } from './lib/api'
import { bodyOf, urlOf } from './test/stubFetch'

/**
 * The whole app, assembled, at one URL each time.
 *
 * Every other suite renders a component with its parents stubbed out, which is
 * the right default and cannot see the two things this one is for: that the
 * dashboard shell and a page inside it compose without either drawing the
 * other's chrome, and that `/dues` still reaches the dues page now that the
 * dues page has moved.
 *
 * That second one carries money. `/dues` was the Stripe `return_url` for every
 * payment started before the move, and a bank returns a member to
 * `/dues?payment_intent=…` — that parameter being dropped somewhere along the
 * redirect would leave somebody who has just been charged looking at a page
 * telling them they still owe $25.
 */

vi.mock('./lib/stripe', () => ({
  // Never reached: nothing here opens a payment form, which would want Stripe's
  // iframe and a real client secret.
  stripePromise: null,
  stripeKeyConfigured: true,
}))

const term: ApiTerm = {
  year: 2026,
  season: 'FALL',
  startsAt: '2026-08-24T04:00:00.000Z',
  endsAt: '2026-12-14T04:59:59.999Z',
  fromCalendar: true,
}

/** An officer, so the rail draws every group it has. */
const user: ApiUser = {
  id: 'u1',
  fullName: 'Rowan Quill Test',
  email: 'rowan@ucf.edu',
  slug: null,
  role: 'OFFICER',
  discordUsername: null,
}

function stubApi() {
  const stub = vi.fn((input: string | URL | Request, _init?: RequestInit) => {
    const url = urlOf(input)

    const body = url.includes('/auth/me')
      ? { user }
      : url.includes('/dues/status')
        ? {
            membership: {
              status: 'EXPIRED',
              hasAccess: false,
              duesRequired: true,
              paidThrough: null,
              freeThrough: null,
              term,
              billable: term,
            },
            plans: [
              {
                plan: 'SEMESTER',
                amountCents: 2_500,
                covers: [term],
                through: term.endsAt,
              },
            ],
            paymentsEnabled: true,
            history: [],
          }
        : []

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

/** `BrowserRouter` reads the real location, so the test has to set it. */
const renderAt = (path: string) => {
  window.history.pushState({}, '', path)
  const stub = stubApi()
  render(<App />)
  return stub
}

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

describe('the dashboard shell', () => {
  it('draws the rail around a page that lives inside it', async () => {
    renderAt('/dashboard/dues')

    expect(await screen.findByRole('link', { name: 'OVERVIEW' })).toHaveAttribute(
      'href',
      '/dashboard',
    )
    expect(
      screen.getByRole('link', { name: 'DUES & PAYMENTS' }),
    ).toHaveAttribute('href', '/dashboard/dues')
    expect(screen.getByText('/ MANAGE')).toBeInTheDocument()

    // The dues page itself, drawn in the rail's content column.
    expect(await screen.findByText('$25')).toBeInTheDocument()
  })

  /**
   * The complaint that started the rework: the rail's group heading and the
   * page's eyebrow both read `/ DASHBOARD`, which looked like one label printed
   * twice. The page says which page it is now, and only the page does.
   */
  it('names the page once, and it names the page', async () => {
    renderAt('/dashboard/dues')

    expect(await screen.findByText('/ DUES')).toBeInTheDocument()
    expect(screen.queryByText('/ DASHBOARD')).not.toBeInTheDocument()
  })

  /** Initials, in the bar where the MY DASHBOARD button was and at the rail's head. */
  it('shows the person as initials rather than spelling out a button', async () => {
    renderAt('/dashboard')

    expect(await screen.findByRole('link', { name: /your account/i })).toHaveAttribute(
      'href',
      '/dashboard/profile',
    )
    // First word and last word — not the middle name.
    expect(screen.getAllByText('RT')).toHaveLength(2)
    expect(screen.queryByText(/my dashboard/i)).not.toBeInTheDocument()
  })
})

describe('the /dues redirect', () => {
  it('lands a bare visit on the dashboard page', async () => {
    renderAt('/dues')

    expect(await screen.findByText('$25')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/dashboard/dues')
  })

  it('carries a returning payment through with it', async () => {
    const stub = renderAt('/dues?payment_intent=pi_returned')

    await screen.findByRole('link', { name: 'OVERVIEW' })
    expect(window.location.pathname).toBe('/dashboard/dues')

    // The intent survived the redirect *and* the page acted on it, which is the
    // thing that actually matters. The search string is empty by this point
    // because the dues page clears it once it has read it — see the ref-guarded
    // effect there.
    await vi.waitFor(() => {
      const sync = stub.mock.calls.filter(([input]) =>
        urlOf(input).includes('/dues/sync'),
      )

      expect(sync).toHaveLength(1)
      expect(bodyOf(sync[0]?.[1])).toEqual({ paymentIntentId: 'pi_returned' })
    })
  })
})
