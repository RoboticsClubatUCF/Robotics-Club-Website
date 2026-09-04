import { describe, expect, it } from 'vitest'
import { apiBaseUrl } from '../api/api'
import { imageSrc, isStoredUpload, storedFileUrl } from './storedFiles'

/**
 * The asymmetry these exist to remove: an upload's address is root-relative and an external one is
 * absolute, so without `imageSrc` the first resolves against the page rather than the API and
 * silently never loads — while the second works perfectly. "Links display, uploads don't" is what
 * that looks like from the outside, and nothing in the console says why: the dev server answers
 * with `index.html` at a cheerful 200.
 */
describe('imageSrc', () => {
  it('puts the API origin in front of a stored upload', () => {
    expect(imageSrc('/api/files/abc123')).toBe(`${apiBaseUrl}/api/files/abc123`)
  })

  it('leaves an external URL exactly as it is', () => {
    const external = 'https://example.test/rover.png?size=large'
    expect(imageSrc(external)).toBe(external)
  })

  /** Never doubled, or the src becomes `http://…http://…`. */
  it('does not touch a URL that already carries an origin', () => {
    const absolute = `${apiBaseUrl}/api/files/abc123`
    expect(imageSrc(absolute)).toBe(absolute)
  })

  it('produces an absolute address', () => {
    expect(() => new URL(imageSrc('/api/files/abc123'))).not.toThrow()
  })
})

describe('isStoredUpload', () => {
  it('is true only for the prefix the server mints', () => {
    expect(isStoredUpload('/api/files/abc123')).toBe(true)
    expect(isStoredUpload('https://example.test/a.png')).toBe(false)
    // A lookalike hosted elsewhere is somebody else's, and deleting it here
    // must never be treated as deleting bytes of ours.
    expect(isStoredUpload('https://example.test/api/files/abc')).toBe(false)
  })
})

describe('storedFileUrl', () => {
  it('builds the same address from an id alone', () => {
    expect(storedFileUrl('abc123')).toBe(imageSrc('/api/files/abc123'))
  })
})
