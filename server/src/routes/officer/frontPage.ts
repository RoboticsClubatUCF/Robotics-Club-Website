import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { requireOfficer } from '../../auth/authz.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { deleteIfStored, looksLikeImage, storeFile } from '../../files/files.js'
import { FileKind } from '../../generated/prisma/enums.js'
import { rateLimit } from '../../core/rateLimit.js'
import type { Prisma } from '../../generated/prisma/client.js'
import { validate, webUrl } from '../../core/validate.js'
import { type AuthEnv, originGuard, requireAuth } from '../../auth/session.js'

/**
 * The landing page's words, written by officers.
 *
 *   PUT    /api/officer/front-page/copy            -> the headline, the lede, the partners line
 *   POST   /api/officer/front-page/faqs            -> add a question
 *   PATCH  /api/officer/front-page/faqs/order      -> reorder the whole list
 *   PATCH  /api/officer/front-page/faqs/:id        -> edit one
 *   DELETE /api/officer/front-page/faqs/:id        -> remove one
 *   POST   /api/officer/front-page/partners        -> add a partner program
 *   PATCH  /api/officer/front-page/partners/order  -> reorder that list
 *   PATCH  /api/officer/front-page/partners/:id    -> edit one
 *   DELETE /api/officer/front-page/partners/:id    -> remove one
 *   POST   /api/officer/front-page/partners/:id/image  -> upload or replace its artwork
 *   DELETE /api/officer/front-page/partners/:id/image  -> take the artwork off
 *
 * The half of the front-page desk that isn't photographs — `heroSlides.ts` owns the
 * slideshow, this owns the headline. Two routers for one desk because they're two
 * different kinds of thing, and folding them together would put an image-framing helper
 * in the same file as the FAQ.
 *
 * Three tables, one router, because they're one page: a visitor can't tell which
 * answered any part of it, and an officer writing that page thinks about what it says
 * rather than about tables.
 *
 * The reads aren't here. `GET /api/front-page` is in `content.ts`, on the cached side
 * of `app.ts`; this file exports the `select`s it answers with, so the desk and the
 * page can't describe an answer two ways. The desk reads that public route too, with
 * `no-store`, rather than an officer-only twin — there's nothing on the landing page an
 * officer may see and a visitor may not.
 *
 * Nothing here is a permission decision of its own: `requireOfficer` is the whole gate.
 */
export const frontPage = new Hono<AuthEnv>()

/**
 * How many questions the FAQ will carry.
 *
 * Twenty, against the eight the club actually asks. The number isn't really about the
 * page — it's about the reorder route taking the whole list in one body, and about
 * somebody pasting a document in.
 *
 * Mirrored in `web/src/lib/frontPage.ts` so the desk can't offer what this refuses.
 */
export const MAX_FAQS = 20

/**
 * How many numbered steps one answer may have.
 *
 * Six, and the club's longest is four. An answer that needs seven steps is a page, and
 * the honest fix is a link to one rather than a longer list inside a disclosure.
 */
export const MAX_FAQ_STEPS = 6

/**
 * How many partner programs the section will hold.
 *
 * Six, on a grid that draws two across. The club works with two, and the cap is about
 * the section staying a short answer to "what if I cannot join" rather than a directory.
 */
export const MAX_PARTNERS = 6

/** What a question is, on both sides. `content.ts` answers the public read with
    this. */
export const faqSelect = {
  id: true,
  question: true,
  answer: true,
  steps: true,
} as const

/** What a partner program is, on both sides. */
export const partnerSelect = {
  id: true,
  name: true,
  audience: true,
  blurb: true,
  href: true,
  linkLabel: true,
  imageUrl: true,
} as const

/** The copy, from the one row there is. */
export const frontPageCopySelect = {
  headline: true,
  headlineAccent: true,
  lede: true,
  partnersIntro: true,
} as const

/** The singleton's key. A column default in the schema; named here so the
    routes that touch it cannot disagree about the spelling. */
