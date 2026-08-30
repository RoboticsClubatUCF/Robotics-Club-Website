import { frameStyle, type Framing } from '../../lib/media/imageFraming'
import { initialsOf } from '../../lib/format/initials'
import { imageSrc } from '../../lib/media/storedFiles'

/**
 * The signed-in person: their photograph, or a tile of their initials.
 *
 * **Square, not a circle.** Every other edge on this site is the theme's 2px
 * cut — `styling.md` is emphatic that the layout is built from straight rules
 * and right angles — and a round avatar would be the one curved thing in the
 * whole design. That was written when this drew initials and nothing else, and
 * a photograph inherits the same square.
 *
 * **The square is also why framing exists.** A headshot is not square, so
 * something is always cropped away; `object-cover` picks the middle, which
 * beheads about half the photographs a phone takes. The three numbers are the
 * member's own answer to that, chosen in `ImageFramer` against this exact
 * shape, and applied here as CSS at display time — never baked into the file.
 *
 * Two tones because it is drawn in two places that want opposite weights. The
 * nav bar's is `solid`: it replaced the gold call-to-action button and is the
 * only thing anchoring the right-hand end of the bar. The dashboard rail's is
 * `outline`, because the rail is a list of links and a filled gold square at
 * the top of it would out-shout every one of them. Neither tone shows once
 * there is a photograph: the picture is the whole tile.
 */
export function Avatar({
  fullName,
  photoUrl,
  framing,
  tone = 'solid',
  className = '',
}: {
  fullName: string
  /**
   * Their photo, or null for the initials. Passed through `imageSrc` here
   * rather than by every caller — an upload's address is root-relative and the
   * API is another origin, so a bare `src` gets `index.html` at a cheerful 200
   * and the browser reports a plain load failure with nothing in the console.
   */
  photoUrl?: string | null
  /**
   * How that photo sits in the square. Optional, and `frameStyle` is total, so
   * a caller that has the URL but not the numbers gets the centred crop this
   * always did rather than a broken style.
   */
  framing?: Partial<Framing> | null
  tone?: 'solid' | 'outline'
  className?: string
}) {
  const shared = `flex shrink-0 items-center justify-center overflow-hidden rounded-[2px] transition-colors duration-200 ${className}`

  if (photoUrl) {
    return (
      // The wrapper is what clips: `scale` on the image itself would otherwise
      // overflow the tile, and there is nothing on an `<img>` alone that both
      // enlarges it and keeps it inside its own box.
      <span aria-hidden className={`${shared} border-rule bg-base-200 relative border`}>
        <img
          src={imageSrc(photoUrl)}
          // Decorative in every place this is drawn: the person's name is
          // always beside it in text, and announcing it twice is noise on a
          // screen reader rather than information.
          alt=""
          draggable={false}
          style={frameStyle(framing)}
          className="absolute inset-0 h-full w-full"
        />
      </span>
    )
  }

  return (
    <span
      aria-hidden
      className={`${shared} font-mono font-semibold tracking-[0.04em] ${
        tone === 'solid'
          ? 'bg-primary text-primary-content'
          : 'border-primary/45 text-primary border'
      }`}
    >
      {initialsOf(fullName)}
    </span>
  )
}
