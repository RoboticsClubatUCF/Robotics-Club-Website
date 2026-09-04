import type { ApiProject, ApiProjectImage } from '../api/api'

/**
 * Which picture stands for a project in a list, and how it is framed.
 *
 * `/projects` draws one still per project rather than a slideshow, so exactly one answer has to
 * come out of four columns. This is the only place they are read together — the card, the editor's
 * preview and its checkbox all go through here, so what the form promises and what the list shows
 * cannot drift.
 *
 * Neither side falls back to the other, and that is the design. Ticked, the cover is the gallery's
 * first picture and `coverUrl` is not consulted; unticked it is `coverUrl` and the gallery is not.
 * A quiet fallback would make "why is the wrong photo on the list" unanswerable from the control
 * that set it — and it is why `coverUrl` survived beside the gallery in the first place: reordering
 * pictures must not silently change the listing image.
 *
 * Returning an `ApiProjectImage` rather than a bare URL is what lets a caller hand the result
 * straight to `frameStyle`. The synthetic `id` is never sent anywhere; it exists because the shape
 * has one.
 */
export function coverOf(
  project: Pick<
    ApiProject,
    'coverUrl' | 'coverFromGallery' | 'coverFocalX' | 'coverFocalY' | 'coverZoom'
  > & { images?: ApiProjectImage[] },
): ApiProjectImage | null {
  if (project.coverFromGallery) return project.images?.[0] ?? null

  if (project.coverUrl) {
    return {
      id: 'cover',
      url: project.coverUrl,
      caption: null,
      // The project's own three, not a gallery row's. `safeFraming` still runs
      // at render, so a `NaN` out of the database cannot blank the card.
      focalX: project.coverFocalX,
      focalY: project.coverFocalY,
      zoom: project.coverZoom,
    }
  }

  return null
}
