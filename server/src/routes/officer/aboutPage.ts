import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { requireOfficer } from '../../auth/authz.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { rateLimit } from '../../core/rateLimit.js'
import { refusal, webUrl } from '../../core/validate.js'
import { deleteIfStored, looksLikeImage, storeFile } from '../../files/files.js'
import { FileKind } from '../../generated/prisma/enums.js'
import type { AboutMilestoneCreateManyInput } from '../../generated/prisma/models.js'
import { type AuthEnv, originGuard, requireAuth } from '../../auth/session.js'
import { framingFields } from '../projects/projectManage.js'

/**
 * `/about`, written by officers.
 *
 *   PUT /api/officer/about -> the whole page, numbers and timeline included
 *
 * One route, because it's one page. Every other content desk here is a handful of routes
 * over a list an officer adds to over a term. This is prose somebody sits down and
 * rewrites, and its editor is on the page itself with one SAVE and one CANCEL. A timeline
 * that wrote itself the moment a line was dragged, inside a form that waited for SAVE,
 * would mean an officer pressing CANCEL and keeping half of what they'd just undone.
 *
 * So the body is the whole page and the write is one transaction: the copy is upserted and
 * the numbers and timeline replaced, or neither happens. The replace is why there's no
 * `POST /milestones` — the timeline is a dozen short lines always sent together, so
 * diffing it would be machinery in the browser to save writing twelve rows.
 *
 * Timeline photos ride in the same request. The body is JSON, or multipart with the page
 * as JSON in `page` and each new photo as its own part, so a save with new pictures is
 * still one request and one transaction. Uploading them first through a route of their
 * own would leave stored files nobody references whenever the save after it failed.
 *
 * This page was a mockup and the mockup was the problem: its history was placeholder prose
 * marked as such, an honest holding pattern that could only be ended by a developer. The
 * person who can write what the club did in 1972 isn't one.
 *
 * The read isn't here. `GET /api/about` is in `content.ts`, and this file exports the
 * `select`s it answers with. The editor reads that public route too, with `no-store`:
 * `/about` holds nothing an officer may see and a visitor may not.
 *
 * The editor being on the page decides nothing. `requireOfficer` is the whole gate exactly
 * as on every desk, because where a form is drawn has never been what decides who may post
 * to it.
 */
export const aboutPage = new Hono<AuthEnv>()

/**
 * How many paragraphs the story may run to.
 *
 * Six, against a layout built around three. It's an introduction to a club, not a history
 * of one — and the page ends in a timeline and an address, both of which somebody
 * scrolling past ten paragraphs never reaches.
 *
 * Mirrored in `web/src/lib/aboutPage.ts` so the editor can't offer what this refuses.
 */
export const MAX_STORY = 6

/**
 * How many lines the timeline may carry.
 *
 * Twelve. A page of thirty entries is an archive and this is an introduction — the same
 * reason the section shipped with five.
 */
export const MAX_MILESTONES = 12

/** The singleton's key. A column default in the schema; named here so the
    routes that touch it cannot disagree about the spelling. */
export const ABOUT_ROW = 'current'

/**
 * How many cells OUR IMPACT may hold. They share one row at desktop width, and past six
 * a figure like "$150,000" has to shrink below where it reads as a headline. The club
 * gave five.
 */
export const MAX_STATS = 6

/**
 * The most one save may carry, in megabytes. Under the 32m `client_max_body_size` in
 * `nginx.conf`, so an oversized save gets this route's sentence rather than nginx's page.
 * The editor shrinks photos to 1920px first, so twelve new ones fit.
 */
export const MAX_SAVE_MB = 30

/**
 * What the page's copy is, on both sides. `content.ts` answers with this.
 *
 * `updatedAt` is the page's version. The editor sends back the one it loaded, and a save
 * from an editor opened before somebody else's save is refused rather than allowed to
 * undo it, photos included.
 */