export const FRONT_PAGE_ROW = 'current'

/**
 * Shares the officer desk's budget rather than opening one of its own: sixty writes
 * covers a sitting spent rewriting the FAQ, and a scope per desk is a scope per suite
 * to remember to clear. The upload below is the usual exception.
 */
const writes = rateLimit('officer', 60)

/** Artwork gets its own, smaller budget, the shape the hero and sponsor desks
    use. */
const uploads = rateLimit('front-page', 20)

/**
 * The whole of the copy in one body, and `PUT` rather than `PATCH` because of it: the
 * headline is two lines that have to read as one sentence, so a request that could
 * carry the second without the first is a half-written hero.
 */
const copy = z.object({
  headline: z.string().trim().min(1).max(80),
  headlineAccent: z.string().trim().min(1).max(80),
  lede: z.string().trim().min(1).max(600),
  partnersIntro: z.string().trim().min(1).max(300),
})

const faqFields = {
  question: z.string().trim().min(1).max(200),
  answer: z.string().trim().min(1).max(2000),
  /**
   * Trimmed and emptied here rather than in the browser, because the desk edits these
   * as one box a line at a time and a trailing newline isn't a step. An empty list is
   * the ordinary case: seven of the club's eight answers are a paragraph.
   */
  steps: z
    .array(z.string().trim().min(1).max(200))
    .max(MAX_FAQ_STEPS)
    .default([]),
}

const partnerFields = {
  name: z.string().trim().min(1).max(80),
  audience: z.string().trim().min(1).max(60),
  blurb: z.string().trim().min(1).max(600),
  href: webUrl(),
  linkLabel: z.string().trim().min(1).max(60),
  /**
   * Artwork somebody else is hosting. The file route below is the other way in, and how
   * a logo actually arrives — a program sends a PNG.
   */
  imageUrl: webUrl().nullable().optional(),
}

/**
 * The same fields, all optional, and written out rather than `.partial()`ed off the
 * create schema: `steps` carries a `.default([])`, and `.partial()` leaves a default
 * under an optional key — so a patch about the question alone would parse to an empty
 * step list and delete the procedure on its way past. The sponsor desk paid for that
 * lesson already.
 */
const editFaq = z.object({
  question: faqFields.question.optional(),
  answer: faqFields.answer.optional(),
  steps: z.array(z.string().trim().min(1).max(200)).max(MAX_FAQ_STEPS).optional(),
})

const editPartner = z.object(partnerFields).partial()

/** Refuses once a list is full, and says the number rather than "too many". */
async function assertRoom(
  held: number,
  cap: number,
  what: string,
): Promise<void> {
  if (held >= cap) {
    throw new HTTPException(409, {
      message: `The front page shows up to ${cap} ${what}. Remove one before adding another.`,
    })
  }
}

/**
 * The whole order at once, as a list of ids.
 *
 * The set check is the lost-update guard, and it earns more here than on a project's
 * gallery: these are global lists, so the two tabs it protects against are two
 * different officers rather than one person in two windows.
 *
 * Written once for both lists because both are the same three lines over different
 * tables, and the 409 says the same thing either way.
 */
async function reorder<T>(
  ids: string[],
  read: () => Promise<{ id: string }[]>,
  /** A `PrismaPromise` rather than a `Promise`: `$transaction` takes the unawaited query
      objects and runs them itself, and a plain promise here has already started. */
  write: (id: string, index: number) => Prisma.PrismaPromise<unknown>,
  list: () => Promise<T>,
): Promise<T> {
  const held = await read()

  const sent = new Set(ids)
  const stale =
    sent.size !== ids.length ||
    held.length !== ids.length ||
    held.some((row) => !sent.has(row.id))

  if (stale) {
    throw new HTTPException(409, {
      message:
        'That list changed while you were editing it. Reload the page and try again.',
    })
  }

  await prisma.$transaction(ids.map((id, index) => write(id, index)))

  return list()
}

