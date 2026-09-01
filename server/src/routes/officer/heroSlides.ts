import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { validate, webUrl } from '../../core/validate.js'
import { requireOfficer } from '../../auth/authz.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { deleteIfStored, looksLikeImage, storeFile } from '../../files/files.js'
import { FileKind } from '../../generated/prisma/enums.js'
import { rateLimit } from '../../core/rateLimit.js'
import { type AuthEnv, originGuard, requireAuth } from '../../auth/session.js'
import { framingFields, framingFromBody } from '../projects/projectManage.js'

/**
 * The front-page slideshow: the photographs beside the landing page's headline.
 *
 *   POST   /api/officer/hero-slides         -> add one by URL
 *   POST   /api/officer/hero-slides/upload  -> add one as a file
 *   PATCH  /api/officer/hero-slides/order   -> reorder the whole list
 *   PATCH  /api/officer/hero-slides/:id     -> caption and framing
 *   DELETE /api/officer/hero-slides/:id     -> remove one
 *
 * The read is not here. `GET /api/hero-slides` is in `content.ts`, because it is
 * public and belongs on the cached side of `app.ts` with the rest of the club's
 * content — this file exports the `select` it answers with, so the desk and the
 * page cannot describe a slide two different ways. Same split, and the same
 * reason, as `surveyAdmin.ts` and `survey.ts`.
 *
 * Its own file rather than a section of `officer.ts`, where every other
 * club-wide desk lives, and the reason is mechanical: the framing helpers below
 * come from `projectManage.ts`, which imports `managedProjectSelect` from
 * `officer.ts`. Putting these routes in `officer.ts` would close that loop into
 * an import cycle for the sake of tidiness. Mounted before `/api/officer` in
 * `app.ts` for the same reason `surveyAdmin` is: it owns a path underneath it.
 *
 * **The framing rules are imported, not restated.** A hero slide sits in the
 * same fixed 16:10 well a gallery slide does, and the club's photographs are the
 * same photographs — a second copy of the bounds here would be a second thing to
 * keep in step with `web/src/lib/media/imageFraming.ts`.
 */
export const heroSlides = new Hono<AuthEnv>()

/**
 * How many photographs the hero may hold.
 *
 * Eight, against the gallery's twelve, and the difference is what the two are
 * for: a project gallery is a story somebody has chosen to sit through, and this
 * runs on its own beside a headline for as long as a visitor stays on the page.
 * Past about eight nobody reaches the end of it, and every one of them is bytes
 * on the *landing* page — the one page here that has to be quick for somebody
 * who has never heard of the club.
 *
 * Mirrored in `web/src/lib/heroSlides.ts` so the desk cannot offer what this
 * refuses — change one and change the other.
 */
export const MAX_HERO_SLIDES = 8

/**
 * What a slide is, everywhere. Exported because `content.ts` answers the public
 * read with it.
 */
export const heroSlideSelect = {
  id: true,
  url: true,
  caption: true,
  focalX: true,
  focalY: true,
  zoom: true,
} as const

/**
 * Shares the officer desk's budget rather than opening one of its own: sixty
 * writes covers a sitting spent rearranging eight photographs, and a scope per
 * desk is a scope per suite to remember to clear. The upload below is the
 * exception, and it is the usual one — a body limit and a file per request.
 */
const writes = rateLimit('officer', 60)

/**
 * Uploads get their own, smaller budget. Twenty is more than twice the cap on
 * the list itself, which is the point: retries and second thoughts are normal,
 * and eight photographs is where a legitimate sitting stops.
 */
const uploads = rateLimit('hero', 20)

const slideFields = {
  url: webUrl(),
  caption: z.string().trim().max(160).nullable().optional(),
}

/**
 * Framing arrives with the picture as well as afterwards — the desk opens the
 * framing tool the moment a photograph lands, and an officer who drags it into
 * place before doing anything else should not need that to have been two
 * requests for it to stick.
 */
const addSlide = z.object({ ...slideFields, ...framingFields })

/**
 * Everything about a slide except which picture it is. No `url`: replacing a
 * photograph is remove-then-add, which keeps `deleteIfStored` at two call sites
 * rather than three that have to agree. The same rule the gallery follows.
 */
const editSlide = z.object({ caption: slideFields.caption, ...framingFields })

/** Refuses once the hero is full, and says the number rather than "too many". */
async function assertRoom() {
  const held = await prisma.heroSlide.count()
  if (held >= MAX_HERO_SLIDES) {
    throw new HTTPException(409, {
      message: `The front page shows up to ${MAX_HERO_SLIDES} photos. Remove one before adding another.`,
    })
  }
}

/** Appends: a new photograph lands at the end, where somebody just added it. */
async function nextSortOrder() {
  const { _max } = await prisma.heroSlide.aggregate({ _max: { sortOrder: true } })
  return (_max.sortOrder ?? -1) + 1
}

