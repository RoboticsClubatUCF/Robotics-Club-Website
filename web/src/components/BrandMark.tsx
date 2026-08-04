import logoUrl from '../assets/rccf-logo.png'

/**
 * The club mark. The source artwork is black on transparent, so it is inverted
 * to sit on the dark page — one file serves both, and the day a light surface
 * needs the mark the original is already the right colour.
 *
 * Always decorative: every place it appears, the club's name is spelled out in
 * text right next to it, so announcing it again would just be noise.
 */
export function BrandMark({ className }: { className?: string }) {
  return <img src={logoUrl} alt="" aria-hidden className={`invert ${className ?? ''}`} />
}