// ---------------------------------------------------------------- the words

/**
 * The headline, the paragraph under it, and the line above the partner cards.
 *
 * `PUT` on a path with no id, because there is one landing page: the row is keyed
 * `current` by a column default and this upserts it, so "has anybody written this yet"
 * is never a question the route has to ask.
 *
 * There is no route to clear it. Every other singleton here can be emptied because
 * empty is a state its page is built for; a landing page with no headline isn't. What
 * the copy falls back to is `FRONT_PAGE_COPY` in `content.ts` — a floor rather than a
 * draft, and an officer who wants the shipped wording back types it.
 */
frontPage.put(
  '/copy',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', copy),
  async (c) => {
    const fields = c.req.valid('json')

    const saved = await prisma.frontPage.upsert({
      where: { id: FRONT_PAGE_ROW },
      create: { id: FRONT_PAGE_ROW, ...fields },
      update: fields,
      select: frontPageCopySelect,
    })

    return c.json(saved)
  },
)

// ------------------------------------------------------------------ the FAQ
//
// `order` is registered before `/:id`, and that isn't tidiness: it's a perfectly good
// uuid-shaped hole for a wildcard to fall into, and a reorder answered by the edit
// route would be a 404 that reads like a question having vanished.

frontPage.post(
  '/faqs',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', z.object(faqFields)),
  async (c) => {
    const data = c.req.valid('json')

    await assertRoom(await prisma.faq.count(), MAX_FAQS, 'questions')

    // Appends: a new question lands at the end, where somebody just added it.
    const { _max } = await prisma.faq.aggregate({ _max: { sortOrder: true } })

    const added = await prisma.faq.create({
      data: { ...data, sortOrder: (_max.sortOrder ?? -1) + 1 },
      select: faqSelect,
    })

    return c.json(added, 201)
  },
)

frontPage.patch(
  '/faqs/order',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', z.object({ ids: z.array(z.uuid()).min(1).max(MAX_FAQS) })),
  async (c) => {
    const { ids } = c.req.valid('json')

    return c.json(
      await reorder(
        ids,
        () => prisma.faq.findMany({ select: { id: true } }),
        (id, index) =>
          prisma.faq.update({ where: { id }, data: { sortOrder: index } }),
        () =>
          prisma.faq.findMany({
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            select: faqSelect,
          }),
      ),
    )
  },
)

frontPage.patch(
  '/faqs/:id',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', editFaq),
  async (c) => {
    const id = c.req.param('id')
    const patch = c.req.valid('json')

    const held = await prisma.faq.findUnique({ where: { id } })
    if (!held) throw new HTTPException(404, { message: 'No such question.' })

    const updated = await prisma.faq.update({
      where: { id },
      data: patch,
      select: faqSelect,
    })

    return c.json(updated)
  },
)

frontPage.delete(
  '/faqs/:id',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  async (c) => {
    const id = c.req.param('id')

    const held = await prisma.faq.findUnique({ where: { id } })
    if (!held) throw new HTTPException(404, { message: 'No such question.' })

    await prisma.faq.delete({ where: { id } })

    return c.json({ deleted: true })
  },
)

// ------------------------------------------------------- the partner programs

async function getPartner(id: string) {
  const partner = await prisma.partnerProgram.findUnique({ where: { id } })
  if (!partner) throw new HTTPException(404, { message: 'No such program.' })
  return partner
}

frontPage.post(
  '/partners',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', z.object(partnerFields)),
  async (c) => {
    const { imageUrl, ...data } = c.req.valid('json')

    await assertRoom(
      await prisma.partnerProgram.count(),
      MAX_PARTNERS,
      'programs',
    )

    const { _max } = await prisma.partnerProgram.aggregate({
      _max: { sortOrder: true },
    })

    const added = await prisma.partnerProgram.create({
      data: {
        ...data,
        imageUrl: imageUrl ?? null,
        sortOrder: (_max.sortOrder ?? -1) + 1,
      },
      select: partnerSelect,
    })

    return c.json(added, 201)
  },
)

