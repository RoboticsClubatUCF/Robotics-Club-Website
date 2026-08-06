import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FaqSection } from './FaqSection'
import { faqs } from '../content/home'

/**
 * The FAQ takes no props and makes no request, so there is little here that a
 * build wouldn't catch. What is worth pinning down is the one thing the markup
 * choice buys: a closed answer is still in the document, so the browser's own
 * find-in-page reaches it. An accordion that unmounted its answers would pass
 * every other assertion in this file and quietly lose that.
 */
describe('FaqSection', () => {
  it('renders every question', () => {
    render(<FaqSection />)

    expect(faqs.length).toBeGreaterThan(0)
    for (const faq of faqs) {
      expect(screen.getByText(faq.question), faq.question).toBeInTheDocument()
    }
  })

  it('keeps the answers in the document while collapsed', () => {
    render(<FaqSection />)

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
    render(<FaqSection />)

    const [details] = screen.getAllByRole('group')
    const answer = details!.querySelector('.group-open\\:animate-reveal')
    expect(answer).not.toBeNull()
    expect(answer?.className).not.toContain(' animate-reveal')
  })

  it('numbers the one answer that is a procedure', () => {
    render(<FaqSection />)

    const steps = faqs.find((faq) => faq.steps)?.steps
    expect(steps).toBeDefined()

    for (const step of steps!) {
      expect(screen.getByText(step)).toBeInTheDocument()
    }
    expect(screen.getByText('1.')).toBeInTheDocument()
    expect(screen.getByText(String(steps!.length) + '.')).toBeInTheDocument()
  })
})
