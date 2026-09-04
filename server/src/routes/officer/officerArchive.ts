import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { validate, webUrl } from '../../core/validate.js'
import { requireOfficer } from '../../auth/authz.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { deleteIfStored, looksLikeImage, storeFile } from '../../files/files.js'
import {
  FileKind,
  OfficerPosition,
  OfficerTermSource,
} from '../../generated/prisma/enums.js'
import { rateLimit } from '../../core/rateLimit.js'
import { type AuthEnv, originGuard, requireAuth } from '../../auth/session.js'

/**
 * The officers desk: every tenure the club has ever recorded, editable.
 *
 *   GET    /api/officer/archive           -> every term, board and archive alike
 *   POST   /api/officer/archive           -> add one, past or present
 *   PATCH  /api/officer/archive/:id       -> correct one
 *   DELETE /api/officer/archive/:id       -> remove one that should not exist
 *   POST   /api/officer/archive/:id/photo -> a headshot, for a term with no account
 *   DELETE /api/officer/archive/:id/photo -> take it off again
 *
 * The only way a term that has already ended can be written at all. `OfficerTerm` was
 * designed for the archive — `fullName` is stored on the row and `userId` is optional
 * precisely so a president from 2009 with no account here can be entered — but nothing
 * wrote those rows. The Discord sync and the seat routes only ever describe today, so
 * everything before the sync started was unreachable and a typo was permanent.
 *
 * Not a second answer to "who is on the board". The seat panel on the roles desk is
 * still where a chair is handed over, because a handover is one decision in one
 * transaction. This desk is the table itself: it adds rows the sync will never produce
 * and fixes rows that are wrong. Where the two overlap, this one refuses.
 *
 * The same person holds as many terms as they served — nothing here is keyed on the
 * person. The one uniqueness rule is the seat one, and it only applies to open terms:
 * the club has one sitting president and forty former ones.
 */
export const officerArchive = new Hono<AuthEnv>()

/** The officer desk's shared budget, as every other desk uses. */
const writes = rateLimit('officer', 60)

/** Uploads get their own, smaller one — a body limit and a file per request. */
const uploads = rateLimit('officer-photo', 20)

/**
 * A term as the desk needs it, which is more than either public route sends.
 *
 * `endedReason` and `source` are here and not on `ApiOfficerTerm`: this page has to
 * show why a term ended and who closed it — a `DISCORD` row will be reopened by the
 * next sweep if the person still carries the role, and an officer deleting one
 * deserves to know before they press the button.
 *
 * The photo is not coalesced against the account here, unlike the public read. The
 * desk is where the stored one is set and cleared, so a fallback would make an empty
 * column look filled and the remove button look broken.
 */
const archiveSelect = {
  id: true,
  position: true,
  startedAt: true,
  endedAt: true,
  endedReason: true,
  source: true,
  fullName: true,
  photoUrl: true,
  user: { select: { id: true, fullName: true, photoUrl: true } },
} as const

/**
 * Everything, in the order the archive reads: newest first, board order inside a start
 * date.
 *
 * Unpaginated and unfiltered, the same decision `GET /api/officers/past` makes — eight
 * seats a year against a fifty-year club is a list too long to scan, not one too long
 * to send, and the page filters it in the browser with `lib/officerTerms.ts`. The day
 * those become the same problem this wants `?q=` and `?year=`, not a bigger `take`.
 *
 * `seats` rides along because how many seats the club has is the database's answer: a
 * ninth added to `OfficerPosition` appears in the picker with no frontend edit.
 */
officerArchive.get('/', requireAuth, requireOfficer, async (c) => {
  const terms = await prisma.officerTerm.findMany({
    orderBy: [{ startedAt: 'desc' }, { endedAt: 'desc' }, { position: 'asc' }],
    select: archiveSelect,
  })

  return c.json({ seats: Object.values(OfficerPosition), terms })
})

/**
 * The fields a term is made of, and every one is writable here.
 *
 * `userId` is nullable and that's the point of the desk: most of the archive has
 * nobody behind it. Where there is an account the link carries the headshot forward,
 * so rolling a board over is eight rows pointing at eight accounts rather than eight
 * photographs uploaded again.
 *
 * `fullName` is required even when an account is linked, because it's the record
 * rather than a cache. The desk fills it in from the account it just picked; what it
 * must not do is read it through the relation at display time, which would rewrite
 * history every time somebody corrected the spelling of their own name.
 */