export const aboutCopySelect = {
  heading: true,
  lede: true,
  storyNotice: true,
  story: true,
  labBuilding: true,
  labStreet: true,
  labCity: true,
  labMapUrl: true,
  onlineBlurb: true,
  updatedAt: true,
} as const

/**
 * One line on the timeline, on both sides.
 *
 * The id is here for the browser's sake and nothing else: nothing references a milestone,
 * and the save below writes fresh rows every time — so an id is a React key with a
 * lifetime of one page load rather than a handle on anything.
 */
export const milestoneSelect = {
  id: true,
  when: true,
  what: true,
  imageUrl: true,
  imageCaption: true,
  focalX: true,
  focalY: true,
  zoom: true,
} as const

/** One cell of OUR IMPACT, on both sides. */
export const statSelect = {
  id: true,
  figure: true,
  label: true,
} as const

/** Both lists in page order, as the public read and this route's answer give them. */
export const readAboutLists = () =>
  Promise.all([
    prisma.aboutStat.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: statSelect,
    }),
    prisma.aboutMilestone.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: milestoneSelect,
    }),
  ])

/** Shares the officer desk's budget rather than opening one of its own. */
const writes = rateLimit('officer', 60)

/**
 * An address box somebody left empty.
 *
 * `webUrl()` refuses an empty string, and everywhere else that's right: a URL field is
 * either absent from the body or it's a URL. Here the whole page is sent on every save, so
 * an empty box is how an officer says the club has no map link — and refusing it would
 * answer a cleared field with "that is not a web address".
 */
const clearableUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  webUrl().nullable(),
)

/**
 * A line's photograph, as the editor sends it.
 *
 * `keep` names one already on the timeline, and must: this route deletes stored files
 * that fall off the timeline, so taking any `/api/files/` address here would let a save
 * adopt a project's picture and then delete it. `upload` names a part of this request.
 */
const photoRef = z
  .union([
    z.object({ keep: z.string().min(1).max(500) }),
    z.object({ upload: z.string().regex(/^photo-\d{1,3}$/) }),
  ])
  .nullable()

/**
 * The whole page in one body.
 *
 * The lab's four fields are nullable as a set, and every one is sent whether or not it was
 * filled in: `PUT` is the whole of the thing, so a body that omits the street is asking for
 * no street rather than to keep the one that's there.
 *
 * `stats` and each line's `photo` are required for the same reason. An editor loaded before
 * they existed would otherwise save the page with no numbers and every photo deleted.
 * `stats` sits ahead of `milestones` so that editor is told to reload rather than which
 * field it missed.
 *
 * `version` is the `updatedAt` the editor loaded, or null if it loaded no row.
 */
const aboutBody = z.object({
  heading: z.string().trim().min(1).max(120),
  lede: z.string().trim().min(1).max(800),
  /**
   * The panel above the story admitting it's placeholder text. Null — or an empty box,
   * which means the same — takes it off the page, and that's what finishing the history
   * looks like rather than a state to be talked out of.
   */
  storyNotice: z.string().trim().max(400).nullable().default(null),
  story: z.array(z.string().trim().min(1).max(1500)).max(MAX_STORY).default([]),
  labBuilding: z.string().trim().max(120).nullable().default(null),
  labStreet: z.string().trim().max(120).nullable().default(null),
  labCity: z.string().trim().max(120).nullable().default(null),
  labMapUrl: clearableUrl.default(null),
  onlineBlurb: z.string().trim().min(1).max(500),
  stats: z
    .array(
      z.object({
        figure: z.string().trim().min(1).max(40),
        label: z.string().trim().min(1).max(120),
      }),
      { error: 'This editor is out of date. Reload the page and make the change again.' },
    )
    .max(MAX_STATS),
  milestones: z
    .array(
      z.object({
        /** A year, or a span, or "Last spring". Free text because the page prints it as
            one — see the column. */
        when: z.string().trim().min(1).max(40),
        what: z.string().trim().min(1).max(300),
        photo: photoRef,
        imageCaption: z.string().trim().max(160).nullable().default(null),
        ...framingFields,
      }),
    )
    .max(MAX_MILESTONES)
    .default([]),
  version: z.string().max(40).nullable(),
})

