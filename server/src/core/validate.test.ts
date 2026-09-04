import { describe, expect, it } from 'vitest'
import { PROFILE_HOSTS, profileAddress } from './validate.js'

/**
 * The profile-link allowlist, which is the one check on this API standing between a member's typing
 * and an `href` on a public page with several hundred faces on it.
 *
 * Everything here is a refusal that has to keep being a refusal. Asserting on the zod error would
 * say the same thing far less clearly, which is why `profileAddress` is exported and tested
 * directly — the schema around it is three lines and has nothing of its own to get wrong.
 *
 * It needs no database and no app: this file is pure.
 */
describe('profileAddress', () => {
  it('takes an address the way somebody pastes it', () => {
    // No scheme, because no browser has shown one since about 2018 and this is
    // what comes off the address bar.
    expect(profileAddress('linkedin.com/in/someone')).toBe(
      'https://linkedin.com/in/someone',
    )
    expect(profileAddress('https://github.com/someone')).toBe(
      'https://github.com/someone',
    )
    // A subdomain of a listed host counts — `uk.linkedin.com` and somebody's
    // own `name.medium.com` are the cases that buys.
    expect(profileAddress('https://www.linkedin.com/in/someone/')).toBe(
      'https://www.linkedin.com/in/someone/',
    )
  })

  /** A query is kept, and it has to be: `facebook.com/profile.php?id=…` is a
      real profile address and dropping it would store a link to nobody. */
  it('keeps a query string', () => {
    expect(profileAddress('facebook.com/profile.php?id=1234')).toBe(
      'https://facebook.com/profile.php?id=1234',
    )
  })

  /** Typed `http` is a habit rather than a statement — every host on the list
      has been https-only for years and would redirect anyway. */
  it('upgrades http rather than refusing it', () => {
    expect(profileAddress('http://github.com/someone')).toBe(
      'https://github.com/someone',
    )
  })

  it('refuses a scheme that is not the web', () => {
    // The half of this that is about the club's own markup rather than about
    // where the link goes.
    expect(profileAddress('javascript:alert(1)')).toBeNull()
    expect(profileAddress('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(profileAddress('mailto:someone@ucf.edu')).toBeNull()
    expect(profileAddress('ftp://github.com/someone')).toBeNull()
  })

  it('refuses a host that is not on the list', () => {
    expect(profileAddress('https://example.com/someone')).toBeNull()
    expect(profileAddress('https://free-robux.example/claim')).toBeNull()
    // The lookalike, which is the whole reason this is a list rather than a
    // parse: it is a perfectly well-formed URL.
    expect(profileAddress('https://linkedin.com.evil.example/in/someone')).toBeNull()
    // And the other direction — a listed name as a *path* on somebody else's
    // host buys nothing.
    expect(profileAddress('https://evil.example/linkedin.com/in/someone')).toBeNull()
  })

  /**
   * `https://linkedin.com@evil.example/` is a link to `evil.example` that reads as LinkedIn to
   * anybody checking it by eye. The host check refuses it on its own — `new URL` sees through it —
   * and credentials are refused outright anyway, because an address that displays as something it
   * is not has no honest use in this column.
   */
  it('refuses credentials in the authority', () => {
    expect(profileAddress('https://linkedin.com@evil.example/in/someone')).toBeNull()
    expect(profileAddress('https://user:pw@github.com/someone')).toBeNull()
  })

  it('refuses a port', () => {
    expect(profileAddress('https://github.com:8080/someone')).toBeNull()
  })

  /** A unicode lookalike is punycode by the time the list sees it, which is the
      case a naive string comparison on the typed text would miss. */
  it('refuses a homograph of a listed host', () => {
    expect(profileAddress('https://liñkedin.com/in/someone')).toBeNull()
  })

  it('refuses what is not an address at all', () => {
    expect(profileAddress('')).toBeNull()
    expect(profileAddress('   ')).toBeNull()
    expect(profileAddress('not a url')).toBeNull()
  })

  /**
   * The property that keeps the list safe, asserted rather than trusted: a host
   * whose subdomains are handed out to anybody — `github.io`, `pages.dev` — puts
   * the allowlist back where it started, because `anything.github.io` would pass.
   */
  it('lists no host that hands out arbitrary subdomains', () => {
    const openHosting = ['github.io', 'pages.dev', 'vercel.app', 'netlify.app']

    for (const host of openHosting) {
      expect(PROFILE_HOSTS).not.toContain(host)
    }
  })
})
