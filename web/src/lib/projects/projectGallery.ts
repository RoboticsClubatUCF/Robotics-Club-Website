import type { ApiProjectDetail, ApiProjectImage } from '../api/api'
import { DEFAULT_FRAMING } from '../media/imageFraming'

/**
 * The arithmetic behind a project's slideshow, kept out of the component so it
 * can be tested without a DOM.
 */

/**
 * How many pictures one project may show.
 *
 * Mirrors `MAX_PROJECT_IMAGES` in `server/src/routes/projects/projectManage.ts`, the way
 * `borrowing.ts` mirrors `loanWindow.ts` — the browser needs it to grey out ADD and say why, and a
 * form that offers what the route refuses is what that convention prevents. Change one and change
 * the other.
 *
 * Twelve is a gallery, not an archive: more than any club project has needed, and still under a
 * megabyte a page once the browser has downscaled them.
 */
export const MAX_PROJECT_IMAGES = 12

/** Ditto, for `MAX_PROJECT_LINKS`. */
export const MAX_PROJECT_LINKS = 10

/**
 * And ditto for `MAX_PROJECT_DOCUMENTS`, which lives beside the other two on
 * the server even though it has nothing to do with a slideshow — this file is
 * where a project's caps are mirrored, and splitting one of them out would make
 * it the one nobody remembers to keep in step.
 */
export const MAX_PROJECT_DOCUMENTS = 20

/**
 * How many slides are mounted at once: the current one and its two neighbours.
 *
 * The whole loading strategy, and a window rather than a `loading="lazy"` attribute for a reason.
 * The slides are stacked absolutely inside one frame, so every one of them is inside the viewport
 * as far as the browser is concerned and `lazy` defers precisely nothing — all twelve download on
 * first paint. Mounting three is both "do not fetch twelve" and "the next one is already there when
 * they press ›".
 */
export const SLIDE_WINDOW = 1

/**
 * What the slideshow actually shows.
 *
 * A project with a gallery shows its gallery. A project with only the old single cover shows that,
 * framed. A project with neither shows nothing.
 *
 * `coverUrl` deliberately survives beside the gallery rather than being folded into it: it is the
 * one image that represents the project in a list, chosen rather than "whichever got dragged to the
 * front", and making it the first slide would mean reordering the gallery silently changed the
 * listing image.
 */
export function slidesOf(
  project: Pick<ApiProjectDetail, 'images' | 'coverUrl'>,
): ApiProjectImage[] {
  if (project.images.length > 0) return project.images
  if (project.coverUrl) {
    // Centred, because a cover has no row to hold a framing on. Framing the
    // listing image is a separate feature and this is not a place to grow one.
    return [
      { id: 'cover', url: project.coverUrl, caption: null, ...DEFAULT_FRAMING },
    ]
  }
  return []
}

/** Whether a slide should be mounted, given where the reader is. */
export const inWindow = (index: number, current: number): boolean =>
  Math.abs(index - current) <= SLIDE_WINDOW

/** `03 / 07`, zero-padded so the counter does not change width as it counts. */
export const counterLabel = (index: number, total: number): string =>
  `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`

/**
 * One item moved one place, as a new array. Out-of-range moves return the list
 * untouched rather than throwing, so the caller can wire it straight to a
 * button whose disabled state it does not have to duplicate.
 */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to) return items
  if (from < 0 || from >= items.length) return items
  if (to < 0 || to >= items.length) return items

  const next = items.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
