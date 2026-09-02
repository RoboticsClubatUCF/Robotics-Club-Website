import { describe, expect, it } from 'vitest'
import { isSafeHref, parseInline, parseProse } from './projectProse'

const text = (value: string) => ({ kind: 'text', text: value })

describe('parseProse', () => {
  it('sets a blank line as a paragraph break', () => {
    expect(parseProse('One.\n\nTwo.')).toEqual([
      { kind: 'paragraph', children: [text('One.')] },
      { kind: 'paragraph', children: [text('Two.')] },
    ])
  })

  /** Markdown's own rule, and the one the column already held: a single newline
      inside a paragraph is a space, not a break. */
  it('keeps a single newline inside one paragraph', () => {
    expect(parseProse('One,\nstill one.')).toEqual([
      { kind: 'paragraph', children: [text('One,\nstill one.')] },
    ])
  })

  it('collapses a run of blank lines', () => {
    expect(parseProse('One.\n\n\n\nTwo.')).toHaveLength(2)
  })

  it('reads the three heading levels', () => {
    expect(parseProse('# One\n## Two\n### Three')).toEqual([
      { kind: 'heading', level: 1, children: [text('One')] },
      { kind: 'heading', level: 2, children: [text('Two')] },
      { kind: 'heading', level: 3, children: [text('Three')] },
    ])
  })

  it('reads both kinds of list', () => {
    expect(parseProse('- one\n- two')).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: [[text('one')], [text('two')]],
      },
    ])
    expect(parseProse('1. one\n2. two')).toEqual([
      {
        kind: 'list',
        ordered: true,
        items: [[text('one')], [text('two')]],
      },
    ])
  })

  it('ends a paragraph at a block that follows it without a blank line', () => {
    expect(parseProse('Prose.\n- one')).toEqual([
      { kind: 'paragraph', children: [text('Prose.')] },
      { kind: 'list', ordered: false, items: [[text('one')]] },
    ])
  })

  it('reads a quote, joining its lines', () => {
    expect(parseProse('> one\n> two')).toEqual([
      { kind: 'quote', children: [text('one\ntwo')] },
    ])
  })

  it('reads a rule', () => {
    expect(parseProse('---')).toEqual([{ kind: 'rule' }])
  })

  /**
   * The whole point of a fence: everything inside it is literal, including the
   * characters that are markers everywhere else. A write-up pasting a snippet
   * of the rover's config must not have it parsed as headings and bullets.
   */
  it('takes a fenced block literally', () => {
    expect(parseProse('```\n# not a heading\n- not a list\n```')).toEqual([
      { kind: 'code', text: '# not a heading\n- not a list' },
    ])
  })

  /** Half-typed is the state every write-up passes through, so an unclosed
      fence runs to the end rather than refusing or losing the text. */
  it('closes an unclosed fence at the end', () => {
    expect(parseProse('```\nstill code')).toEqual([
      { kind: 'code', text: 'still code' },
    ])
  })

  /** A textarea on Windows sends these, and a stray `\r` puts every marker one
      character off. */
  it('survives carriage returns', () => {
    expect(parseProse('# One\r\n\r\nTwo.')).toEqual([
      { kind: 'heading', level: 1, children: [text('One')] },
      { kind: 'paragraph', children: [text('Two.')] },
    ])
  })

  it('has nothing to say about an empty write-up', () => {
    expect(parseProse('')).toEqual([])
    expect(parseProse('\n\n  \n')).toEqual([])
  })
})

describe('parseInline', () => {
  it('reads bold, italic and code', () => {
    expect(parseInline('**a** *b* `c`')).toEqual([
      { kind: 'strong', children: [text('a')] },
      text(' '),
      { kind: 'em', children: [text('b')] },
      text(' '),
      { kind: 'code', text: 'c' },
    ])
  })

  it('reads a link, and lets it carry emphasis', () => {
    expect(parseInline('[**the doc**](https://example.test/d)')).toEqual([
      {
        kind: 'link',
        href: 'https://example.test/d',
        children: [{ kind: 'strong', children: [text('the doc')] }],
      },
    ])
  })

  /** Code is literal, which is what makes it worth having at all. */
  it('does not read markup inside code', () => {
    expect(parseInline('`**not bold**`')).toEqual([
      { kind: 'code', text: '**not bold**' },
    ])
  })

  /** The club writes plenty of these and none of them mean italics. */
  it('leaves snake_case alone', () => {
    expect(parseInline('meeting_start_time')).toEqual([
      text('meeting_start_time'),
    ])
  })

  /** Unclosed markers are what somebody halfway through typing has, so they
      print as themselves rather than swallowing the rest of the paragraph. */
  it('prints an unclosed marker as itself', () => {
    expect(parseInline('a ** b')).toEqual([text('a ** b')])
  })

  /**
   * **The one that matters.** An unsafe scheme is not rendered as a link and is
   * not silently dropped either — it prints as the text somebody typed, which
   * is visible and fixable.
   */
  it('refuses to link a javascript: url', () => {
    expect(parseInline('[click](javascript:alert(1))')).toEqual([
      text('[click](javascript:alert(1))'),
    ])
  })

  it('refuses to link a data: url', () => {
    const source = '[x](data:text/html;base64,PHNjcmlwdD4=)'
    expect(parseInline(source)).toEqual([text(source)])
  })
})

describe('isSafeHref', () => {
  it('allows the schemes a write-up has any business using', () => {
    expect(isSafeHref('https://example.test')).toBe(true)
    expect(isSafeHref('http://example.test')).toBe(true)
    expect(isSafeHref('mailto:board@rccf.club')).toBe(true)
    expect(isSafeHref('/projects/rover')).toBe(true)
  })

  it('refuses everything else', () => {
    expect(isSafeHref('javascript:alert(1)')).toBe(false)
    expect(isSafeHref('data:text/html,<script>')).toBe(false)
    expect(isSafeHref('//evil.test')).toBe(false)
    expect(isSafeHref('')).toBe(false)
  })

  /** Case and leading space are not a way past the allowlist. */
  it('is not fooled by case or padding', () => {
    expect(isSafeHref('  JavaScript:alert(1)')).toBe(false)
    expect(isSafeHref('  https://example.test')).toBe(true)
  })
})
