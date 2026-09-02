import { getJson } from '../api/api'

/**
 * The two reads behind `/projects`, and the one thing an editor has to do to
 * them.
 *
 * They live here rather than in `ProjectsSection` because a *second* page cares
 * about the exact strings: the public content routes answer with
 * `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600`,
 * which is the point of them and is right for the ninety-nine visitors in a
 * hundred who are only reading. It is wrong for the hundredth, who has just
 * changed the thing:
 *
 * - inside the minute, `/projects` is answered from the browser's own cache with
 *   the copy from before the save;
 * - and after it, `stale-while-revalidate` lets the browser serve the stale
 *   entry *once more* while it refetches in the background.
 *
 * Which is exactly the complaint — "it takes a couple of goes before the new
 * picture shows up" — and it is the cache working as designed rather than a save
 * that failed. The fixes at the other end are both worse: a shorter window makes
 * the whole public site pay for one page's editor, and `?t=${Date.now()}` defeats
 * caching for good rather than for one request.
 *
 * So the editor tells the cache instead. See `refreshProjectListing`.
 */

/**
 * How many rows the list asks for. There are 53 projects and the count only goes
 * up, so this is "all of them" with room — paging a list this size would be more
 * machinery than the page has content, and the day it isn't, this is the one
 * place to notice.
 */
const LIMIT = 100

/**
 * This semester's builds, with the one picture each of them shows.
 * `term=current` is computed on the server — the browser has no way of knowing
 * which term it is, and a page that guessed would go quietly empty every August.
 *
 * **`cover=true` rather than `images=true`.** A card is a still, not a
 * slideshow, so it wants one picture per project and the flag caps the gallery
 * at one row. Twelve times the payload for eleven pictures nothing draws is
 * exactly what the flag exists to avoid.
 *
 * **And no `description=true`.** The list prints `summary` and only `summary`.
 */
export const CURRENT_PROJECTS = `/projects?term=current&cover=true&limit=${LIMIT}`

/** Everything that is not this semester, newest term first. No pictures and no
    write-up: forty galleries is not a list anybody scrolls, and the archive's
    third column has always been one blurb wide. */
export const ARCHIVED_PROJECTS = `/projects?term=other&limit=${LIMIT}`

/**
 * Re-reads both listings past the browser's cache, and leaves the answers *in*
 * it.
 *
 * Called after a successful save in the project editor, and that is the whole
 * design: the person who just changed a cover is the one person for whom the
 * cached copy is wrong, and they are about to go and look at it.
 *
 * **`reload` rather than `no-store`, and the difference is the point.** Both skip
 * the cache on the way out; only `reload` writes what comes back into it. With
 * `no-store` the stale entry survives the refetch, so this would cost two
 * requests and change nothing about the page the lead visits next. `getJson`'s
 * `fresh` flag is the same mechanism the project page uses on the way out of
 * edit mode, and it is documented there.
 *
 * Nothing is done with the answers and nothing is thrown. This is a courtesy to
 * the next navigation; a failed warm-up leaves the cache exactly as it would have
 * been, which is where this started.
 */
export async function refreshProjectListing(): Promise<void> {
  await Promise.allSettled([
    getJson(CURRENT_PROJECTS, undefined, true),
    getJson(ARCHIVED_PROJECTS, undefined, true),
  ])
}
