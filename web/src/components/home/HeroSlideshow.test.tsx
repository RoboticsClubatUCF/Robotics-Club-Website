import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HeroSlideshow } from './HeroSlideshow'
import type { ApiHeroSlide } from '../../lib/api/api'
import { HERO_ADVANCE_MS } from '../../lib/heroSlides'

/**
 * The one thing on this site that moves without being asked to, which is why every case here is
 * about it stopping.
 *
 * The arithmetic — wrapping, the mount window — is pinned in `lib/heroSlides.test.ts` without a
 * DOM. What needs a DOM is the timer: that it runs, that a press ends it, that the pause control
 * ends it, and that a backgrounded tab does. Those are the four ways somebody is not looking at a
 * photograph changing, and getting any of them wrong is invisible in a screenshot.
 *
 * Nothing here asserts on opacity, because jsdom never fires an image's `load` event: every slide
 * stays at `opacity-0` under test whatever the state says. `aria-hidden` is the honest handle — it
 * tracks which slide is showing and nothing else — and the caption line is the other.
 */

const slide = (id: string, caption: string | null): ApiHeroSlide => ({
  id,
  url: `https://photos.invalid/${id}.jpg`,
  caption,
  focalX: 50,
  focalY: 50,
  zoom: 1,
})

const SLIDES = [
  slide('a', 'Rover on the field'),
  slide('b', 'Build night'),
  slide('c', 'The booth'),
]

/**
 * Advance the clock and let React settle. Testing Library's `findBy*`/`waitFor`
 * are unusable under fake timers — see the note in `.claude/docs/testing.md` —
 * so every wait here is deliberate and every assertion after one is synchronous.
 */
const tick = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

const showing = () =>
  screen.getByRole('status').textContent?.replace(/^Photo \d+ of \d+\. /, '')

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('HeroSlideshow', () => {
  it('advances on its own and wraps at the end', async () => {
    render(<HeroSlideshow slides={SLIDES} />)

    expect(showing()).toBe('Rover on the field')

    await tick(HERO_ADVANCE_MS)
    expect(showing()).toBe('Build night')

    await tick(HERO_ADVANCE_MS)
    expect(showing()).toBe('The booth')

    // Round the end rather than stopping on whichever photograph happens to be
    // last, which is the whole difference from the project gallery.
    await tick(HERO_ADVANCE_MS)
    expect(showing()).toBe('Rover on the field')
  })

  /**
   * Somebody who has said which photograph they want should not have it taken
   * away six seconds later. This is the property the whole control scheme rests
   * on, and the pause button is the only way back.
   */
  it('stops for good once a reader takes over', async () => {
    render(<HeroSlideshow slides={SLIDES} />)

    fireEvent.click(screen.getByRole('button', { name: 'Next photo' }))
    expect(showing()).toBe('Build night')

    await tick(HERO_ADVANCE_MS * 3)
    expect(showing()).toBe('Build night')

    // And the control now offers to start it again, rather than to pause
    // something that is not running.
    fireEvent.click(screen.getByRole('button', { name: 'Play the slideshow' }))
    await tick(HERO_ADVANCE_MS)
    expect(showing()).toBe('The booth')
  })

  it('pauses under the pointer and picks up when it leaves', async () => {
    const { container } = render(<HeroSlideshow slides={SLIDES} />)
    const region = container.querySelector('section')

    if (!region) throw new Error('no slideshow')

    fireEvent.mouseEnter(region)
    await tick(HERO_ADVANCE_MS * 2)
    expect(showing()).toBe('Rover on the field')

    fireEvent.mouseLeave(region)
    await tick(HERO_ADVANCE_MS)
    expect(showing()).toBe('Build night')
  })

  it('pauses with the tab', async () => {
    render(<HeroSlideshow slides={SLIDES} />)

    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    fireEvent(document, new Event('visibilitychange'))

    await tick(HERO_ADVANCE_MS * 2)
    expect(showing()).toBe('Rover on the field')
  })

  /**
   * Stricter than the global reduced-motion block in `index.css`, which only
   * flattens the fade: a photograph swapping instantly every six seconds is
   * still moving content. The play control goes too — offering to start
   * something somebody has asked not to have is not a kindness.
   */
  it('never starts, and offers no way to start it, when motion is unwelcome', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('reduce'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )

    render(<HeroSlideshow slides={SLIDES} />)

    await tick(HERO_ADVANCE_MS * 3)
    expect(showing()).toBe('Rover on the field')
    expect(screen.queryByRole('button', { name: /slideshow/ })).toBeNull()

    // The arrows stay: moving between photographs on purpose is not motion
    // anybody asked to be spared.
    expect(screen.getByRole('button', { name: 'Next photo' })).toBeInTheDocument()
  })

  /**
   * A live region that spoke every six seconds would talk over the page; one
   * that never spoke would leave a keyboard reader pressing › into silence.
   */
  it('announces the caption only once it has stopped rotating', async () => {
    render(<HeroSlideshow slides={SLIDES} />)

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'off')

    fireEvent.click(screen.getByRole('button', { name: 'Previous photo' }))

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    // Backwards wraps too, so the arrow is never a dead end either.
    expect(showing()).toBe('The booth')
  })

  it('mounts three slides at a time, whichever one is showing', async () => {
    const five = [
      ...SLIDES,
      slide('d', 'Competition day'),
      slide('e', 'The workshop'),
    ]

    const { container } = render(<HeroSlideshow slides={five} />)

    // The current one and its two neighbours — the last one included, because
    // the window wraps and that is the slide about to come round.
    expect(container.querySelectorAll('img')).toHaveLength(3)
    expect(container.querySelectorAll('img[aria-hidden="false"]')).toHaveLength(1)

    await tick(HERO_ADVANCE_MS)
    expect(container.querySelectorAll('img')).toHaveLength(3)
  })

  it('draws no controls for a single photo, and nothing at all for none', () => {
    const { container } = render(<HeroSlideshow slides={[SLIDES[0]]} />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(container.querySelectorAll('img')).toHaveLength(1)

    const { container: empty } = render(<HeroSlideshow slides={[]} />)
    expect(empty.querySelector('section')).toBeNull()
  })
})
