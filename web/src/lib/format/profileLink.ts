/**
 * Naming the place a member's photograph points at.
 *
 * The link itself is checked on the server — an allowlist of known platforms in
 * `server/src/core/validate.ts`, because `User.profileUrl` is the one public
 * address an ordinary member types. Nothing here re-checks it and nothing here
 * should: a second copy of that list in the browser is a second answer to
 * "what is allowed", and the one that matters is the one the database is
 * written through.
 *
 * What the browser needs is different and much smaller. The photograph is
 * decorative — the person's name is printed directly under it, so announcing
 * the image would read them out twice — and wrapping it in a link means the
 * link now needs a name of its own. "Jane Doe on LinkedIn" is that name, and
 * this is the second half of it.
 */

/**
 * The platforms worth spelling properly, in the capitalisation they use
 * themselves.
 *
 * Deliberately **not** the server's list. It is a display detail with a working
 * fallback, so a host missing from here is a link labelled `hackster.io`
 * instead of `Hackster` — which is fine, and is the trade that keeps this from
 * being a copy of the allowlist that has to be kept level with it. Only add a
 * host when the bare domain reads badly.
 */
const NAMES: Record<string, string> = {
  'linkedin.com': 'LinkedIn',
  'github.com': 'GitHub',
  'gitlab.com': 'GitLab',
  'stackoverflow.com': 'Stack Overflow',
  'instagram.com': 'Instagram',
  'facebook.com': 'Facebook',
  'x.com': 'X',
  'twitter.com': 'X',
  'threads.net': 'Threads',
  'threads.com': 'Threads',
  'bsky.app': 'Bluesky',
  'youtube.com': 'YouTube',
  'tiktok.com': 'TikTok',
  'twitch.tv': 'Twitch',
  'reddit.com': 'Reddit',
  'medium.com': 'Medium',
  'behance.net': 'Behance',
  'dribbble.com': 'Dribbble',
  'devpost.com': 'Devpost',
  'orcid.org': 'ORCID',
}

/**
 * What to call the site a profile link goes to.
 *
 * The last two labels of the host, so `www.linkedin.com` and `uk.linkedin.com`
 * both find LinkedIn and somebody's own `name.medium.com` finds Medium. That is
 * wrong for a two-part suffix — `example.co.uk` would look up `co.uk` — and it
 * does not matter: the miss falls through to the host itself, which is the
 * honest label for a site this does not know.
 *
 * Returns null for an address that will not parse, which is the browser's cue
 * to draw the photograph without a link rather than one that goes nowhere. The
 * server cannot store such a value, so this is a guard against a hand-edited
 * row rather than an expected state.
 */
export function profileSiteName(url: string): string | null {
  let host: string

  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }

  const registrable = host.split('.').slice(-2).join('.')

  return NAMES[registrable] ?? host.replace(/^www\./, '')
}
