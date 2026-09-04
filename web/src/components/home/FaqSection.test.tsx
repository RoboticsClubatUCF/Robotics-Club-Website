import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FaqSection } from './FaqSection'
import type { ApiFaq, ApiFrontPage } from '../../lib/api/api'
import type { ApiState } from '../../lib/api/useApi'
import { stubFetch } from '../../test/stubFetch'

/**
 * The FAQ.
 *
 * **The questions are a prop now**, not an import — `HomePage` fetches the whole
 * page's copy in one request and hands each section its slice — so this file
 * gained the three states every fetched section has to have an answer for. The
 * error one is the interesting case: the contact form beside the questions is
 * the half of this section that works without the API, and a visitor whose
 * question is not answered is exactly who it is for, so it is drawn in every
 * state.
 *
 * What was already worth pinning down still is: a closed answer stays in the
 * document, so the browser's own find-in-page reaches it. An accordion that
 * unmounted its answers would pass every other assertion here and quietly lose
 * that.
 *
 * The one request on this section belongs to `ContactForm`, which asks whether
 * this visitor may still write in before it draws the box. Nothing here is about
 * that — but an unstubbed `fetch` in jsdom is a real call to a real port, and
 * the API is often up on this machine.
 */
const faqs: ApiFaq[] = [
  {
    id: 'faq-1',
    question: 'Do I need experience to join?',
    answer: 'No, all projects are drop-in certified.',
    steps: [],
  },
  {
    id: 'faq-2',
    question: 'How do I become a member?',
    answer: 'Becoming a member is as easy as:',
    steps: ['Create an account', 'Fill in the survey', 'Pay your dues'],
  },
]

const ready = (over: Partial<ApiFrontPage> = {}): ApiState<ApiFrontPage> => ({
  status: 'ready',
  data: {
    headline: 'Building Our Future,',
    headlineAccent: 'One Robot at a Time.',
    lede: 'A lede.',
    partnersIntro: 'An intro.',
    faqs,
    partners: [],
    ...over,
  },
})

beforeEach(() => {
  vi.stubGlobal('fetch', stubFetch({ '/contact': { allowed: true, remaining: 2, retryAfter: 0, message: null } }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FaqSection', () => {
  it('renders every question', () => {
    render(<FaqSection copy={ready()} />)

    for (const faq of faqs) {
      expect(screen.getByText(faq.question), faq.question).toBeInTheDocument()
    }
  })

  it('keeps the answers in the document while collapsed', () => {
    render(<FaqSection copy={ready()} />)

    for (const details of screen.getAllByRole('group')) {
      expect(details).not.toHaveAttribute('open')
    }
    expect(screen.getByText(/all projects are drop-in certified/i)).toBeInTheDocument()
  })

  /**
   * The animation is carried by a `group-open:` class, which means it exists
   * only while the disclosure is open and replays on every reopen. If it were
   * ever applied unconditionally it would run once on page load and never
   * again, which looks identical in a screenshot and wrong in use.
   */
  it('animates the answer on open only', () => {
    render(<FaqSection copy={ready()} />)

    const [details] = screen.getAllByRole('group')
    const answer = details!.querySelector('.group-open\\:animate-reveal')
    expect(answer).not.toBeNull()
    expect(answer?.className).not.toContain(' animate-reveal')
  })

  it('numbers the answer that is a procedure', () => {
    render(<FaqSection copy={ready()} />)

    const steps = faqs[1]!.steps

    for (const step of steps) {
      expect(screen.getByText(step)).toBeInTheDocument()
    }
    expect(screen.getByText('1.')).toBeInTheDocument()
    expect(screen.getByText(`${String(steps.length)}.`)).toBeInTheDocument()
  })

  it('draws the contact form while the questions are still out', async () => {
    render(<FaqSection copy={{ status: 'loading' }} />)

    expect(screen.queryAllByRole('group')).toHaveLength(0)
    // `findBy`, because the form draws its fields only once its own request
    // has answered whether this visitor may still write in today.
    expect(await screen.findByRole('button', { name: /send/i })).toBeInTheDocument()
  })

  /** The form is the half of this section that does not need the questions. */
  it('says so when the questions could not be loaded, and keeps the form', async () => {
    render(<FaqSection copy={{ status: 'error', code: 500 }} />)

    expect(screen.getByText(/couldn.t load the questions/i)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /send/i })).toBeInTheDocument()
  })

  it('points somebody at the form when there are no questions at all', () => {
    render(<FaqSection copy={ready({ faqs: [] })} />)

    expect(screen.getByText(/no questions are up yet/i)).toBeInTheDocument()
  })
})
