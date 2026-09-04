import { zValidator } from '@hono/zod-validator'
import type { ValidationTargets } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'

/**
 * What the API accepts, and what it says when it doesn't. Two things live here
 * because they're the same failure from both ends: a field somebody filled in the way
 * a person writes it, and the sentence that comes back when the schema disagrees.
 */

/**
 * A validator that refuses in the API's own voice.
 *
 * `zValidator`'s own refusal is unreadable by the time it reaches a form. It answers
 * `{ success: false, error: <ZodError> }`, and `explainApiError` in the browser only
 * lifts `error` when it's a string — so every schema failure on every form arrived as
 * "That change did not go through. Try again in a moment." An officer who typed
 * `example.com` into a website box was told to try again in a moment.
 *
 * Throwing an `HTTPException` puts it through `app.onError`, where every other 400 is
 * already shaped, so the answer is `{ error: '<sentence>' }` and the browser needs no
 * special case. The sentence names the field and carries the schema's own message.
 *
 * Import this rather than `@hono/zod-validator` directly; the call is otherwise
 * identical, and a route that imports the package straight is the one that will still
 * answer with an object.
 */
export const validate = <
  T extends Parameters<typeof zValidator>[1],
  Target extends keyof ValidationTargets,
>(
  target: Target,
  schema: T,
) =>
  zValidator(target, schema, (result) => {
    if (!result.success) {
      throw new HTTPException(400, { message: refusal(result.error) })
    }
  })

/**
 * A `ZodError` as one sentence.
 *
 * The first issue only. A body wrong in four ways is nearly always wrong in one way
 * that caused the other three, and a status line is one line.
 *
 * `path` is the field as the wire spells it (`websiteUrl`), not as the form labels it.
 * Close enough to act on, and the honest alternative is a second copy of the frontend
 * kept in the server. A field where that isn't close enough gets a written message on
 * the schema, which this prints instead of zod's.
 */
const refusal = (error: { issues: { path: PropertyKey[]; message: string }[] }) => {
  const [issue] = error.issues
  if (!issue) return 'That request was not in a shape this accepts.'

  const field = issue.path.join('.')

  return field === '' ? issue.message : `${field}: ${issue.message}`
}

/**
 * An address somebody pasted into a box.
 *
 * `z.url()` refuses `example.com`, and `example.com` is what people type. Every URL
 * field here is filled in by hand from a business card or an address bar, and the
 * address bar hasn't shown the scheme since about 2018. Refusing that is technically
 * correct and practically a trap.
 *
 * So the scheme is added when missing rather than demanded. `https`, because a site
 * that's still http-only will redirect. Everything else is left alone — this isn't a
 * parser, and a URL wrong past its scheme is somebody's typo rather than something to
 * guess at. What's stored is the corrected address, so the box shows
 * `https://example.com` next time it's opened.
 *
 * And the scheme is checked, which bare `z.url()` doesn't do: it accepts
 * `javascript:alert(1)` and `data:text/html,…` as perfectly good URLs, and every
 * column this guards is printed straight into an `href` or a `src` on a public page.
 * `hostname` is what turns the rest away — without it `https://not a url` is a host
 * called `not` with a path, which `new URL` happily accepts.
 */
export const webUrl = (max = 500) =>
  z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value

      const typed = value.trim()

      // Anything already carrying a scheme is left as it is — including the ones
      // refused below, which have to reach the check rather than be turned into
      // `https://javascript:alert(1)` on the way to it.
      return typed === '' || /^[a-z][a-z0-9+.-]*:/i.test(typed)
        ? typed
        : `https://${typed}`
    },
    z
      .url({
        protocol: /^https?$/,
        hostname: z.regexes.domain,
        error: 'that is not a web address',
      })
      .max(max),
  )

/**
 * The platforms somebody may point their own photograph at.
 *
 * An allowlist, because the alternative is a link farm. `profileUrl` is the only
 * column whose value is typed by an ordinary member and then printed straight into an
 * `href` on a public page with several hundred faces on it. A field that took any
 * address is somewhere to park a phishing page and have the club host the anchor.
 *
 * A subdomain of an entry counts, which lets `uk.linkedin.com` and somebody's own
 * `name.medium.com` through. That's safe for exactly as long as the list holds only
 * hosts whose subdomains belong to the platform or its users — so do not add a host
 * that hands out arbitrary pages under arbitrary names (`github.io`, `pages.dev`,
 * `vercel.app`).
 *
 * Two deliberate absences. The fediverse can't be allowlisted — a Mastodon account
 * lives on whichever of a thousand instances its owner picked — so the flagship one is
 * here and the rest are refused. And Discord isn't on it: the club already stores a
 * handle in a column of its own, checked against the real guild.
 */
export const PROFILE_HOSTS = [
  'linkedin.com',
  'github.com',
  'gitlab.com',
  'bitbucket.org',
  'stackoverflow.com',
  'codepen.io',
  'kaggle.com',
  'huggingface.co',
  'devpost.com',
  'hackster.io',
  'instructables.com',
  'orcid.org',
  'scholar.google.com',
  'behance.net',
  'dribbble.com',
  'medium.com',
  'substack.com',
  'instagram.com',
  'facebook.com',
  'x.com',
  'twitter.com',
  'threads.net',
  'threads.com',
  'bsky.app',
  'mastodon.social',
  'youtube.com',
  'tiktok.com',
  'twitch.tv',
  'reddit.com',
  'ucf.edu',
] as const

/** The sentence a refused address gets back. Three names and an honest "or another" —
    printing all thirty into a one-line status strip is not a help. */
export const NOT_A_PROFILE =
  'link to a profile on LinkedIn, GitHub, Instagram or another well-known site'

const onAllowedHost = (hostname: string) => {
  const host = hostname.toLowerCase()

  return PROFILE_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  )
}

/**
 * A social profile address, as somebody pastes it, or null if it isn't one.
 *
 * Exported for its own test rather than a second caller: everything this refuses has
 * to keep being refused, and asserting on a zod error is a worse way to say so.
 *
 * Each step answers something specific:
 *
 *   - The scheme is added when missing, same as `webUrl` and for the same reason.
 *   - `http` is accepted and upgraded rather than refused. Every host on the list has
 *     been https-only for years, so a typed `http://` is a habit.
 *   - Anything else — `javascript:`, `data:`, `mailto:` — is refused, which is the
 *     half of this about the club's own markup rather than where the link goes.
 *   - Credentials and a port are refused: `https://linkedin.com@evil.example/` reads
 *     as LinkedIn to anybody checking by eye.
 *   - The host is checked last, against the list. A unicode lookalike is punycode by
 *     the time it gets here, which is the case the list would otherwise miss.
 *
 * What comes back is the parsed address, never the typed one.
 */
export const profileAddress = (typed: string): string | null => {
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : `https://${typed}`

  let url: URL

  try {
    url = new URL(withScheme)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username !== '' || url.password !== '') return null
  if (url.port !== '') return null
  if (!onAllowedHost(url.hostname)) return null

  url.protocol = 'https:'

  return url.href
}

/**
 * The zod side of the above: refuse in the API's voice, store what came back.
 *
 * Shorter than `webUrl`'s cap on purpose. A profile address is a handle on the end of
 * a path, and the ones that run long are tracking parameters nobody needs to keep.
 */
export const socialUrl = (max = 300) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((typed, ctx) => {
      const url = profileAddress(typed)

      if (url === null) {
        ctx.addIssue({ code: 'custom', message: NOT_A_PROFILE })
        return z.NEVER
      }

      return url
    })
