import raw from '../assets/sample_aknowledgement.txt?raw'

/**
 * The member acknowledgement: the club's safety, equipment, conduct and dues rules, agreed to while
 * an account is being created.
 *
 * The words are imported from `src/assets/sample_aknowledgement.txt` rather than retyped here,
 * which is why this file is a parser instead of a literal. Two copies of an agreement is one copy
 * nobody is being held to, and this is the one document on the site where the version somebody
 * accepted and the version somebody edited have to be the same text. An officer changing the rules
 * edits a plain text file and nothing else.
 *
 * The shape expected is the shape the file already has — an opening paragraph, then numbered
 * sections, one blank line between each. Hard line wraps inside a block are the text editor's, not
 * the author's, so they close up into a paragraph. A block whose first line is not numbered is
 * still rendered, whole and untitled: dropping a clause because it was formatted unexpectedly is
 * the one failure this must not have.
 */

export type AcknowledgementSection = {
  /** "1", "2", … Empty when the block carried no number. */
  number: string
  title: string
  body: string
}

/** Close up the editor's line wrapping into one paragraph. */
const unwrap = (block: string) =>
  block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')

const [opening = '', ...rest] = raw.trim().split(/\r?\n[ \t]*\r?\n/)

export const acknowledgementIntro = unwrap(opening)

export const acknowledgementSections: AcknowledgementSection[] = rest.map(
  (block) => {
    const [firstLine = '', ...bodyLines] = block.split(/\r?\n/)
    const heading = /^(\d+)\.\s+(.+)$/.exec(firstLine.trim())

    if (!heading) return { number: '', title: '', body: unwrap(block) }

    return {
      number: heading[1],
      title: heading[2],
      body: unwrap(bodyLines.join('\n')),
    }
  },
)
