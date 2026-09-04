/**
 * A project's write-up, parsed.
 *
 * The schema has called `description` markdown since `0_init` and nothing ever shipped a
 * renderer, so the column was set as plain paragraphs. This is the renderer, and it lives here
 * rather than in a dependency for two reasons.
 *
 * It emits a tree, not HTML. `ProjectProse.tsx` turns these nodes into React elements, so there's
 * no `dangerouslySetInnerHTML` anywhere on the path. A write-up is typed by a lead and read by
 * the public, which is exactly the shape where an HTML-producing renderer becomes an XSS hole the
 * day somebody pastes something.
 *
 * The subset is what a build write-up actually uses: headings, paragraphs, lists, quotes, code,
 * rules, and inline bold/italic/code/links. `web/` carries ten runtime dependencies and a full
 * CommonMark implementation is forty packages to set six kinds of block.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: Inline[] }

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; children: Inline[] }
  | { kind: 'paragraph'; children: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'quote'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'rule' }

const HEADING = /^(#{1,3})\s+(.*)$/
const BULLET = /^[-*]\s+(.*)$/
const NUMBER = /^\d{1,9}[.)]\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/
const FENCE = /^```/

/**
 * Whether a link may be rendered as one.
 *
 * An allowlist rather than a blocklist, because the interesting schemes are the ones nobody
 * thinks of: `javascript:` is the obvious one, `data:` carries a whole document, and both are one
 * paste away in a field a lead types into. Anything else is printed as its own text, so nothing
 * is silently dropped. Relative paths stay relative.
 */
export function isSafeHref(href: string): boolean {
  const trimmed = href.trim()
  if (trimmed === '') return false
  // Relative, or the site's own root. No scheme to be wrong about.
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true
  return /^(?:https?:|mailto:)/i.test(trimmed)
}

/** Whether a link leaves the site, and therefore wants a new tab and a `rel`. */
export const isExternalHref = (href: string): boolean =>
  /^(?:https?:|mailto:)/i.test(href.trim())

/**
 * The write-up, as blocks.
 *
 * A line scanner rather than a grammar: every block here is recognised by how its first line
 * starts, and the only one that spans an unknown number of lines without a marker on each is a
 * paragraph, which ends at a blank line or at the start of anything else.
 */
export function parseProse(description: string): Block[] {
  // Windows line endings arrive from a textarea on this machine, and a stray
  // `\r` at the end of a line breaks every regex below by one character.
  const lines = description.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let at = 0

  while (at < lines.length) {
    const line = lines[at]

    if (line.trim() === '') {
      at += 1
      continue
    }

    // Fenced code. Everything to the closing fence is literal, including the
    // characters that would otherwise be markers — which is the whole point of
    // a fence, and why this is checked before anything else.
    if (FENCE.test(line.trim())) {
      const body: string[] = []
      at += 1
      while (at < lines.length && !FENCE.test(lines[at].trim())) {
        body.push(lines[at])
        at += 1
      }
      // Past the closing fence, or past the end for a fence never closed —
      // which is a half-typed write-up, not something to refuse.
      at += 1
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }

    if (RULE.test(line.trim())) {
      blocks.push({ kind: 'rule' })
      at += 1
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        children: parseInline(heading[2]),
      })
      at += 1
      continue
    }

    if (QUOTE.test(line)) {
      const body: string[] = []
      while (at < lines.length && QUOTE.test(lines[at])) {
        body.push(QUOTE.exec(lines[at])![1])
        at += 1
      }
      blocks.push({ kind: 'quote', children: parseInline(body.join('\n')) })
      continue
    }

    const ordered = NUMBER.test(line)
    if (ordered || BULLET.test(line)) {
      const items: Inline[][] = []
      // One kind of list at a time: a bullet directly under a number starts a
      // second list rather than joining this one, which is what the reader is
      // being shown anyway.
      const marker = ordered ? NUMBER : BULLET
      while (at < lines.length && marker.test(lines[at])) {
        items.push(parseInline(marker.exec(lines[at])![1]))
        at += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    // A paragraph, to the next blank line or the next block marker. Single
    // newlines inside it are kept and set as spaces, which is what markdown
    // does and what the column already held.
    const body: string[] = []
    while (at < lines.length && lines[at].trim() !== '' && !startsBlock(lines[at])) {
      body.push(lines[at])
      at += 1
    }
    blocks.push({ kind: 'paragraph', children: parseInline(body.join('\n')) })
  }

  return blocks
}

/** Whether a line would begin a block of its own, and so end a paragraph. */
const startsBlock = (line: string): boolean =>
  FENCE.test(line.trim()) ||
  RULE.test(line.trim()) ||
  HEADING.test(line) ||
  QUOTE.test(line) ||
  BULLET.test(line) ||
  NUMBER.test(line)

/**
 * Inline markup, in precedence order: code, links, bold, italic.
 *
 * Code comes first because its contents are literal — `` `**not bold**` `` has to survive — and
 * links come before emphasis so `[**bold link**](url)` nests the right way round.
 *
 * Anything unmatched is text. An unclosed `**` is the state of every write-up halfway through
 * being typed, so it prints as the asterisks it is rather than swallowing the rest.
 */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = []
  let text = ''

  const flush = () => {
    if (text !== '') {
      out.push({ kind: 'text', text })
      text = ''
    }
  }

  let at = 0
  while (at < source.length) {
    const rest = source.slice(at)

    const code = /^`([^`]+)`/.exec(rest)
    if (code) {
      flush()
      out.push({ kind: 'code', text: code[1] })
      at += code[0].length
      continue
    }

    const link = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest)
    if (link) {
      // An unsafe scheme is not an error and not silently dropped: the whole
      // thing prints as the text somebody typed, which is visible and fixable.
      if (isSafeHref(link[2])) {
        flush()
        out.push({
          kind: 'link',
          href: link[2].trim(),
          children: parseInline(link[1]),
        })
        at += link[0].length
        continue
      }
    }

    const strong = /^\*\*([^\s](?:[\s\S]*?[^\s])?)\*\*/.exec(rest)
    if (strong) {
      flush()
      out.push({ kind: 'strong', children: parseInline(strong[1]) })
      at += strong[0].length
      continue
    }

    // `_` only between non-word characters, so `snake_case_names` stay whole —
    // the club writes plenty of those and none of them mean italics.
    const em =
      /^\*([^\s*](?:[\s\S]*?[^\s*])?)\*/.exec(rest) ??
      (at === 0 || /\W/.test(source[at - 1])
        ? /^_([^\s_](?:[\s\S]*?[^\s_])?)_(?!\w)/.exec(rest)
        : null)
    if (em) {
      flush()
      out.push({ kind: 'em', children: parseInline(em[1]) })
      at += em[0].length
      continue
    }

    text += source[at]
    at += 1
  }

  flush()
  return out
}
