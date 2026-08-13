import {
  fireEvent,
  render as renderBare,
  screen,
  within,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SiteNav } from './SiteNav'
import { navLinks } from '../../content/home'
import { SessionProvider } from '../../lib/auth'
import { stubFetch } from '../../test/stubFetch'

/**
 * The nav renders its links twice — once in the row that shows above the
 * breakpoint, once in the panel that shows below it — and CSS picks. Only one is
 * ever in the accessibility tree, because `display: none` takes the other out of
 * it, but jsdom applies no CSS, so every query here has to say which one it
 * means.
 */

/**
 * The nav is in the layout on every route, so half its links are `<Link>`s and
 * those throw outside a router. `MemoryRouter` keeps the history in memory,
 * which is what lets a test assert on where a link points without jsdom trying
 * to navigate anywhere.
 *
 * `SessionProvider` is here for the same reason: the bar asks who is signed in,
 * so it needs the context the app puts around it. Every assertion below is
 * about the signed-out bar — which is what these synchronous queries see, since
 * `/auth/me` has not resolved by the time they run, and is also the state the
 * overwhelming majority of visitors are in.
 */
const render = () => {
  vi.stubGlobal('fetch', stubFetch({ '/auth/me': { user: null } }))

  return renderBare(<SiteNav />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter>
        <SessionProvider>{children}</SessionProvider>
      </MemoryRouter>
    ),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The links the signed-out bar carries: the sections, then the way in. */
const signedOutLinks = [...navLinks, { href: '/login', label: 'Sign in' }]

const toggle = () => screen.getByRole('button', { name: /menu/i })

const panel = () =>
  document.getElementById(toggle().getAttribute('aria-controls')!)!

describe('SiteNav', () => {
  it('takes the masthead to the site root, not to an anchor on this page', () => {
    render()

    // `#top` would only ever scroll you to the top of the page you are on.
    expect(screen.getByRole('link', { name: /robotics club/i })).toHaveAttribute(
      'href',
      '/',
    )
  })

  it('starts with the menu shut', () => {
    render()

    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(panel()).toHaveClass('hidden')
  })

  it('opens and shuts on the toggle', () => {
    render()

    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(panel()).not.toHaveClass('hidden')

    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  /**
   * The case that matters is the in-page anchor: it scrolls without unmounting
   * anything, so an open menu would sit over the section it just jumped to. A
   * link to a route replaces the page under it either way.
   */
  it('shuts itself when an anchor inside it is followed', () => {
    const anchor = navLinks.find((link) => link.href.includes('#'))
    expect(anchor).toBeDefined()

    render()

    fireEvent.click(toggle())
    fireEvent.click(within(panel()).getByRole('link', { name: anchor!.label }))

    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('shuts on Escape, so the trigger is not the only way out', () => {
    render()

    fireEvent.click(toggle())
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('carries every nav link in the panel, not just the wide row', () => {
    render()

    const links = within(panel()).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(
      signedOutLinks.map((link) => link.label),
    )
  })

  /**
   * The way in has to be reachable on a phone too. It sits with the section
   * links rather than becoming a second button beside the gold one: the bar is
   * already three things wide at 320px, and two buttons means no primary
   * action.
   */
  it('offers a way to sign in at both widths', () => {
    render()

    expect(within(panel()).getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login',
    )
    expect(screen.getAllByRole('link', { name: 'Sign in' })).toHaveLength(2)
  })

  /**
   * The join button is the reason the bar exists, so it survives at every width
   * — but "JOIN THE CLUB" and a masthead and a toggle do not fit across 320px,
   * which is why the short label exists.
   */
  it('keeps the join button at both widths, under two labels', () => {
    render()

    // It pointed at `#faq` for as long as there was nowhere to actually sign up.
    const join = screen.getByRole('link', { name: /join/i })
    expect(join).toHaveAttribute('href', '/join')
    expect(within(join).getByText('JOIN')).toHaveClass('wide:hidden')
    expect(within(join).getByText('JOIN THE CLUB')).toHaveClass('hidden')
  })

  /**
   * Signed in, that button is an avatar instead.
   *
   * At that point the bar's job is "who am I, and how do I get to my things",
   * and spelling it out as MY DASHBOARD was the widest possible way to say it.
   * The initials are the accessible name's job to *not* carry — the label names
   * the destination, and "RT" read out on its own tells nobody anything.
   */
  it('becomes an avatar once somebody is signed in', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/auth/me': {
          user: {
            id: 'u1',
            fullName: 'Rowan Test',
            email: 'rowan@ucf.edu',
            slug: null,
            role: 'MEMBER',
            discordUsername: null,
          },
        },
      }),
    )

    renderBare(<SiteNav />, {
      wrapper: ({ children }: { children: ReactNode }) => (
        <MemoryRouter>
          <SessionProvider>{children}</SessionProvider>
        </MemoryRouter>
      ),
    })

    const account = await screen.findByRole('link', { name: /your account/i })
    expect(account).toHaveAttribute('href', '/dashboard/profile')
    expect(account).toHaveTextContent('RT')
    expect(screen.queryByText(/my dashboard/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^join/i })).not.toBeInTheDocument()
  })
})
