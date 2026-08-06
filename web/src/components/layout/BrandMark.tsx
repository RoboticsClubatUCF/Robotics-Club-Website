import logoUrl from '../../assets/rccf-logo.png'

/**
 * The club mark, straight from the master artwork — white on transparent, no
 * background of its own.
 *
 * That means no `invert` here: the site has one theme and it is dark, so the
 * artwork already arrives the colour it needs to be. Inverting it would put a
 * black mark on a near-black page, which reads as a broken file rather than as
 * a wrong class.
 *
 * The consequence to know about: because the file is transparent, anything that
 * composites it onto white gets a blank. Nothing on the site does. Where the
 * background isn't ours to choose — the browser tab — `public/favicon.svg`
 * carries the same white mark on a black disc of its own.
 *
 * Always decorative: every place it appears, the club's name is spelled out in
 * text right next to it, so announcing it again would just be noise.
 */
export function BrandMark({ className }: { className?: string }) {
  return <img src={logoUrl} alt="" aria-hidden className={className} />
}
