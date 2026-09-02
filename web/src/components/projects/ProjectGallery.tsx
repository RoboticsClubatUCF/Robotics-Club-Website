import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ApiProjectImage } from '../../lib/api/api'
import { frameStyle } from '../../lib/media/imageFraming'
import { counterLabel, inWindow } from '../../lib/projects/projectGallery'
import { imageSrc } from '../../lib/media/storedFiles'

/**
 * A project's pictures, one at a time.
 *
 * **It does not auto-advance, and that is the design rather than an omission.**
 * The site's rule is that movement can never be the only thing carrying
 * meaning, so anything that moved on its own would have to ship a second
 * behaviour for `prefers-reduced-motion` — plus a pause-on-hover-and-focus
 * contract and a timer that survives a backgrounded tab — for six build photos
 * somebody is looking at deliberately. With no ambient motion the rule is
 * satisfied by construction: the only animation here is a cross-fade in direct
 * response to a press, and the counter, the caption and the thumbnail highlight
 * all change alongside it, so flattening the fade (which the global
 * reduced-motion block in `index.css` does, with `!important`) loses nothing.
 *
 * Three slides are mounted at a time — see `SLIDE_WINDOW` in
 * `lib/projects/projectGallery.ts` for why `loading="lazy"` cannot do this job.
 */
