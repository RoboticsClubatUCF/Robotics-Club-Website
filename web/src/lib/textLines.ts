/**
 * A list of short lines, as one box of text and back.
 *
 * Four things on this site are a `String[]` an officer writes: a sponsor tier's benefits, an FAQ
 * answer's numbered steps, the about page's story paragraphs and — the reason this moved out of
 * `sponsorship.ts` — any of the three being edited in a textarea rather than as a stack of inputs
 * with their own add and remove buttons. That is four times the chrome for something somebody
 * writes in one sitting and rarely touches again.
 *
 * Blank lines are dropped rather than refused: pressing enter twice while typing a list is not a
 * mistake worth an error message, and the schemas on the server trim and drop them too — so what
 * the box sends and what the route stores agree without either side knowing about the other.
 */
export const linesToText = (lines: string[]): string => lines.join('\n')

export const linesFromText = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

/**
 * The same, for prose rather than for a list.
 *
 * A paragraph is separated from the next by a blank line, the way somebody writing in a box
 * actually types — so a single newline inside one is a wrapped line rather than a new paragraph,
 * and dropping blank lines the way `linesFromText` does would glue the whole story into one block.
 */
export const paragraphsToText = (paragraphs: string[]): string =>
  paragraphs.join('\n\n')

export const paragraphsFromText = (text: string): string[] =>
  text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')
