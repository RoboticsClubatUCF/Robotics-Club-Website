import { apiBaseUrl } from './api'

/**
 * Uploads, as the browser has to see them.
 *
 * `STORED_PREFIX` mirrors the constant in `server/src/files.ts`, where the same
 * string is the entire "is this ours" test — an image column holds either an
 * external address or this prefix plus an id, and on the server the difference
 * decides whether removing a row also destroys bytes.
 *
 * **In the browser it decides something else, and getting it wrong is silent.**
 * The stored address is *root-relative*, and the site and the API are different
 * origins — :5173 and :4000 in development, and two hostnames in production,
 * because there is deliberately no `/api` proxy. So `<img src="/api/files/x">`
 * resolves against the **page**, not the API, and the dev server answers it with
 * `index.html`: a 200, with `Content-Type: text/html`, which an `<img>` reports
 * as an ordinary load failure. External URLs are absolute and unaffected, so the
 * symptom is "uploads never appear, links always do".
 *
 * `imageSrc` is that fix in one place. Anything rendering a value that came out
 * of an image column goes through it.
 */

export const STORED_PREFIX = '/api/files/'

/** Whether this URL points at something the club is storing itself. */
export const isStoredUpload = (url: string) => url.startsWith(STORED_PREFIX)

/**
 * An image column's value, as an `<img src>`.
 *
 * Stored uploads get the API's origin in front of them; external URLs are
 * returned untouched, because they are somebody else's hosting and already
 * absolute.
 */
export const imageSrc = (url: string): string =>
  isStoredUpload(url) ? `${apiBaseUrl}${url}` : url

/**
 * The address of one stored file by its id, for a link rather than a column —
 * the officer's print-model download is the only caller.
 */
export const storedFileUrl = (id: string): string =>
  `${apiBaseUrl}${STORED_PREFIX}${id}`
