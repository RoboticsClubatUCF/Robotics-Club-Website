import { describe, expect, it } from 'vitest'
import { profileSiteName } from './profileLink'

/**
 * What a profile link is called, which is the link's accessible name and
 * nothing more. The address itself was checked on the server; nothing here is
 * a second opinion about whether it is allowed.
 */
describe('profileSiteName', () => {
  it('names the platforms worth spelling properly', () => {
    expect(profileSiteName('https://www.linkedin.com/in/someone')).toBe('LinkedIn')
    expect(profileSiteName('https://github.com/someone')).toBe('GitHub')
    // A subdomain finds the same name, which is what `uk.linkedin.com` and
    // somebody's own `name.medium.com` need.
    expect(profileSiteName('https://uk.linkedin.com/in/someone')).toBe('LinkedIn')
    expect(profileSiteName('https://someone.medium.com/')).toBe('Medium')
  })

  /** A host this does not know is its own label. That is the fallback that
      keeps this from being a copy of the server's allowlist. */
  it('falls back to the host', () => {
    expect(profileSiteName('https://hackster.io/someone')).toBe('hackster.io')
    expect(profileSiteName('https://www.instructables.com/member/someone/')).toBe(
      'instructables.com',
    )
    expect(profileSiteName('https://scholar.google.com/citations?user=x')).toBe(
      'scholar.google.com',
    )
  })

  /** Null is the card's cue to draw the photograph without a link. The server
      cannot store an address this rejects, so it means a hand-edited row. */
  it('answers null for something that will not parse', () => {
    expect(profileSiteName('not a url')).toBeNull()
    expect(profileSiteName('')).toBeNull()
  })
})