type AboutBody = z.infer<typeof aboutBody>

/**
 * The body and its photos, from either shape of request.
 *
 * Not `validate('json')`, which can't stand in front of multipart. The refusal is the
 * same sentence it would have given.
 */
async function readSave(c: Context<AuthEnv>) {
  const multipart = (c.req.header('Content-Type') ?? '').startsWith(
    'multipart/form-data',
  )

  let raw: unknown
  const files = new Map<string, File>()

  if (multipart) {
    const form = await c.req.parseBody()
    for (const [name, value] of Object.entries(form)) {
      if (value instanceof File) files.set(name, value)
    }
    try {
      raw = JSON.parse(typeof form['page'] === 'string' ? form['page'] : '')
    } catch {
      throw new HTTPException(400, {
        message: 'The page itself was missing from the save.',
      })
    }
  } else {
    try {
      raw = await c.req.json()
    } catch {
      throw new HTTPException(400, {
        message: 'That request was not in a shape this accepts.',
      })
    }
  }

  const parsed = aboutBody.safeParse(raw)
  if (!parsed.success) {
    throw new HTTPException(400, { message: refusal(parsed.error) })
  }

  return { body: parsed.data, files }
}

const photoOnLine = (index: number) => `The photo on timeline line ${index + 1}`

/**
 * Every new photo the save carries, checked before anything is stored, so a refused save
 * stores nothing. Kept photos are checked against the timeline inside the transaction.
 */
async function checkUploads(body: AboutBody, files: Map<string, File>) {
  const maxBytes = env.MAX_IMAGE_FILE_MB * 1024 * 1024

  for (const [index, line] of body.milestones.entries()) {
    const photo = line.photo
    if (photo === null || 'keep' in photo) continue

    const where = photoOnLine(index)
    const file = files.get(photo.upload)
    if (!file || file.size === 0) {
      throw new HTTPException(400, {
        message: `${where} didn't arrive. Add it again.`,
      })
    }
    if (file.size > maxBytes) {
      throw new HTTPException(413, {
        message: `${where} is too big. The cap is ${env.MAX_IMAGE_FILE_MB} MB.`,
      })
    }
    if (!looksLikeImage(new Uint8Array(await file.arrayBuffer()))) {
      throw new HTTPException(400, {
        message: `${where} is not an image the site can show. PNG, JPEG, GIF or WebP.`,
      })
    }
  }
}

/** An empty box and an absent field are the same answer for every nullable string on this
    page: nothing to print. */
const orNull = (value: string | null) =>
  value === null || value === '' ? null : value