export function ProjectGallery({
  slides,
  compact = false,
  priority = true,
  label = 'Project images',
  heading = 'GALLERY',
}: {
  slides: ApiProjectImage[]
  /**
   * Drops the `/ GALLERY` eyebrow and the thumbnail strip, and stops being a
   * landmark.
   *
   * The projects list draws one of these per project. Six regions all called
   * "Project gallery" is six landmarks that tell a screen reader nothing apart,
   * and six thumbnail strips is more chrome than pictures — the arrows and the
   * counter are the whole control there. A `<section>` with no accessible name
   * is not a landmark, which is what makes this one attribute rather than a
   * second element.
   */
  compact?: boolean
  /**
   * Whether this gallery's first slide is the page's largest paintable element.
   *
   * True on a project's own page, where there is exactly one gallery. The list
   * passes it for its first card and nothing else: `fetchPriority="high"` on
   * every card is the same as it on none, and it would put six full-size
   * photographs in front of the one the reader can actually see.
   */
  priority?: boolean
  /** The image group's accessible name. The list names the project, because
      "Project images" repeated down a page says nothing about any of them. */
  label?: string
  /**
   * The eyebrow's words, without the `/ ` — a project may call this section
   * whatever it likes. Ignored under `compact`, which draws no eyebrow at all.
   */
  heading?: string
}) {
  const [index, setIndex] = useState(0)
  // Where a drag started. Null between drags, and reset on cancel so a pointer
  // that leaves the frame mid-swipe doesn't arm the next tap.
  const [dragFrom, setDragFrom] = useState<{ x: number; y: number } | null>(null)

  if (slides.length === 0) return null

  const last = slides.length - 1
  // Guards the case where the list shrinks under an editor's delete: the index
  // is state, and clamping on read is cheaper than an effect that chases it.
  const current = Math.min(index, last)
  const single = slides.length === 1

  const go = (to: number) => {
    setIndex(Math.max(0, Math.min(last, to)))
  }

  /**
   * A swipe, if it was one. Horizontal *and* mostly horizontal, so scrolling
   * the page with a thumb that happens to start on the picture still scrolls
   * the page. Pointer events rather than touch events, so a trackpad drag works
   * the same way; if they never fire, the arrows are still there.
   */
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragFrom) return
    const dx = event.clientX - dragFrom.x
    const dy = event.clientY - dragFrom.y
    setDragFrom(null)

    if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return
    go(dx < 0 ? current + 1 : current - 1)
  }

  return (
    <section
      aria-label={compact ? undefined : 'Project gallery'}
      className={compact ? undefined : 'mb-8'}
    >
      {!compact && (
        <p className="mb-4 font-mono text-[13px] font-bold tracking-[0.2em] text-faint uppercase">
          / {heading}
        </p>
      )}

      {/* The frame owns the aspect ratio, so the box exists at its final size
          before a single byte arrives and does not move when one does —
          whatever the picture's own dimensions turn out to be. That is the
          whole layout-shift story, and it is why no image here carries a
          `width`/`height` attribute. The hatch shows through until a slide
          loads, and keeps showing if one never does. */}
      <div
        role="group"
        aria-label={label}
        tabIndex={0}
        onKeyDown={(event) => {
          const to =
            event.key === 'ArrowRight'
              ? current + 1
              : event.key === 'ArrowLeft'
                ? current - 1
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? last
                    : null
          if (to === null) return
          event.preventDefault()
          go(to)
        }}
        onPointerDown={(event) => {
          setDragFrom({ x: event.clientX, y: event.clientY })
        }}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          setDragFrom(null)
        }}
        className="bg-hatch border-rule focus-visible:outline-primary relative aspect-[16/10] w-full touch-pan-y overflow-hidden border focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {slides.map((slide, position) =>
          inWindow(position, current) ? (
            <Slide
              key={slide.id}
              slide={slide}
              lcp={position === 0 && priority}
              shown={position === current}
            />
          ) : null,
        )}
      </div>

      {!single && (
        <div className="mt-2.5 flex items-center gap-3">
          <Arrow
            label="Previous image"
            glyph="‹"
            disabled={current === 0}
            onClick={() => {
              go(current - 1)
            }}
          />
          <Arrow
            label="Next image"
            glyph="›"
            disabled={current === last}
            onClick={() => {
              go(current + 1)
            }}
          />

          {/* The one live region. The images themselves are not announced —
              this line says where the reader is and what they are looking at,
              once, as text. */}
          <p
            role="status"
            className="text-faint min-w-0 truncate font-mono text-[11px] font-medium tracking-[0.14em]"
          >
            {counterLabel(current, slides.length)}
            {slides[current].caption && (
              <span className="text-dim tracking-normal">
                {' · '}
                {slides[current].caption}
              </span>
            )}
          </p>
        </div>
      )}

      {!single && !compact && (
        /* A genuine horizontal scroller, unlike the frame above — so the rules
           between cells come from the container's background through a 1px gap,
           the strip idiom the rest of the site uses. */
        <ul className="bg-rule border-rule mt-2 flex gap-px overflow-x-auto border">
          {slides.map((slide, position) => (
            <li key={slide.id} className="shrink-0">
              <button
                type="button"
                aria-label={`Image ${position + 1}`}
                aria-current={position === current}
                onClick={() => {
                  go(position)
                }}
                className={`block h-14 w-20 cursor-pointer overflow-hidden bg-base-100 transition-opacity duration-200 ${
                  position === current ? 'opacity-100' : 'opacity-45 hover:opacity-80'
                }`}
              >
                {/* Framed like the slide it stands for, or the strip would
                    advertise a crop the frame does not show. */}
                <img
                  src={imageSrc(slide.url)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={frameStyle(slide)}
                  className="h-full w-full"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Slide({
  slide,
  lcp,
  shown,
}: {
  slide: ApiProjectImage
  /** Whether this is the picture the page will be judged on painting. */
  lcp: boolean
  shown: boolean
}) {
  const [loaded, setLoaded] = useState(false)

  return (
    <img
      /* Through `imageSrc`, or an upload's root-relative address resolves
         against this page instead of the API and silently never loads. */
      src={imageSrc(slide.url)}
      /* Empty when there is no caption, because a caption is printed under the
         frame and announcing it twice is worse than not announcing it. */
      alt={slide.caption ?? ''}
      /* The page's largest paintable element says so out loud rather than
         leaving the browser to guess. Everything else is honestly deferrable —
         though the mount window, not this attribute, is what actually stops
         eleven other pictures downloading. */
      loading={lcp ? 'eager' : 'lazy'}
      fetchPriority={lcp ? 'high' : 'auto'}
      /* So a decode never blocks the main thread at the moment the index
         changes, which is exactly when the page is being interacted with. */
      decoding="async"
      onLoad={() => {
        setLoaded(true)
      }}
      /* The lead's framing. `object-cover` lives in here rather than in the
         class list, because the two have to be set together — a class saying
         `object-cover` and a style saying `object-position` would put one rule
         where the reader can see it and the other where they cannot. */
      style={frameStyle(slide)}
      className={`absolute inset-0 h-full w-full transition-opacity duration-200 ${
        shown && loaded ? 'opacity-100' : 'opacity-0'
      }`}
      aria-hidden={!shown}
    />
  )
}

function Arrow({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string
  glyph: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      /* Disabled rather than wrapping. In a seven-image gallery "am I at the
         end" has to be answerable, and a dead arrow beside `07 / 07` answers it
         twice. Touch-sized below the breakpoint, per the site's rule. */
      className="border-rule text-dim enabled:hover:border-primary enabled:hover:text-primary flex size-11 shrink-0 cursor-pointer items-center justify-center border text-lg leading-none transition-colors duration-200 disabled:cursor-default disabled:opacity-30 wide:size-8"
    >
      {glyph}
    </button>
  )
}
