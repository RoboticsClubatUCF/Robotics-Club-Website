import { proseParagraphs } from '../../lib/projects/projectProse'

/**
 * A project's write-up, as paragraphs.
 *
 * A component rather than four lines of `.split()` on each page that prints it,
 * because there are two of those now: a project's own page and the projects
 * list. `lib/projects/projectProse.ts` holds what a paragraph break is, and is where a
 * real markdown renderer would go.
 *
 * It is also, in practice, the only prose a project has. `summary` is the field
 * meant for a list — "one-liner for cards", says the schema — and no project the
 * club has ever created has filled one in.
 */
export function ProjectProse({
  description,
  className,
}: {
  description: string | null
  /**
   * How one paragraph is set, including the space above it — the margin is on
   * every paragraph rather than between them, so the first one is also spaced
   * off whatever it follows. A project's own page reads at `mt-5`; a card in a
   * list is tighter than that.
   */
  className: string
}) {
  if (!description) return null

  return (
    <>
      {proseParagraphs(description).map((paragraph, index) => (
        <p key={index} className={className}>
          {paragraph}
        </p>
      ))}
    </>
  )
}
