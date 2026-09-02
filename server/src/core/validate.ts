import { zValidator } from '@hono/zod-validator'
import type { ValidationTargets } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'

/**
 * What the API accepts, and what it says when it doesn't.
 *
 * Two things live here because they are the same failure seen from both ends: a
 * field somebody filled in the way a person writes it, and the sentence that
 * comes back when the schema disagrees.
 */

/**
 * A validator that refuses in the API's own voice.
 *
 * **`zValidator`'s own refusal is unreadable by the time it reaches a form.** It
 * answers `{ success: false, error: <ZodError> }`, and `explainApiError` in the
 * browser only lifts `error` when it is a *string* — so every schema failure on
 * this site, on every form, arrived as "That change did not go through. Try
 * again in a moment." An officer who typed `example.com` into a website box was
 * told to try again in a moment, which is advice for a broken server and
 * useless for a typo. It cost a bug report and half a session to find.
 *
 * Throwing an `HTTPException` instead puts it through `app.onError`, which is
 * where every other 400 on this API is already shaped — so the answer is
 * `{ error: '<sentence>' }` like all the rest and the browser needs no special
 * case. The sentence names the field and carries the schema's own message,
 * which is why a field worth explaining (see `webUrl` below) is worth giving a
 * written one.
 *
 * Import this rather than `@hono/zod-validator` directly; the call is otherwise
 * identical, and a route that imports the package straight is the one route
 * that will still answer with an object.
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
 * The first issue only. A body that is wrong in four ways is nearly always
 * wrong in one way that caused the other three, and a status line is one line —
 * the browser prints this into the same strip that carries "Saved."
 *
 * `path` is the field as the wire spells it (`websiteUrl`), not as the form
 * labels it (WEBSITE). Close enough to act on, and the honest alternative — a
 * map from every column to every label — is a second copy of the frontend kept
 * in the server. A field where that is not close enough gets a written message
 * on the schema, which this prints instead of zod's.
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
 * **`z.url()` refuses `example.com`, and `example.com` is what people type.**
 * Every URL field on this site is filled in by hand from a business card, an
 * email signature or a browser's address bar — and the address bar has not
 * shown the scheme since about 2018. Refusing that is technically correct and
 * practically a trap: the officer sees the box, fills it the way they would
 * write it anywhere else, and the whole save is refused.
 *
 * So the scheme is added when it is missing rather than demanded. `https`,
 * because a site that is still http-only will redirect and a site that is not
 * would have been broken in a browser anyway. Everything else about the address
 * is left alone — this is not a parser, and a URL that is wrong past its scheme
 * is somebody's typo rather than something to guess at.
 *
 * **What is stored is the corrected address**, not what was typed, so the box
 * shows `https://example.com` the next time it is opened and nothing has to
 * re-derive the fix on the way out.
 *
 * **And the scheme is checked, which bare `z.url()` does not do.** It accepts
 * `javascript:alert(1)` and `data:text/html,…` as perfectly good URLs — and
 * every column this guards is printed straight into an `href` or a `src` on a
 * public page. Officers are the only people who can write these, so this is a
 * lock on the inside of the building rather than the front door, but it is one
 * line and the alternative is a stored script in the club's own markup.
 * `hostname` is what turns the rest away: without it `https://not a url` is a
 * host called `not` with a path, which `new URL` will happily accept.
 */
export const webUrl = (max = 500) =>
  z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value

      const typed = value.trim()

      // Anything already carrying a scheme is left as it is — including the
      // ones refused below, which have to reach the check rather than be
      // turned into `https://javascript:alert(1)` on the way to it.
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
 * **This is an allowlist because the alternative is a link farm.** `profileUrl`
 * on `User` is the only column on this site whose value is typed by an ordinary
 * member and then printed straight into an `href` on a public page, and the
 * roster is a public page with several hundred faces on it. A field that took
 * any address at all is somewhere to park a phishing page or a referral link
 * and have the club host the anchor for it, and nothing about a well-formed URL
 * distinguishes those from a LinkedIn profile.
 *
 * A subdomain of an entry counts, which is what lets `uk.linkedin.com`,
 * `www.github.com` and somebody's own `name.medium.com` through. That is safe
 * for exactly as long as the list holds only hosts whose subdomains belong to
 * the platform or to one of its users — so **do not add a host that hands out
 * arbitrary pages under arbitrary names** (`github.io`, `pages.dev`,
 * `vercel.app`), which would put the allowlist back where it started.
 *
 * Two deliberate absences. **The fediverse cannot be allowlisted** — a Mastodon
 * account lives on whichever of a thousand instances its owner picked — so the
 * flagship one is here and the rest are refused, which is the honest failure.
 * And **Discord is not on it**: the club already stores a handle in a column of
 * its own, checked against the real guild, and a second unverified copy of the
 * same fact is worse than none.
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

/** The sentence a refused address gets back. Three names and an honest "or
    another" — printing all thirty into a one-line status strip is not a help. */
export const NOT_A_PROFILE =
  'link to a profile on LinkedIn, GitHub, Instagram or another well-known site'

const onAllowedHost = (hostname: string) => {
  const host = hostname.toLowerCase()

  return PROFILE_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  )
}

/**
 * A social profile address, as somebody pastes it, or null if it is not one.
 *
 * Exported for its own test rather than for a second caller: everything this
 * refuses is a thing that has to keep being refused, and asserting on a zod
 * error is a worse way to say so.
 *
 * The steps are each answering something specific:
 *
 *   - **The scheme is added when it is missing**, same as `webUrl` above and
 *     for the same reason — `linkedin.com/in/someone` is what people paste out
 *     of a browser that has not shown a scheme since 2018.
 *   - **`http` is accepted and upgraded rather than refused.** Every host on the
 *     list has been https-only for years, so a typed `http://` is a habit and
 *     not a statement about the site; storing it would only mean an insecure
 *     link on a public page that redirects anyway.
 *   - **Anything else — `javascript:`, `data:`, `mailto:` — is refused**, which
 *     is the half of this that is about the club's own markup rather than about
 *     where the link goes.
 *   - **Credentials and a port are refused.** `https://linkedin.com@evil.example/`
 *     is a link to `evil.example` that reads as LinkedIn to anybody checking by
 *     eye; `new URL` sees through it and the host check would refuse it anyway,
 *     but a stored address that *displays* as something it is not has no honest
 *     use here.
 *   - **The host is checked last, against the list.** A unicode lookalike is
 *     punycode by the time it gets here — `xn--linkedn-…` matches nothing —
 *     which is the case the list would otherwise miss.
 *
 * What comes back is the parsed address, never the typed one, so what is stored
 * is already normalised and nothing has to re-derive it on the way out.
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
 * Shorter than `webUrl`'s cap on purpose. A profile address is a handle on the
 * end of a path, and three hundred characters is already far more than any
 * platform on the list produces — the ones that run long are tracking
 * parameters, which nobody needs to keep.
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
