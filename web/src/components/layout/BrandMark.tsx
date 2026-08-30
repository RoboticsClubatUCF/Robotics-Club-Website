import logoUrl from '../../assets/rccf-logo.png'

/**
 * The club mark, straight from the master artwork — white on transparent, no
 * background of its own.
 *
 * **`light:invert` is the one place on the site where an `invert` is correct**,
 * and the comment that used to sit here banning it outright was right for as
 * long as there was one theme. The artwork is a single colour on transparency,
 * so inverting it gives black artwork on the same transparency — `invert()`
 * does not touch the alpha channel. There is deliberately no second asset: a
 * dark copy of the mark would be a file that has to be regenerated every time
 * the master changes, and the failure mode of forgetting is a logo that is
 * subtly the wrong shape in one theme.
 *
 * The consequence to know about is unchanged: because the file is transparent,
 * anything that composites it onto a background of its own gets a blank in one
 * theme or the other. Nothing on the site does. Where the background isn't ours
 * to choose — the browser tab — `public/favicon.svg` carries the same white
 * mark on a black disc, and it keeps that disc in both themes for exactly the
 * reason it had one to begin with.
 *
 * Always decorative: every place it appears, the club's name is spelled out in
 * text right next to it, so announcing it again would just be noise.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <img src={logoUrl} alt="" aria-hidden className={`light:invert ${className ?? ''}`} />
  )
}
