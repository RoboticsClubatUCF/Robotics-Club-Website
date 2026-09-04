import { useEffect, useState, type CSSProperties } from 'react'

/**
 * A one-off burst of confetti.
 *
 * Mount it and it runs once; it takes itself out of the DOM when the last piece has landed, so
 * there is nothing left animating behind the page afterwards.
 *
 * CSS rather than a canvas, and no dependency. Sixty absolutely positioned spans on a
 * compositor-only transform is cheap enough not to think about, a canvas would need a
 * `requestAnimationFrame` loop and a resize observer to do the same job, and `getContext` is not
 * implemented in jsdom.
 *
 * Rectangles, not circles: everything else on this site is a right angle.
 *
 * `motion-reduce:hidden` on the container and nothing else. Reduced motion is a preference this can
 * honour completely, because unlike the marquee or the FAQ disclosure there is nothing underneath
 * it — the celebration is the animation.
 */

const PIECES = 64

/** The longest a piece can be in flight: the biggest delay plus the longest
    fall, rounded up. The component unmounts itself after this. */
const LIFETIME_MS = 6_000

/** In palette, because a component is not where a colour gets invented. The
    gold, the ink and the darker gold — which is what the rest of the page is
    made of, in either theme. `bg-base-content` rather than `bg-white`: white
    confetti on an off-white page is a burst of nothing. */
const COLOURS = ['bg-primary', 'bg-base-content', 'bg-accent']

const between = (min: number, max: number) => min + Math.random() * (max - min)

const pick = <T,>(options: readonly T[]) =>
  options[Math.floor(Math.random() * options.length)]

function makePieces() {
  return Array.from({ length: PIECES }, (_, id) => ({
    id,
    colour: pick(COLOURS),
    /** Where across the width it starts. Drift moves it from there. */
    left: between(0, 100),
    width: between(4, 9),
    height: between(9, 16),
    duration: between(2.6, 4.2),
    /* Staggered, or all sixty fall as one sheet. Kept under a second and a half
       so the burst still reads as a single event. */
    delay: between(0, 1.4),
    drift: between(-14, 14),
    /* Direction as well as amount, so the burst isn't all spinning one way. */
    spin: between(-1080, 1080),
  }))
}

export function Confetti() {
  // Generated once. In the initializer rather than the body, so a re-render for
  // any other reason does not reshuffle a burst already halfway down the page.
  const [pieces] = useState(makePieces)
  const [finished, setFinished] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      setFinished(true)
    }, LIFETIME_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [])

  if (finished) return null

  return (
    <div
      /* Decoration in the truest sense: it carries nothing, so it is not
         announced. `pointer-events-none` because it covers the whole viewport,
         buttons included. */
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden motion-reduce:hidden"
    >
      {pieces.map((piece) => (
        <span
          key={piece.id}
          className={`animate-confetti absolute top-0 block ${piece.colour}`}
          style={
            {
              left: `${piece.left}%`,
              width: `${piece.width}px`,
              height: `${piece.height}px`,
              '--confetti-duration': `${piece.duration}s`,
              '--confetti-delay': `${piece.delay}s`,
              '--confetti-drift': `${piece.drift}vw`,
              '--confetti-spin': `${piece.spin}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}
