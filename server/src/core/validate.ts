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