frontPage.patch(
  '/partners/order',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', z.object({ ids: z.array(z.uuid()).min(1).max(MAX_PARTNERS) })),
  async (c) => {
    const { ids } = c.req.valid('json')

    return c.json(
      await reorder(
        ids,
        () => prisma.partnerProgram.findMany({ select: { id: true } }),
        (id, index) =>
          prisma.partnerProgram.update({
            where: { id },
            data: { sortOrder: index },
          }),
        () =>
          prisma.partnerProgram.findMany({
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            select: partnerSelect,
          }),
      ),
    )
  },
)

/**
 * Every nullable field tells absent from cleared, so the blurb box and the
 * artwork link can write independently without either flattening the other.
 */
frontPage.patch(
  '/partners/:id',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', editPartner),
  async (c) => {
    const partner = await getPartner(c.req.param('id'))
    const { imageUrl, ...rest } = c.req.valid('json')

    const updated = await prisma.partnerProgram.update({
      where: { id: partner.id },
      data: {
        ...rest,
        ...(imageUrl === undefined ? {} : { imageUrl: imageUrl ?? null }),
      },
      select: partnerSelect,
    })

    // Pasting a link over uploaded artwork is a replacement, so the bytes go with it.
    // After the row is written, so a failure leaves an orphaned file rather than a card
    // pointing at nothing — and only when the column actually moved, because
    // `deleteIfStored` would happily delete the file a patch about the blurb just kept.
    if (imageUrl !== undefined && updated.imageUrl !== partner.imageUrl) {
      await deleteIfStored(partner.imageUrl)
    }

    return c.json(updated)
  },
)

frontPage.delete(
  '/partners/:id',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  async (c) => {
    const partner = await getPartner(c.req.param('id'))

    await prisma.partnerProgram.delete({ where: { id: partner.id } })

    // The reference goes before the bytes, so a failure leaves an orphaned file rather
    // than a card pointing at nothing. `deleteIfStored` ignores external URLs — somebody
    // else's hosting isn't ours to clean up.
    await deleteIfStored(partner.imageUrl)

    return c.json({ deleted: true })
  },
)

/**
 * The artwork as a file. `PATCH` above takes a link, for the rarer case where a program
 * has a URL that will still resolve next year.
 *
 * Upload and replace in one route, the shape the sponsor logo uses: a program is a row
 * that has artwork rather than a picture with a name attached, so the hero desk's
 * remove-then-add would mean deleting the program to change its logo.
 */
frontPage.post(
  '/partners/:id/image',
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
    const partner = await getPartner(c.req.param('id'))

    const body = await c.req.parseBody()
    const file = body['file']

    if (!(file instanceof File) || file.size === 0) {
      throw new HTTPException(400, { message: 'Attach the image itself.' })
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!looksLikeImage(bytes)) {
      throw new HTTPException(400, {
        message:
          'That file is not an image the site can show. PNG, JPEG, GIF or WebP.',
      })
    }

    const { url } = await storeFile(FileKind.IMAGE, file, user.id)

    const updated = await prisma.partnerProgram.update({
      where: { id: partner.id },
      data: { imageUrl: url },
      select: partnerSelect,
    })

    // The row points at the new bytes before the old ones go, so a failure costs an
    // orphaned file rather than a card with a broken picture on it.
    await deleteIfStored(partner.imageUrl)

    return c.json(updated)
  },
)

/** Back to the `[ IMAGE ]` well, which every card in that section is built to
    survive. */
frontPage.delete(
  '/partners/:id/image',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  async (c) => {
    const partner = await getPartner(c.req.param('id'))

    const updated = await prisma.partnerProgram.update({
      where: { id: partner.id },
      data: { imageUrl: null },
      select: partnerSelect,
    })

    await deleteIfStored(partner.imageUrl)

    return c.json(updated)
  },
)
