import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProjectGallery } from './ProjectGallery'
import { apiBaseUrl } from '../../lib/api/api'
import type { ApiProjectImage } from '../../lib/api/api'
import { DEFAULT_FRAMING } from '../../lib/media/imageFraming'

const slides = (count: number): ApiProjectImage[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `img-${index + 1}`,
    url: `/api/files/img-${index + 1}`,
    caption: `Caption ${index + 1}`,
    ...DEFAULT_FRAMING,
  }))

/**
 * jsdom applies no CSS, so an off-window slide would be just as queryable as
 * the visible one if it were mounted at all. Scoping to the frame is what makes
 * "three images" an assertion about the DOM rather than about styling.
 */
const framedImages = () =>
  within(screen.getByRole('group', { name: 'Project images' })).queryAllByRole(
    'img',
    { hidden: true },
  )

describe('ProjectGallery', () => {
  it('renders nothing when there are no pictures', () => {
    const { container } = render(<ProjectGallery slides={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  /**
   * The load-bearing one. Absolutely stacked slides are all "in the viewport",
   * so `loading="lazy"` defers nothing — only mounting a window of three does.
   */
  it('mounts only the current slide and its neighbours', () => {
    render(<ProjectGallery slides={slides(8)} />)

    const mounted = framedImages()
    expect(mounted).toHaveLength(2)
    // Absolute, because `imageSrc` resolves a stored upload against the API —
    // see the test below for why that matters.
    expect(mounted.map((img) => img.getAttribute('src'))).toEqual([
      `${apiBaseUrl}/api/files/img-1`,
      `${apiBaseUrl}/api/files/img-2`,
    ])
  })

  /**
   * An upload's address is root-relative, and the site and the API are different origins — so a
   * bare `src` resolves against this page and the dev server answers `index.html` at a 200, which
   * an `<img>` reports as a plain load failure. Uploads invisible, external links fine, nothing in
   * the console. `imageSrc` is the fix and this is what holds it in place.
   */
  it('resolves an upload against the API, and leaves an external URL alone', () => {
    render(
      <ProjectGallery
        slides={[
          // Captioned, because an `<img alt="">` is `role="presentation"` and
          // `framedImages` would not see it.
          { id: 'a', url: '/api/files/abc123', caption: 'Uploaded', ...DEFAULT_FRAMING },
          {
            id: 'b',
            url: 'https://example.test/b.png',
            caption: 'External',
            ...DEFAULT_FRAMING,
          },
        ]}
      />,
    )

    const [first, second] = framedImages()
    expect(first.getAttribute('src')).toBe(`${apiBaseUrl}/api/files/abc123`)
    expect(second.getAttribute('src')).toBe('https://example.test/b.png')

    // The thumbnails come off the same rule. Queried through the DOM rather
    // than by role: a thumbnail is always `alt=""`, since the slide beside it
    // has already said what the picture is.
    const thumb = screen
      .getByRole('button', { name: 'Image 1' })
      .querySelector('img')
    expect(thumb?.getAttribute('src')).toBe(`${apiBaseUrl}/api/files/abc123`)
  })

  /** It is the page's largest paintable element, so it says so rather than
      leaving the browser to guess. */
  it('loads the first slide eagerly and at high priority', () => {
    render(<ProjectGallery slides={slides(3)} />)

    const [first, second] = framedImages()
    expect(first).toHaveAttribute('loading', 'eager')
    expect(first).toHaveAttribute('fetchpriority', 'high')
    expect(second).toHaveAttribute('loading', 'lazy')
  })

  it('advances the counter and the caption on NEXT', () => {
    render(<ProjectGallery slides={slides(4)} />)

    expect(screen.getByRole('status')).toHaveTextContent('01 / 04')
    expect(screen.getByRole('status')).toHaveTextContent('Caption 1')

    fireEvent.click(screen.getByRole('button', { name: 'Next image' }))

    expect(screen.getByRole('status')).toHaveTextContent('02 / 04')
    expect(screen.getByRole('status')).toHaveTextContent('Caption 2')
  })

  /**
   * Disabled rather than wrapping: in a four-image gallery "am I at the end"
   * has to be answerable, and a dead arrow beside `04 / 04` answers it twice.
   */
  it('disables each arrow at its end of the list', () => {
    render(<ProjectGallery slides={slides(2)} />)

    const previous = screen.getByRole('button', { name: 'Previous image' })
    const next = screen.getByRole('button', { name: 'Next image' })

    expect(previous).toBeDisabled()
    expect(next).toBeEnabled()

    fireEvent.click(next)

    expect(previous).toBeEnabled()
    expect(next).toBeDisabled()
  })

  it('moves with the arrow keys, and jumps with Home and End', () => {
    render(<ProjectGallery slides={slides(5)} />)
    const frame = screen.getByRole('group', { name: 'Project images' })

    fireEvent.keyDown(frame, { key: 'ArrowRight' })
    expect(screen.getByRole('status')).toHaveTextContent('02 / 05')

    fireEvent.keyDown(frame, { key: 'End' })
    expect(screen.getByRole('status')).toHaveTextContent('05 / 05')

    fireEvent.keyDown(frame, { key: 'Home' })
    expect(screen.getByRole('status')).toHaveTextContent('01 / 05')

    fireEvent.keyDown(frame, { key: 'ArrowLeft' })
    expect(screen.getByRole('status')).toHaveTextContent('01 / 05')
  })

  it('jumps to a picture from its thumbnail', () => {
    render(<ProjectGallery slides={slides(5)} />)

    fireEvent.click(screen.getByRole('button', { name: 'Image 4' }))

    expect(screen.getByRole('status')).toHaveTextContent('04 / 05')
    expect(screen.getByRole('button', { name: 'Image 4' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  /** One picture is a picture, not a slideshow. */
  it('draws no controls for a single picture', () => {
    render(<ProjectGallery slides={slides(1)} />)

    expect(screen.queryByRole('button', { name: 'Next image' })).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Image 1' })).toBeNull()
    expect(framedImages()).toHaveLength(1)
  })
})
