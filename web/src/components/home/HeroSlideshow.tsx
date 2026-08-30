import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { ApiHeroSlide } from '../../lib/api/api'
import {
  HERO_ADVANCE_MS,
  inHeroWindow,
  prefersReducedMotion,
  stepIndex,
} from '../../lib/heroSlides'
import { frameStyle } from '../../lib/media/imageFraming'
import { imageSrc } from '../../lib/media/storedFiles'

/**
 * The club's photographs, beside the headline.
 *
 * **This one moves on its own and the project gallery does not**, which is the
 * only real difference between them and worth saying why. A gallery is opened by
 * somebody who has already decided to look at a robot; the hero is the first
 * thing on the site, seen by somebody who is reading a headline, and a hero that
 * shows one photograph until it is clicked shows one photograph. So it rotates —
 * and everything below is the cost of doing that honestly:
 *
 * - **It stops for anybody who asks.** `prefers-reduced-motion` means it never
 *   starts, and the play control is not drawn either — offering to start movement
 *   somebody has asked not to have is not a kindness. That is stricter than the
 *   global block in `index.css`, which only flattens the fade: an image swapping
 *   instantly every six seconds is still moving content.
 * - **It stops when anybody takes over.** Pressing an arrow, a dot, a key or
 *   swiping ends the rotation for the rest of the visit, because somebody who has
 *   said which picture they want should not have it taken away six seconds later.
 *   The pause control is how it is started again, and the only way.
 * - **It pauses under the pointer and under focus**, so a caption cannot change
 *   while it is being read, and a keyboard user tabbing through the controls is
 *   not chasing a moving target.
 * - **It pauses with the tab**, the same rule `useLabStatus` follows: a
 *   background tab advancing through eight photographs is work nobody asked for
 *   and nobody sees.
 *
 * Three slides are mounted at a time and the window wraps — see `inHeroWindow`
 * in `lib/heroSlides.ts` for why `loading="lazy"` cannot do that job.
 *
 * It draws nothing at all with no slides. The empty case belongs to
 * `HeroSection`, which puts the rings and the wireframe trace back.
 */
