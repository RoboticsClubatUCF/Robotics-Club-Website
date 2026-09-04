import { describe, expect, it } from 'vitest'
import { coverOf } from './projectCover'
import type { ApiProjectImage } from '../api/api'
import { DEFAULT_FRAMING } from '../media/imageFraming'

const picture = (id: string): ApiProjectImage => ({
  id,
  url: `/api/files/${id}`,
  caption: null,
  ...DEFAULT_FRAMING,
})

const project = (over: Partial<Parameters<typeof coverOf>[0]> = {}) => ({
  coverUrl: null,
  coverFromGallery: false,
  coverFocalX: 50,
  coverFocalY: 50,
  coverZoom: 1,
  images: [],
  ...over,
})

/**
 * The whole point of these is the absence of a fallback. A chain that tried the gallery when there
 * was no cover, or the cover when the gallery was empty, would make "why is the wrong picture on
 * the projects list" unanswerable from the checkbox that set it — and would mean reordering a
 * gallery silently changed the listing image, which is what `coverUrl` exists to prevent.
 */
describe('coverOf', () => {
  it('takes the first gallery picture when the box is ticked', () => {
    expect(
      coverOf(
        project({
          coverFromGallery: true,
          images: [picture('one'), picture('two')],
        }),
      ),
    ).toEqual(picture('one'))
  })

  it('takes the chosen cover, with its own framing, when it is not', () => {
    expect(
      coverOf(
        project({
          coverUrl: 'https://example.test/rover.png',
          coverFocalX: 20,
          coverFocalY: 80,
          coverZoom: 2,
          images: [picture('one')],
        }),
      ),
    ).toEqual({
      id: 'cover',
      url: 'https://example.test/rover.png',
      caption: null,
      focalX: 20,
      focalY: 80,
      zoom: 2,
    })
  })

  it('does not fall back to the cover when the gallery is empty', () => {
    expect(
      coverOf(
        project({
          coverFromGallery: true,
          coverUrl: 'https://example.test/rover.png',
          images: [],
        }),
      ),
    ).toBeNull()
  })

  it('does not fall back to the gallery when there is no cover', () => {
    expect(
      coverOf(project({ coverFromGallery: false, images: [picture('one')] })),
    ).toBeNull()
  })

  it('is null when there is neither', () => {
    expect(coverOf(project())).toBeNull()
  })

  /** The listing route sends no `images` at all unless asked, and a card that
      threw on that would take the whole page down. */
  it('survives a row with no images field', () => {
    expect(
      coverOf({ ...project({ coverFromGallery: true }), images: undefined }),
    ).toBeNull()
  })
})