const termFields = {
  fullName: z.string().trim().min(2).max(120),
  userId: z.string().min(1).nullable(),
  position: z.enum(OfficerPosition).nullable(),
  startedAt: z.coerce.date(),
  /** Null is "still on the board". It is the only thing that means it. */
  endedAt: z.coerce.date().nullable(),
  endedReason: z.string().trim().max(200).nullable(),
  /**
   * A link to a headshot somebody else is hosting. The upload route below is the other
   * way in, and how a scanned photograph from 2011 actually arrives.
   */
  photoUrl: webUrl().nullable(),
}

const addTerm = z.object({
  ...termFields,
  userId: termFields.userId.default(null),
  position: termFields.position.default(null),
  endedAt: termFields.endedAt.default(null),
  endedReason: termFields.endedReason.default(null),
  photoUrl: termFields.photoUrl.default(null),
})

/**
 * Everything optional, and absent means unchanged rather than cleared.
 *
 * The distinction matters on every nullable field: `endedReason: null` closes a term
 * with no reason given, and omitting it leaves the reason already there. A desk that
 * couldn't say the difference would wipe the succession note off a term every time
 * somebody fixed a date.
 *
 * `source` is deliberately not in the list. It says who may close the term, and a desk
 * that could flip it could quietly hand the faculty advisor's hand-made appointment to
 * a loop that stands them down on its next pass.
 */
const editTerm = z.object({
  fullName: termFields.fullName.optional(),
  userId: termFields.userId.optional(),
  position: termFields.position.optional(),
  startedAt: termFields.startedAt.optional(),
  endedAt: termFields.endedAt.optional(),
  endedReason: termFields.endedReason.optional(),
  photoUrl: termFields.photoUrl.optional(),
})

const getTerm = async (id: string) => {
  const term = await prisma.officerTerm.findUnique({
    where: { id },
    select: { ...archiveSelect, userId: true },
  })

  if (!term) throw new HTTPException(404, { message: 'No such term' })

  return term
}

/**
 * A term has to end after it starts, and a linked account has to exist.
 *
 * Both are checked against the resulting row rather than the body, so a `PATCH` that
 * moves only `startedAt` is still refused when it lands after the `endedAt` already on
 * the record. That's why this takes a merged shape instead of the request.
 */
async function assertSound(term: {
  startedAt: Date
  endedAt: Date | null
  userId: string | null
}) {
  if (term.endedAt !== null && term.startedAt >= term.endedAt) {
    throw new HTTPException(400, {
      message: 'A term has to end after it starts.',
    })
  }

  if (term.userId !== null) {
    const exists = await prisma.user.findUnique({
      where: { id: term.userId },
      select: { id: true },
    })

    if (!exists) throw new HTTPException(404, { message: 'No such member' })
  }
}

/**
 * One person per seat among terms that are still open, and no further.
 *
 * The same rule the seat route enforces, and in code for the same reason: "unique on
 * `position` where `ended_at` is null" is a partial unique index, which Prisma can't
 * express and which a generated migration would drop.
 *
 * Closed terms are exempt, and that's what makes this desk possible at all — forty
 * people have been president and every one held the chair.
 *
 * No `takeOver` here, unlike the seat route: a handover is three writes that have to
 * happen together, and there's a route that does it in one transaction. This one names
 * the incumbent and sends the officer to it, because a desk for fixing rows shouldn't
 * have a second, quieter way to stand somebody down.
 */
async function assertSeatFree(
  position: OfficerPosition | null,
  endedAt: Date | null,
  exceptId: string | null,
) {
  if (position === null || endedAt !== null) return

  const incumbent = await prisma.officerTerm.findFirst({
    where: {
      position,
      endedAt: null,
      ...(exceptId === null ? {} : { id: { not: exceptId } }),
    },
    select: { fullName: true },
  })

  if (incumbent) {
    throw new HTTPException(409, {
      message: `${incumbent.fullName} still holds that seat. End their term first, or hand the chair over from the roles desk.`,
    })
  }
}

/**
 * Add a term.
 *
 * `MANUAL` always, and not a parameter. `source` decides who may close a term, and the
 * sync closing a row a person typed in is exactly the failure the column exists to
 * prevent — a 2011 president would be stood down by the first sweep that noticed they
 * carry no Discord role.
 */
officerArchive.post(
  '/',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', addTerm),
  async (c) => {
    const body = c.req.valid('json')

    await assertSound(body)
    await assertSeatFree(body.position, body.endedAt, null)

    const term = await prisma.officerTerm.create({
      data: { ...body, source: OfficerTermSource.MANUAL },
      select: archiveSelect,
    })

    return c.json(term, 201)
  },
)

