/**
 * The arithmetic behind the front page's slideshow, kept out of the component
 * so it can be tested without a DOM.
 *
 * The sibling of `projectGallery.ts`, and deliberately not part of it: the two
 * slideshows differ in the one property everything else follows from. A project
 * gallery **stops at both ends** — its arrows disable, and `NN / NN` answering
 * "am I at the end" is half the point of the counter. This one **wraps**,
 * because it turns on its own and a slideshow that advanced to the last photo
 * and stopped would leave the hero on whatever picture happened to be last.
 *
 * `moveItem` is shared from that file rather than copied — reordering a list is
 * reordering a list.
 */

/**
 * How many photographs the hero may hold.
 *
 * Mirrors `MAX_HERO_SLIDES` in `server/src/routes/officer/heroSlides.ts`, the way
 * `projectGallery.ts` mirrors the gallery's twelve — the officer desk needs it
 * to grey out ADD and say why, and a form that offers what the route refuses is
 * the failure this convention exists to prevent. **Change one and change the
 * other.**
 */
export const MAX_HERO_SLIDES = 8

/**
 * How long each photograph is up for.
 *
 * Six seconds, which is long enough to actually look at a picture and short
 * enough that somebody reading the headline sees a second one. Under four it
 * reads as a flicker beside text somebody is trying to read; past about ten
 * nobody waits and the slideshow may as well be one photo.
 */
export const HERO_ADVANCE_MS = 6_000

/**
 * The next index, wrapping. `step` is +1 or -1.
 *
 * Total on purpose, and in both directions: a zero-length list returns 0 rather
 * than `NaN`, and an index already outside the list comes back inside it — which
 * is not hypothetical, because the officer desk renders the slideshow against a
 * list it is editing and a photograph can be deleted out from under the index.
 *
 * The modulo is written twice because once is not enough: `-4 % 3` is `-1` in
 * JavaScript, so a single `+ total` only corrects a value that had wrapped
 * exactly once and hands back a negative index for anything further out.
 */
export function stepIndex(current: number, step: number, total: number): number {
  if (total <= 0) return 0
  return (((current + step) % total) + total) % total
}

/**
 * Whether a slide should be mounted, given where the reader is.
 *
 * The current one and its two neighbours, **measured the short way round** —
 * which is the whole difference from the gallery's version. The slides are
 * stacked absolutely inside one frame, so every one of them is inside the
 * viewport as far as the browser is concerned and `loading="lazy"` defers
 * precisely nothing; mounting three is what stops eight photographs downloading
 * on the landing page. Wrapping the window is what makes the *first* slide
 * already there when the last one advances to it, which is a transition every
 * visitor who stays sees.
 */
export function inHeroWindow(
  index: number,
  current: number,
  total: number,
): boolean {
  if (total <= 0) return false
  const apart = Math.abs(index - current)
  return Math.min(apart, total - apart) <= 1
}

/**
 * Whether this browser has been asked to keep still.
 *
 * Read through a function rather than a constant because it is consulted on
 * mount and on change, and total for the same reason `theme.ts`'s query is: a
 * browser without `matchMedia` is a browser that answers no, not one that
 * throws. `false` is the right default — the site's global reduced-motion block
 * flattens the fade either way, so the worst an unanswerable query costs is a
 * slideshow that advances without animating.
 */
export const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches
