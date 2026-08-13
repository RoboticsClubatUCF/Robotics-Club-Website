import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { isOfficer } from '../authz.js'
import { prisma } from '../db.js'
import { FileKind } from '../generated/prisma/enums.js'
import { type AuthEnv, optionalAuth } from '../session.js'

/**
 * Serving stored files.
 *
 *   GET /api/files/:id -> the bytes
 *
 * Access follows `kind`. An IMAGE is public — it is a project cover on a
 * public page, and hiding it there would just break the page. A PRINT_MODEL
 * is somebody's part: its uploader and the officers who print it, nobody
 * else.
 *
 * Cache headers follow the same split. Images are `immutable` because an id
 * is minted per upload and never reused — replacing an image is a new id, so
 * a cached copy can never go stale, only unreferenced. Models are `no-store`:
 * they get deleted when the job settles, and a browser cache holding a part
 * the club was asked to stop storing misses the point of deleting it.
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
    c.header(
      'Content-Disposition',
      `attachment; filename="${file.originalName.replace(/["\\]/g, '')}"`,
    )
  } else {
    c.header('Cache-Control', 'public, max-age=31536000, immutable')
  }

  c.header('Content-Type', file.mimeType)
  return c.body(new Uint8Array(file.data))
})
