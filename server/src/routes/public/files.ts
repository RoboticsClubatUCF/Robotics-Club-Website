import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { isOfficer } from '../../auth/authz.js'
import { prisma } from '../../core/db.js'
import { documentContentType } from '../../files/files.js'
import { FileKind } from '../../generated/prisma/enums.js'
import { type AuthEnv, optionalAuth } from '../../auth/session.js'

/**
 * Serving stored files.
 *
 *   GET /api/files/:id -> the bytes
 *
 * Access follows `kind`. An IMAGE is public — it is a project cover on a
 * public page, and hiding it there would just break the page. A DOCUMENT is
 * public for the same reason: it hangs off a project's documentation page,
 * which anybody may read. A PRINT_MODEL is somebody's part: its uploader and
 * the officers who print it, nobody else.
 *
 * Cache headers follow the same split. Images and documents are `immutable`
 * because an id is minted per upload and never reused — replacing either is a
 * new id, so a cached copy can never go stale, only unreferenced. Models are
 * `no-store`: they get deleted when the job settles, and a browser cache
 * holding a part the club was asked to stop storing misses the point of
 * deleting it.
 *
 * **A DOCUMENT is the one kind served inline, and that is the whole reason it
 * is the one kind carrying security headers.** Rendering a member-supplied PDF
 * in an `<iframe>` runs it on *this* origin — the origin the session cookie
 * lives on — and PDF viewers execute script. `Content-Security-Policy: sandbox`
 * drops the response into an opaque origin so it can reach nothing of ours, and
 * the PDF still renders. `nosniff`, plus a Content-Type decided from the
 * filename rather than read out of `mimeType`, closes the other half: that
 * column is whatever the uploading browser claimed it was.
 *
 * Mounted outside `publicApi` so the etag/public-cache middleware never
 * touches these responses — this route sets its own headers.
 */
export const files = new Hono<AuthEnv>()

files.get('/:id', optionalAuth, async (c) => {
  const file = await prisma.storedFile.findUnique({
    where: { id: c.req.param('id') },
  })

  if (!file) throw new HTTPException(404, { message: 'No such file' })

  if (file.kind === FileKind.PRINT_MODEL) {
    const user = c.get('user')
    if (!user) throw new HTTPException(401, { message: 'Sign in to continue.' })
    if (file.createdById !== user.id && !isOfficer(user)) {
      throw new HTTPException(403, {
        message: 'You do not have permission to do that.',
      })
    }

    c.header('Cache-Control', 'private, no-store')
    // Download, never render: a browser has no viewer for STL and the
    // filename is the thing the officer drags into the slicer.
    c.header('Content-Disposition', disposition('attachment', file.originalName))
    c.header('Content-Type', file.mimeType)
  } else if (file.kind === FileKind.DOCUMENT) {
    const type = documentContentType(file.originalName)

    c.header('Cache-Control', 'public, max-age=31536000, immutable')
    c.header('Content-Type', type)
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Content-Security-Policy', 'sandbox')

    /**
     * Saving rather than viewing, asked for in the query string.
     *
     * `?download=1` exists because the obvious way does not work: `<a download>`
     * is **ignored on a cross-origin link**, and the site and the API are always
     * different origins here. So the only thing that can turn a viewable
     * document into a saved one is this header, and the only way the browser can
     * ask for it is the URL. A PDF is otherwise served `inline` — an `<iframe>`
     * pointed at an `attachment` downloads the file instead of rendering it, so
     * the whole viewer hangs off that. Anything else has no browser viewer to
     * reach and arrives as a download either way.
     */
    const saving = c.req.query('download') === '1'

    c.header(
      'Content-Disposition',
      disposition(
        !saving && type === 'application/pdf' ? 'inline' : 'attachment',
        file.originalName,
      ),
    )
  } else {
    c.header('Cache-Control', 'public, max-age=31536000, immutable')
    c.header('Content-Type', file.mimeType)
  }

  return c.body(new Uint8Array(file.data))
})

/**
 * A `Content-Disposition`, with quotes and backslashes taken out of the
 * filename — those are what end the quoted string early and let a name smuggle
 * a second parameter in behind it.
 */
const disposition = (kind: 'inline' | 'attachment', originalName: string) =>
  `${kind}; filename="${originalName.replace(/["\\]/g, '')}"`
