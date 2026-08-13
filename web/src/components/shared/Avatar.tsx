import { initialsOf } from '../../lib/initials'

/**
 * The signed-in person, as a tile of their initials.
 *
 * **Square, not a circle.** Every other edge on this site is the theme's 2px
 * cut — `styling.md` is emphatic that the layout is built from straight rules
 * and right angles — and a round avatar would be the one curved thing in the
 * whole design. It still reads as an avatar, and it will still read as one when
 * there is a photograph to put behind it.
 *
 * Two tones because it is drawn in two places that want opposite weights. The
 * nav bar's is `solid`: it replaced the gold call-to-action button and is the
 * only thing anchoring the right-hand end of the bar. The dashboard rail's is
 * `outline`, because the rail is a list of links and a filled gold square at
 * the top of it would out-shout every one of them.
 */
export function Avatar({
  fullName,
  tone = 'solid',
  className = '',
}: {
  fullName: string
  tone?: 'solid' | 'outline'
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-[2px] font-mono font-semibold tracking-[0.04em] transition-colors duration-200 ${
        tone === 'solid'
          ? 'bg-primary text-primary-content'
          : 'border-primary/45 text-primary border'
      } ${className}`}
    >
      {initialsOf(fullName)}
    </span>
  )
}