aboutPage.put(
  '/',
  originGuard,
  requireAuth,
  requireOfficer,
  bodyLimit({
    maxSize: MAX_SAVE_MB * 1024 * 1024,
    onError: () => {
      throw new HTTPException(413, {
        message:
          'That is more new photos than one save can carry. Save a few, then add the rest.',
      })
    },
  }),
  writes,
  async (c) => {
    const user = c.get('user')
    const { body, files } = await readSave(c)

    await checkUploads(body, files)

    const fields = {
      heading: body.heading,
      lede: body.lede,
      storyNotice: orNull(body.storyNotice),
      story: body.story,
      labBuilding: orNull(body.labBuilding),
      labStreet: orNull(body.labStreet),
      labCity: orNull(body.labCity),
      labMapUrl: orNull(body.labMapUrl),
      onlineBlurb: body.onlineBlurb,
    }

    // Stored before the transaction rather than inside it, since a transaction holding the
    // page's lock shouldn't also be writing megabytes. Anything stored is deleted again if
    // the save doesn't commit. One file per part, even if two lines name the same one.
    const uploaded = new Map<string, string>()
    let saved
    let held: Set<string>
    let milestones: AboutMilestoneCreateManyInput[]

    try {
      for (const line of body.milestones) {
        const photo = line.photo
        if (photo === null || !('upload' in photo) || uploaded.has(photo.upload)) {
          continue
        }
        const file = files.get(photo.upload)
        if (file) {
          uploaded.set(photo.upload, (await storeFile(FileKind.IMAGE, file, user.id)).url)
        }
      }

      milestones = body.milestones.map((line, index) => {
        const photo = line.photo
        const imageUrl =
          photo === null
            ? null
            : 'keep' in photo
              ? photo.keep
              : (uploaded.get(photo.upload) ?? null)

        return {
          when: line.when,
          what: line.what,
          imageUrl,
          imageCaption: imageUrl === null ? null : orNull(line.imageCaption),
          // Spread rather than assigned, so an omitted field takes the column's default.
          ...(line.focalX === undefined ? {} : { focalX: line.focalX }),
          ...(line.focalY === undefined ? {} : { focalY: line.focalY }),
          ...(line.zoom === undefined ? {} : { zoom: line.zoom }),
          sortOrder: index,
        }
      })

      /**
       * One transaction, so the page is never half saved, and it holds the page row's lock
       * from the version check to the commit, so two officers saving at once are taken one
       * after the other and the second is refused. Without that, the second save would
       * delete photos the first had just added, which unlike a paragraph can't be retyped.
       *
       * The unfiltered `deleteMany`s are the one place on this API that deliberately takes
       * every row of a table, and they're safe for the reason nothing else here would be:
       * the request carries the whole list, so what each deletes is exactly what the
       * statement after it puts back, and a failure rolls both away. It's also why the
       * suite borrows the club's numbers and timeline and hands them back rather than
       * namespacing fixtures.
       */
      ;({ saved, held } = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM about_page WHERE id = ${ABOUT_ROW} FOR UPDATE`

        const current = await tx.aboutPage.findUnique({
          where: { id: ABOUT_ROW },
          select: { updatedAt: true },
        })
        if ((current?.updatedAt.toISOString() ?? null) !== body.version) {
          throw new HTTPException(409, {
            message:
              'Somebody saved this page while you were editing it. Reload to see their changes, then make yours again.',
          })
        }

        const before = await tx.aboutMilestone.findMany({ select: { imageUrl: true } })
        const onPage = new Set(
          before.flatMap((row) => (row.imageUrl ? [row.imageUrl] : [])),
        )

        for (const [index, line] of body.milestones.entries()) {
          if (line.photo && 'keep' in line.photo && !onPage.has(line.photo.keep)) {
            throw new HTTPException(409, {
              message: `${photoOnLine(index)} is no longer on the page. Reload and try again.`,
            })
          }
        }

        const copy = await tx.aboutPage.upsert({
          where: { id: ABOUT_ROW },
          create: { id: ABOUT_ROW, ...fields },
          update: fields,
          select: aboutCopySelect,
        })
        await tx.aboutStat.deleteMany()
        await tx.aboutStat.createMany({
          data: body.stats.map((stat, index) => ({ ...stat, sortOrder: index })),
        })
        await tx.aboutMilestone.deleteMany()
        await tx.aboutMilestone.createMany({ data: milestones })

        return { saved: copy, held: onPage }
      }))
    } catch (error) {
      await Promise.all([...uploaded.values()].map((url) => deleteIfStored(url)))
      throw error
    }

    // After the commit, so a failure leaves an orphaned file rather than a line pointing
    // at nothing. Only what this save took off the timeline goes, and a failure here is
    // logged rather than reported: the page did save.
    const kept = new Set(
      milestones.flatMap((row) => (row.imageUrl ? [row.imageUrl] : [])),
    )
    try {
      for (const url of held) {
        if (!kept.has(url)) await deleteIfStored(url)
      }
    } catch (error) {
      console.error('about: a removed timeline photo could not be deleted', error)
    }

    const [stats, timeline] = await readAboutLists()

    // The saved page, in the shape the public route answers with, so the editor can put it
    // straight on screen without a second read.
    return c.json({ ...saved, stats, milestones: timeline })
  },
)
