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
import { pageLinks, sectionLinks } from '../../content/home'
import { SessionProvider } from '../../lib/auth/auth'
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

/** The same bar with `/auth/me` answering, for the two signed-in assertions. */
const renderSignedIn = () => {
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

/** The pages the signed-out bar carries: the project list, then the way in. */
const signedOutPages = [...pageLinks, { href: '/login', label: 'Sign in' }]

/** Both lists, in the order the bar puts them. */
const signedOutLinks = [...sectionLinks, ...signedOutPages]

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
    const anchor = sectionLinks.find((link) => link.href.includes('#'))
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
   * The links are two lists, not one: the left half scrolls the front page and
   * the right half leaves it. The rule between them says so to anybody looking
   * at the bar, and is `aria-hidden` — "vertical line" read out between two
   * lists says nothing — so the labels are what carry it to everybody else.
   * Lose those and the split becomes decoration.
   */
  it('splits the links into the sections of this page and the pages', () => {
    render()

    for (const label of ['Sections of this page', 'Other pages']) {
      // One in the wide row, one in the panel. jsdom applies no CSS, so both
      // are in the tree here; in a browser `display: none` leaves exactly one.
      expect(screen.getAllByRole('list', { name: label }), label).toHaveLength(2)
    }

    const [sections] = screen.getAllByRole('list', {
      name: 'Sections of this page',
    })
    expect(
      within(sections!)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(sectionLinks.map((link) => link.label))

    const [pages] = screen.getAllByRole('list', { name: 'Other pages' })
    expect(
      within(pages!)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(signedOutPages.map((link) => link.label))
  })

  /**
   * The way in has to be reachable on a phone too. It sits with the pages
   * rather than becoming a second button beside the gold one: the bar is
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
   * Signed in, that button is an avatar instead, and the last page link becomes
   * the way to the section rather than the way in.
   *
   * At that point the bar's job is "who am I, and how do I get to my things",
   * and spelling it out as MY DASHBOARD was the widest possible way to say it.
   * The initials are the accessible name's job to *not* carry — the label names
   * the destination, and "RT" read out on its own tells nobody anything.
   */
  it('becomes an avatar once somebody is signed in', async () => {
    renderSignedIn()

    const account = await screen.findByRole('link', { name: /your account/i })
    expect(account).toHaveAttribute('href', '/dashboard/profile')
    expect(account).toHaveTextContent('RT')
    expect(screen.queryByText(/my dashboard/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^join/i })).not.toBeInTheDocument()
  })

  /**
   * "Dashboard" takes the slot "Sign in" had — last of the pages, immediately
   * before the avatar — because it is the link that slot is for: the one route
   * this visitor can reach that the bar does not otherwise offer. It points at
   * the section, not at the avatar's own page.
   *
   * Signed out it is absent rather than pointing somewhere: `/dashboard`
   * redirects to `/login`, which is what the link already sitting there says.
   */
  it('swaps the way in for the way to the dashboard once signed in', async () => {
    renderSignedIn()

    // The wide row and the phone panel, as with every other link on the bar.
    const dashboard = await screen.findAllByRole('link', { name: 'Dashboard' })
    expect(dashboard).toHaveLength(2)
    for (const link of dashboard) expect(link).toHaveAttribute('href', '/dashboard')

    // Last of the pages, so the rule still separates the two kinds of link and
    // the avatar still follows the list.
    const [pages] = screen.getAllByRole('list', { name: 'Other pages' })
    expect(
      within(pages!)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([...pageLinks.map((link) => link.label), 'Dashboard'])
    expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('offers no dashboard link while nobody is signed in', () => {
    // `/dashboard` would redirect to `/login`, which is what the link already
    // sitting in that slot says.
    render()

    expect(
      screen.queryByRole('link', { name: 'Dashboard' }),
    ).not.toBeInTheDocument()
  })
})