export function HeroSlideshow({ slides }: { slides: ApiHeroSlide[] }) {
  const total = slides.length
  const [index, setIndex] = useState(0)
  /** Set by the first press of anything, and never cleared except by PLAY. */
  const [taken, setTaken] = useState(false)
  const [held, setHeld] = useState(false)
  const [awake, setAwake] = useState(true)
  const [still, setStill] = useState(prefersReducedMotion)
  // Where a drag started. Null between drags, and reset on cancel so a pointer
  // that leaves the frame mid-swipe doesn't arm the next tap.
  const dragFrom = useRef<{ x: number; y: number } | null>(null)

  /**
   * The one thing on this page that would keep moving with the tab in the
   * background. `useLabStatus` pauses its polling for the same reason and with
   * the same event; this is cheaper to get right, because nothing has to catch
   * up on the way back — the photograph on screen is still a photograph.
   */
  useEffect(() => {
    const onVisibility = () => {
      setAwake(!document.hidden)
    }

    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  /**
   * Somebody can turn the setting on with the page already open, and on a phone
   * that is exactly what happens — low-power mode flips it. Guarded rather than
   * assumed: a browser without `matchMedia` answered "no" on mount and has
   * nothing to subscribe to.
   */
  useEffect(() => {
    if (typeof matchMedia !== 'function') return

    const query = matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => {
      setStill(query.matches)
    }

    query.addEventListener('change', onChange)
    return () => {
      query.removeEventListener('change', onChange)
    }
  }, [])

  const rotating = total > 1 && !taken && !held && awake && !still

  useEffect(() => {
    if (!rotating) return

    const timer = window.setInterval(() => {
      // A functional update, so the interval does not have to be torn down and
      // rebuilt on every advance — which would also reset the six seconds every
      // time anything else on the page re-rendered this.
      setIndex((at) => stepIndex(at, 1, total))
    }, HERO_ADVANCE_MS)

    return () => {
      window.clearInterval(timer)
    }
  }, [rotating, total])

  if (total === 0) return null

  // Clamped on read rather than chased with an effect: the officer desk renders
  // this same component against a list it is editing, so the list can shrink
  // under the index between renders.
  const current = Math.min(index, total - 1)
  const single = total === 1

  /** Every reader-driven move goes through here, so exactly one place stops the
      rotation. */
  const go = (to: number) => {
    setTaken(true)
    setIndex(stepIndex(to, 0, total))
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const from = dragFrom.current
    if (!from) return
    const dx = event.clientX - from.x
    const dy = event.clientY - from.y
    dragFrom.current = null

    // Horizontal *and* mostly horizontal, so scrolling the page with a thumb
    // that happens to start on the picture still scrolls the page.
    if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return
    go(stepIndex(current, dx < 0 ? 1 : -1, total))
  }

  return (
    <section
      aria-label="Club photos"
      // Focus anywhere inside pauses it, which is what makes the arrows usable
      // with a keyboard: React's focus events bubble, so this catches the frame
      // and every control under it in one place.
      onFocus={() => {
        setHeld(true)
      }}
      onBlur={() => {
        setHeld(false)
      }}
      onMouseEnter={() => {
        setHeld(true)
      }}
      onMouseLeave={() => {
        setHeld(false)
      }}
      className="animate-rise"
    >
      {/* The frame owns the aspect ratio, so the box exists at its final size
          before a single byte arrives and does not move when one does. That is
          the whole layout-shift story, and it matters more here than it does in
          a project's gallery: this sits beside the headline, and anything that
          resized late would shove the hero around. The hatch shows through until
          a slide loads, and keeps showing if one never does. */}
      <div
        role="group"
        aria-label="Club photos"
        tabIndex={0}
        onKeyDown={(event) => {
          const to =
            event.key === 'ArrowRight'
              ? stepIndex(current, 1, total)
              : event.key === 'ArrowLeft'
                ? stepIndex(current, -1, total)
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? total - 1
                    : null
          if (to === null) return
          event.preventDefault()
          go(to)
        }}
        onPointerDown={(event) => {
          dragFrom.current = { x: event.clientX, y: event.clientY }
        }}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragFrom.current = null
        }}
        className="bg-hatch border-rule focus-visible:outline-primary relative aspect-[16/10] w-full touch-pan-y overflow-hidden border focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {slides.map((slide, position) =>
          inHeroWindow(position, current, total) ? (
            <Slide
              key={slide.id}
              slide={slide}
              first={position === 0}
              shown={position === current}
            />
          ) : null,
        )}
      </div>

      {!single && (
        <div className="mt-2.5 flex items-center gap-2">
          <Control
            label="Previous photo"
            glyph="‹"
            onClick={() => {
              go(stepIndex(current, -1, total))
            }}
          />
          <Control
            label="Next photo"
            glyph="›"
            onClick={() => {
              go(stepIndex(current, 1, total))
            }}
          />

          {/* Squares, like every other mark on this site. A row of circles here
              would be the one curved thing on the page — the same argument the
              lab sign's square makes. */}
          <ul className="flex flex-1 items-center justify-center gap-1.5">
            {slides.map((slide, position) => (
              <li key={slide.id}>
                <button
                  type="button"
                  aria-label={`Photo ${position + 1}`}
                  aria-current={position === current}
                  onClick={() => {
                    go(position)
                  }}
                  className={`block size-2 cursor-pointer transition-colors duration-200 ${
                    position === current
                      ? 'bg-primary'
                      : 'bg-base-content/25 hover:bg-base-content/50'
                  }`}
                />
              </li>
            ))}
          </ul>

          {/* Not drawn at all when the browser has asked for less motion: there
              is nothing to pause, and a play button would be an invitation to
              undo a setting somebody chose deliberately. */}
          {!still && (
            <Control
              label={taken ? 'Play the slideshow' : 'Pause the slideshow'}
              glyph={taken ? '▶' : '❙❙'}
              onClick={() => {
                setTaken(!taken)
              }}
            />
          )}
        </div>
      )}

      {/* One line, and it keeps its height whether or not this photograph has a
          caption — otherwise the buttons below the hero would move as the
          slideshow ran.

          `aria-live` is off while it is rotating and polite once it has stopped,
          which is the whole of the announcement policy: a region that spoke every
          six seconds would talk over the page, and one that never spoke would
          leave a keyboard reader pressing › into silence. */}
      <p
        role="status"
        aria-live={rotating ? 'off' : 'polite'}
        className="text-dim mt-2 min-h-[1.25rem] text-[12px] leading-[1.4] text-pretty"
      >
        {!single && (
          <span className="sr-only">{`Photo ${current + 1} of ${total}. `}</span>
        )}
        {slides[current].caption}
      </p>
    </section>
  )
}

function Slide({
  slide,
  first,
  shown,
}: {
  slide: ApiHeroSlide
  first: boolean
  shown: boolean
}) {
  const [loaded, setLoaded] = useState(false)

  return (
    <img
      /* Through `imageSrc`, or an upload's root-relative address resolves
         against this page instead of the API and silently never loads. */
      src={imageSrc(slide.url)}
      alt={slide.caption ?? ''}
      /* The first slide is very likely this page's largest paintable element,
         so it says so rather than leaving the browser to guess. The mount
         window, not this attribute, is what stops the other seven downloading. */
      loading={first ? 'eager' : 'lazy'}
      fetchPriority={first ? 'high' : 'auto'}
      /* So a decode never blocks the main thread at the moment the slideshow
         advances — which, unlike a gallery, is a moment nobody chose. */
      decoding="async"
      onLoad={() => {
        setLoaded(true)
      }}
      /* The officer's framing. `object-cover` lives in here rather than in the
         class list because the two have to be set together. */
      style={frameStyle(slide)}
      className={`absolute inset-0 h-full w-full transition-opacity duration-500 ${
        shown && loaded ? 'opacity-100' : 'opacity-0'
      }`}
      aria-hidden={!shown}
    />
  )
}

/**
 * The arrows and the pause switch, which are the same button with different
 * words in it. Touch-sized below the breakpoint, per the site's rule.
 *
 * Nothing here disables: the slideshow wraps, so there is no end to be at and no
 * dead arrow to explain.
 */
function Control({
  label,
  glyph,
  onClick,
}: {
  label: string
  glyph: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="border-rule text-dim hover:border-primary hover:text-primary flex size-11 shrink-0 cursor-pointer items-center justify-center border text-sm leading-none transition-colors duration-200 wide:size-8"
    >
      <span aria-hidden>{glyph}</span>
    </button>
  )
}
