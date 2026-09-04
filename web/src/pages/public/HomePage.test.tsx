import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HomePage } from './HomePage'
import { sectionLinks } from '../../content/home'
import { stubFetch } from '../../test/stubFetch'

/**
 * The landing page, as a table of contents.
 *
 * Every other suite here renders one section with its neighbours stubbed out,
 * which is the right default and cannot see the one thing this page owes the
 * nav: `sectionLinks` claims to list the sections of this page **in the order
 * they appear on it**. Nothing else checks that. A section added, renamed or
 * moved leaves the nav pointing somewhere that no longer exists or listing the
 * page in an order it is not in, and both fail silently — an anchor to a
 * missing id scrolls nowhere at all, which reads as a dead link.
 *
 * So: the ids on the page, in document order, against the hrefs in the nav.
 */

/**
 * Eight requests land on this page. Most of them do not matter here — a section
 * draws its own chrome, id included, before its data arrives — but an unstubbed
 * `fetch` rejects with "no stub for …" and fills the run with noise.
 *
 * **`/front-page` is the exception and has to carry a partner program.** That
 * section is the one that is not on the page until there is something to put on
 * it, so an empty answer would take `#partners` with it and this suite would be
 * asserting the nav against a page the club is not in. Officers emptying that
 * list is a real state and a nav link with nothing behind it is its one cost;
 * see the note on `sectionLinks` in `content/home.ts`.
 */
const renderPage = () => {
  vi.stubGlobal(
    'fetch',
    stubFetch({
      '/stats': { projects: 0, members: 0, events: 0 },
      '/sponsors': [],
      '/events': [],
      '/officers': { seats: [], officers: [] },
      // The hero's lab sign. Not a section and not in `sectionLinks`, but it
      // fetches from inside the hero, so it needs an answer like the rest.
      '/lab': { open: false, changedAt: null, buildingOpen: true },
      // And the hero's slideshow, for the same reason. Empty is the answer that
      // puts the rings back, which is what this page looked like before there
      // was a table behind them — either way the `id` this suite checks for is
      // on the section and is there in every state.
      '/hero-slides': [],
      // The contact form, at the foot of the FAQ, asking whether this visitor
      // has any messages left today before it draws its fields. The `id` this
      // suite is checking for is on the wrapper and is there either way.
      '/contact': { allowed: true, remaining: 2, retryAfter: 0, message: null },
      // The page's own words: the hero's headline and lede, the line above the
      // partner cards, and the FAQ. One request for all three sections.
      '/front-page': {
        headline: 'Building Our Future,',
        headlineAccent: 'One Robot at a Time.',
        lede: 'A lede.',
        partnersIntro: 'An intro.',
        faqs: [],
        partners: [
          {
            id: 'vex',
            name: 'VEX Robotics',
            audience: 'ANYBODY',
            blurb: 'A program.',
            href: 'https://www.vexrobotics.com/',
            linkLabel: 'Visit VEX Robotics',
            imageUrl: null,
          },
        ],
      },
    }),
  )

  return render(<HomePage />, {
    // `OfficersSection`'s header is a real `<Link>`, which throws outside one.
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter>{children}</MemoryRouter>
    ),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** `/#faq` is a link to `id="faq"`; this is the half of that the nav owns. */
const anchorOf = (href: string) => href.replace('/#', '')

describe('HomePage', () => {
  it('has a section behind every anchor the nav offers', async () => {
    const { container } = renderPage()

    // `#partners` arrives with its answer rather than with the page — it is the
    // one section that is not drawn until there is something in it.
    await screen.findByRole('heading', { name: 'VEX Robotics' })

    for (const link of sectionLinks) {
      expect(
        container.querySelector(`#${anchorOf(link.href)}`),
        `${link.label} → ${link.href}`,
      ).not.toBeNull()
    }
  })

  /**
   * The nav is read as a list of what is on this page, so the third word in it
   * has to be the third thing you come to. Getting this wrong is not a broken
   * link — every anchor still resolves — which is exactly why it needs pinning
   * rather than noticing.
   */
  it('runs those sections in the order the nav lists them', async () => {
    const { container } = renderPage()

    await screen.findByRole('heading', { name: 'VEX Robotics' })

    const listed = sectionLinks.map((link) => anchorOf(link.href))
    const onPage = [...container.querySelectorAll('section[id]')]
      .map((section) => section.id)
      .filter((id) => listed.includes(id))

    expect(onPage).toEqual(listed)
  })
})