async function getSlide(id: string) {
  const slide = await prisma.heroSlide.findUnique({ where: { id } })
  if (!slide) throw new HTTPException(404, { message: 'No such photo' })
  return slide
}

/** A photograph somebody is hosting elsewhere. */
heroSlides.post(
  '/',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', addSlide),
  async (c) => {
    const { url, caption, focalX, focalY, zoom } = c.req.valid('json')

    await assertRoom()

    const slide = await prisma.heroSlide.create({
      data: {
        url,
        caption: caption ?? null,
        // Spread rather than assigned, so an omitted field takes the column's
        // default instead of writing `undefined` over it.
        ...(focalX === undefined ? {} : { focalX }),
        ...(focalY === undefined ? {} : { focalY }),
        ...(zoom === undefined ? {} : { zoom }),
        sortOrder: await nextSortOrder(),
      },
      select: heroSlideSelect,
    })

    return c.json(slide, 201)
  },
)

/**
 * A photograph as a file, which is how every one of these actually arrives — the
 * club's pictures come off a phone, not off a host somebody can link to.
 *
 * Two routes rather than one branching on `Content-Type`, for the reason the
 * gallery's pair documents: the middleware genuinely differs, and
 * `validate('json')` cannot sit in front of a multipart request at all.
 */
heroSlides.post(
  '/upload',
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

    await assertRoom()

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

    // Multipart carries no types, so an untouched box arrives as `''` rather
    // than absent — the same coercion the gallery's upload makes.
    const caption =
      typeof body['caption'] === 'string' ? body['caption'].trim() : ''
    const { focalX, focalY, zoom } = framingFromBody(body)

    const { url } = await storeFile(FileKind.IMAGE, file, user.id)
    const slide = await prisma.heroSlide.create({
      data: {
        url,
        caption: caption.slice(0, 160) || null,
        ...(focalX === undefined ? {} : { focalX }),
        ...(focalY === undefined ? {} : { focalY }),
        ...(zoom === undefined ? {} : { zoom }),
        sortOrder: await nextSortOrder(),
      },
      select: heroSlideSelect,
    })

    return c.json(slide, 201)
  },
)

/**
 * The whole order at once, as a list of ids.
 *
 * The set check is the lost-update guard, and it earns more here than it does on
 * a project: this is one global list, so the two tabs it protects against are
 * two *different officers* rather than one person in two windows.
 *
 * **Registered before `/:id` on purpose** — `order` is a perfectly good
 * uuid-shaped hole for a wildcard to fall into, and a reorder answered by the
 * caption route would be a 404 that looks like a photograph having vanished.
 */
heroSlides.patch(
  '/order',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate(
    'json',
    z.object({ ids: z.array(z.uuid()).min(1).max(MAX_HERO_SLIDES) }),
  ),
  async (c) => {
    const { ids } = c.req.valid('json')

    const held = await prisma.heroSlide.findMany({ select: { id: true } })

    const sent = new Set(ids)
    const stale =
      sent.size !== ids.length ||
      held.length !== ids.length ||
      held.some((slide) => !sent.has(slide.id))

    if (stale) {
      throw new HTTPException(409, {
        message:
          'The slideshow changed while you were editing it. Reload the page and try again.',
      })
    }

    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.heroSlide.update({ where: { id }, data: { sortOrder: index } }),
      ),
    )

    const slides = await prisma.heroSlide.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: heroSlideSelect,
    })

    return c.json(slides)
  },
)

/**
 * The caption and the framing, each applied only when it was sent — so the
 * framing tool and the caption box can write independently without either
 * flattening the other.
 */
heroSlides.patch(
  '/:id',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', editSlide),
  async (c) => {
    const slide = await getSlide(c.req.param('id'))
    const { caption, focalX, focalY, zoom } = c.req.valid('json')

    const updated = await prisma.heroSlide.update({
      where: { id: slide.id },
      data: {
        // `caption` is nullable, so "absent" and "cleared" are different
        // requests and only the first one leaves the column alone.
        ...(caption === undefined ? {} : { caption: caption ?? null }),
        ...(focalX === undefined ? {} : { focalX }),
        ...(focalY === undefined ? {} : { focalY }),
        ...(zoom === undefined ? {} : { zoom }),
      },
      select: heroSlideSelect,
    })

    return c.json(updated)
  },
)

heroSlides.delete(
  '/:id',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  async (c) => {
    const slide = await getSlide(c.req.param('id'))

    await prisma.heroSlide.delete({ where: { id: slide.id } })

    // The reference is gone before the bytes are, so a failure here leaves an
    // orphaned file rather than a slideshow pointing at nothing.
    // `deleteIfStored` ignores external URLs entirely — somebody else's hosting
    // is not ours to clean up.
    await deleteIfStored(slide.url)

    return c.json({ deleted: true })
  },
)
