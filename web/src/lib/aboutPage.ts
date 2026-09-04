/**
 * What the about page's editor may offer, mirrored off the routes that enforce it.
 *
 * The same contract as `frontPage.ts` beside this file: the real limits are `MAX_STORY` and
 * `MAX_MILESTONES` in `server/src/routes/officer/aboutPage.ts`, and a form that offers what the
 * route refuses is the failure the convention prevents. Change one and change the other.
 */

/** How many paragraphs the story may run to. The layout is built around three. */
export const MAX_STORY = 6

/** How many lines the timeline may carry. It shipped with five. */
export const MAX_MILESTONES = 12
