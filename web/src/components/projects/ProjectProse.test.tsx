import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProjectProse } from './ProjectProse'

const show = (description: string | null) =>
  render(<ProjectProse description={description} className="mt-5" />)

describe('ProjectProse', () => {
  it('renders nothing for a project with no write-up', () => {
    const { container } = show(null)
    expect(container).toBeEmptyDOMElement()
  })

  it('sets paragraphs, headings and lists', () => {
    const { container } = show('# Rover\n\nThe build.\n\n- chassis\n- arm')

    expect(screen.getByRole('heading', { name: 'Rover' })).toBeInTheDocument()
    expect(screen.getByText('The build.')).toBeInTheDocument()
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  /**
   * Never an `h1` or `h2`, whatever the markdown says. On a project's page the
   * title is the `h1` and this prose sits under it, so a write-up that could
   * mint its own top-level heading would break the outline a screen reader
   * reads the page by.
   */
  it('starts its headings at h3', () => {
    show('# One\n## Two\n### Three')

    expect(screen.getByRole('heading', { name: 'One' }).tagName).toBe('H3')
    expect(screen.getByRole('heading', { name: 'Two' }).tagName).toBe('H4')
    expect(screen.getByRole('heading', { name: 'Three' }).tagName).toBe('H5')
  })

  it('sets bold, italic and code', () => {
    const { container } = show('**bold** *italic* `code`')

    expect(container.querySelector('strong')).toHaveTextContent('bold')
    expect(container.querySelector('em')).toHaveTextContent('italic')
    expect(container.querySelector('code')).toHaveTextContent('code')
  })

  /** An external link leaves the site the way `/ RESOURCES`' rows do, and
      carries the same `rel` — `noopener` is the one that matters. */
  it('opens an external link in a new tab, safely', () => {
    show('[the doc](https://example.test/d)')

    const link = screen.getByRole('link', { name: 'the doc' })
    expect(link).toHaveAttribute('href', 'https://example.test/d')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer noopener')
  })

  it('keeps a link to the site itself in the tab', () => {
    show('[the roster](/members)')

    const link = screen.getByRole('link', { name: 'the roster' })
    expect(link).toHaveAttribute('href', '/members')
    expect(link).not.toHaveAttribute('target')
  })

  /**
   * **The reason this renderer is written rather than installed.** A write-up is
   * typed by a lead and read by the public, so the path from that column to the
   * page must not be able to produce a scheme somebody chose. Nothing here goes
   * through `dangerouslySetInnerHTML`: the parser refuses the URL and the text
   * prints as itself, which is visible and fixable.
   */
  it('will not make a link out of a javascript: url', () => {
    show('[click me](javascript:alert(1))')

    expect(screen.queryByRole('link')).toBeNull()
    expect(
      screen.getByText('[click me](javascript:alert(1))'),
    ).toBeInTheDocument()
  })

  /** Raw HTML in the column is text, not markup. */
  it('does not render html written into the write-up', () => {
    const { container } = show('<img src=x onerror=alert(1)>')

    expect(container.querySelector('img')).toBeNull()
    expect(
      screen.getByText('<img src=x onerror=alert(1)>'),
    ).toBeInTheDocument()
  })

  it('sets a fenced block as code, markers and all', () => {
    const { container } = show('```\n# not a heading\n```')

    expect(screen.queryByRole('heading')).toBeNull()
    expect(container.querySelector('pre')).toHaveTextContent('# not a heading')
  })
})
