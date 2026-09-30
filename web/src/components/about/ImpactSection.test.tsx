import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImpactSection } from './ImpactSection'

const stats = [{ id: 's1', figure: '$15,000 annually', label: 'in funding' }]

/**
 * jsdom has neither `IntersectionObserver` nor `matchMedia`, so each case installs what it needs.
 * The observer hands its callback out so a case can say when the row comes into view, and animation
 * frames run on the next tick with a clock far enough on that the count is over.
 */
let reveal: (() => void) | null = null

const stubMotion = (reduced: boolean) => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        reveal = () => {
          callback([{ isIntersecting: true }])
        }
      }
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('requestAnimationFrame', (tick: (now: number) => void) =>
    setTimeout(() => {
      tick(performance.now() + 60_000)
    }, 0),
  )
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    clearTimeout(id)
  })
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }))
}

/** The digits a sighted visitor sees, which screen readers are kept away from. */
const shown = () => screen.getByText((_, element) => element?.getAttribute('aria-hidden') === 'true' && element.tagName === 'SPAN')

afterEach(() => {
  reveal = null
  vi.unstubAllGlobals()
})

describe('ImpactSection', () => {
  it('holds at zero until the row is on screen, then lands on the figure', async () => {
    stubMotion(false)
    render(<ImpactSection stats={stats} />)

    expect(shown()).toHaveTextContent('$0')

    await act(async () => {
      reveal?.()
      await new Promise((done) => setTimeout(done, 10))
    })

    expect(shown()).toHaveTextContent('$15,000')
  })

  it('never moves when the browser asks for less motion', () => {
    stubMotion(true)
    render(<ImpactSection stats={stats} />)

    expect(shown()).toHaveTextContent('$15,000')
  })

  /** Screen readers get the figure as written from the start, never the count. */
  it('gives screen readers the figure as written', () => {
    stubMotion(false)
    render(<ImpactSection stats={stats} />)

    expect(screen.getByRole('listitem')).toHaveTextContent('$15,000 annually')
  })
})
