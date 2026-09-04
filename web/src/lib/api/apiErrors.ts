import { ApiError } from './api'

/**
 * A failed write, as a sentence somebody can act on.
 *
 * This was written out twice, near-identically, in `ProjectManagePage` and `OfficerProjectsPage`.
 * The public page's editor would have been the third copy, which is the point at which it moves.
 *
 * The order matters. A status the browser can explain better than the server can is handled here;
 * everything else defers to `error.detail`, which is the server's own wording — that is how "A
 * project shows up to 12 images" and the dues-lapsed sentence reach the reader intact rather than
 * being flattened into a generic apology.
 */
export function explainApiError(
  error: unknown,
  options: { forbidden?: string } = {},
): string {
  if (error instanceof ApiError) {
    // Status 0 is "the request never reached a server" — no status line came
    // back, so there is nothing the server could have said about it.
    if (error.status === 0) {
      return "We couldn't reach the server. Try again in a moment."
    }
    if (error.status === 429) return 'Too many changes at once — give it a minute.'
    // Only when the caller has a better sentence than the server's. The dues
    // refusal is the case where the server's is much better, so pages that can
    // hit it leave this unset.
    if (error.status === 403 && options.forbidden) return options.forbidden
    if (error.detail) return error.detail
  }

  return 'That change did not go through. Try again in a moment.'
}
