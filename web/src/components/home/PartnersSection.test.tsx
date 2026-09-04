import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PartnersSection } from './PartnersSection'
import type { ApiFrontPage, ApiPartnerProgram } from '../../lib/api/api'
import type { ApiState } from '../../lib/api/useApi'

/**
 * The partner programs.
 *
 * The cards are a prop now, not an import — `HomePage` fetches the page's copy in one request and
 * hands each section its slice. What is worth pinning is the part the section exists for: the join
 * page links at `/#partners`, and the two things that make that link work — the anchor being on
 * this section, and every card carrying a way out to the program itself — are exactly what a
 * refactor drops without breaking anything visible.
 *
 * And the new one: this section has no loading or error state. It is not on the page until there is
 * something to put on it, which is a choice rather than an oversight, so it is worth saying so.
 */
const partners: ApiPartnerProgram[] = [
  {
    id: 'vex',
    name: 'VEX Robotics',
    audience: 'PLACEHOLDER — WHO IT IS FOR',
    blurb: 'What RCCF does with VEX.',
    href: 'https://www.vexrobotics.com/',
    linkLabel: 'Visit VEX Robotics',
    imageUrl: null,
  },
  {
    id: 'first',
    name: 'FIRST Robotics',
    audience: 'PLACEHOLDER — WHO IT IS FOR',
    blurb: 'The same again for FIRST.',
    href: 'https://www.firstinspires.org/',
    linkLabel: 'Visit FIRST',
    imageUrl: '/api/files/abc',
  },
]

const ready = (over: Partial<ApiFrontPage> = {}): ApiState<ApiFrontPage> => ({
  status: 'ready',
  data: {
    headline: 'Building Our Future,',
    headlineAccent: 'One Robot at a Time.',
    lede: 'A lede.',
    partnersIntro: 'Club membership is UCF students only.',
    faqs: [],
    partners,
    ...over,
  },
})

describe('PartnersSection', () => {
  it("renders every program, under the club's own introduction", () => {
    render(<PartnersSection copy={ready()} />)

    expect(
      screen.getByText('Club membership is UCF students only.'),
    ).toBeInTheDocument()

    for (const program of partners) {
      expect(
        screen.getByRole('heading', { name: program.name }),
        program.name,
      ).toBeInTheDocument()
      expect(screen.getByText(program.blurb)).toBeInTheDocument()
    }
  })

  /** The join page's link is `/#partners`, and this is the other half of it. */
  it('carries the anchor the join page points at', () => {
    const { container } = render(<PartnersSection copy={ready()} />)

    expect(container.querySelector('section#partners')).not.toBeNull()
  })

  /**
   * The whole point of a card is the way out of it. Each link names its
   * program rather than reading "learn more", because a screen reader reads
   * these as a list of links with nothing else around them.
   */
  it('links out to each program by name', () => {
    render(<PartnersSection copy={ready()} />)

    for (const program of partners) {
      const link = screen.getByRole('link', { name: program.linkLabel })
      expect(link).toHaveAttribute('href', program.href)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    }
  })

  /**
   * A program with no artwork yet gets a held-open well, not a collapsed card
   * or a broken image — the same language the sponsor logos and the empty
   * officer seats use.
   */
  it('holds the image well open when there is no artwork', () => {
    render(<PartnersSection copy={ready()} />)

    expect(screen.getAllByText('[ IMAGE ]')).toHaveLength(1)
  })

  /**
   * Three states, one answer, and it is nothing at all. Reserving a bordered box for a section that
   * may turn out not to exist is worse than a section that arrives a moment late — and a visitor
   * cannot act on the difference between "the club listed none" and "the request failed".
   */
  it('stays off the page while loading, on failure, and when there are none', () => {
    const { container: waiting } = render(
      <PartnersSection copy={{ status: 'loading' }} />,
    )
    expect(waiting.querySelector('section#partners')).toBeNull()

    const { container: failed } = render(
      <PartnersSection copy={{ status: 'error', code: 0 }} />,
    )
    expect(failed.querySelector('section#partners')).toBeNull()

    const { container: none } = render(
      <PartnersSection copy={ready({ partners: [] })} />,
    )
    expect(none.querySelector('section#partners')).toBeNull()
  })
})