/**
 * Correct a term — any field, on any term, however it got here.
 *
 * A `DISCORD` row is editable as readily as a `MANUAL` one: the sync records the day it
 * noticed a role appear, which isn't the day the club decided anything, and an officer
 * correcting that is fixing the record rather than overruling the sync. What the edit
 * doesn't change is `source`.
 */
officerArchive.patch(
  '/:id',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', editTerm),
  async (c) => {
    const body = c.req.valid('json')
    const term = await getTerm(c.req.param('id'))

    // The row as it will be, so the checks below see what the writer does. `??` rather
    // than a spread: an explicit null here is a real value.
    const after = {
      startedAt: body.startedAt ?? term.startedAt,
      endedAt: body.endedAt === undefined ? term.endedAt : body.endedAt,
      position: body.position === undefined ? term.position : body.position,
      userId: body.userId === undefined ? term.userId : body.userId,
    }

    await assertSound(after)
    await assertSeatFree(after.position, after.endedAt, term.id)

    const updated = await prisma.officerTerm.update({
      where: { id: term.id },
      data: body,
      select: archiveSelect,
    })

    // Pasting a link over an uploaded headshot is a replacement, so the bytes stop
    // being anybody's. Only when the column actually moved — a save that left the photo
    // alone must not delete it.
    if (updated.photoUrl !== term.photoUrl) await deleteIfStored(term.photoUrl)

    return c.json(updated)
  },
)

/**
 * Delete a term outright, which is what makes this different from standing somebody
 * down.
 *
 * `DELETE /api/officer/terms/:userId` on the roles desk closes an open term: the person
 * leaves the board and appears in the archive, which is history worth keeping. This is
 * for the row that should never have existed — a sync against a mis-typed role id, a
 * term entered against the wrong person, a duplicate. There's no soft version of that.
 */
officerArchive.delete(
  '/:id',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  async (c) => {
    const term = await getTerm(c.req.param('id'))

    await prisma.officerTerm.delete({ where: { id: term.id } })
    await deleteIfStored(term.photoUrl)

    return c.json({ deleted: term.id })
  },
)

/**
 * A headshot filed against the term itself.
 *
 * The one case the account photo can't answer. `GET /api/officers` prefers the linked
 * account's picture precisely because a photo filed against one term is a copy nothing
 * updates — but most of the archive has no account behind it, and for those rows this
 * column is the only picture there will ever be.
 *
 * Upload and replace, the same shape as the sponsor logo route: a term is a row that
 * has a photograph rather than a picture with a name attached.
 */
officerArchive.post(
  '/:id/photo',
  originGuard,
  requireAuth,
  requireOfficer,
  bodyLimit({
    maxSize: env.MAX_IMAGE_FILE_MB * 1024 * 1024 + 64 * 1024,
    onError: () => {
      throw new HTTPException(413, {
        message: `That image is too big — the cap is ${env.MAX_IMAGE_FILE_MB} MB.`,
      })
    },
  }),
  uploads,
  async (c) => {
    const user = c.get('user')
    const term = await getTerm(c.req.param('id'))

    const body = await c.req.parseBody()
    const file = body['file']

    if (!(file instanceof File) || file.size === 0) {
      throw new HTTPException(400, { message: 'Attach the photo itself.' })
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!looksLikeImage(bytes)) {
      throw new HTTPException(400, {
        message:
          'That file is not an image the site can show. PNG, JPEG, GIF or WebP.',
      })
    }

    const { url } = await storeFile(FileKind.IMAGE, file, user.id)

    const updated = await prisma.officerTerm.update({
      where: { id: term.id },
      data: { photoUrl: url },
      select: archiveSelect,
    })

    // The row points at the new bytes before the old ones go, so a failure costs an
    // orphaned file rather than a card with a broken picture on it.
    await deleteIfStored(term.photoUrl)

    return c.json(updated)
  },
)

/** Back to whatever the linked account has, or to initials for the rows with nobody
    behind them — which `OfficerCard` has always been built to draw. */
officerArchive.delete(
  '/:id/photo',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  async (c) => {
    const term = await getTerm(c.req.param('id'))

    const updated = await prisma.officerTerm.update({
      where: { id: term.id },
      data: { photoUrl: null },
      select: archiveSelect,
    })

    await deleteIfStored(term.photoUrl)

    return c.json(updated)
  },
)
