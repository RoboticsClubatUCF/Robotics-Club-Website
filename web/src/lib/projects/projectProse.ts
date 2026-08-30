/**
 * What a paragraph break is in a project's write-up, and how to flatten one.
 *
 * The markup lives in `components/projects/ProjectProse.tsx`; this is the half
 * that can be tested without a DOM, the same split `projectGallery.ts` makes.
 *
 * The schema calls `description` markdown, but nothing has shipped a renderer
 * and every row the club has written is plain prose. **If real markdown ever
 * lands in that column, this file and that component are where it goes** — the
 * note used to say "this is the spot", back when only a project's own page
 * printed the column, and then the projects list needed it too.
 */

/** A blank line or more. */
const BREAK = /\n{2,}/

/** The write-up, split into the paragraphs it will be set as. */
export function proseParagraphs(description: string): string[] {
  return description.split(BREAK)
}

/**
 * The same write-up run together as one line, for a list row that has room for
 * a blurb and not for prose.
 *
 * The archive's rows are scanned downwards and its third column has always been
 * one blurb wide, so it clamps this rather than setting paragraphs. The clamp is
 * CSS and the whole string stays in the DOM, which is the point: what is cut is
 * cut visually, a screen reader still gets all of it, and the row links to the
 * page that sets it properly.
 */
export function proseExcerpt(description: string | null): string | null {
  return description === null ? null : proseParagraphs(description).join(' ')
}
