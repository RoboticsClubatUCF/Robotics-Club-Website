import { Hono } from 'hono'
import { z } from 'zod'
import { requireOfficer } from '../../auth/authz.js'
import { prisma } from '../../core/db.js'
import { rateLimit } from '../../core/rateLimit.js'
import { validate, webUrl } from '../../core/validate.js'
import { type AuthEnv, originGuard, requireAuth } from '../../auth/session.js'

/**
 * `/about`, written by officers.
 *
 *   PUT /api/officer/about -> the whole page, timeline included
 *
 * One route, because it's one page. Every other content desk here is a handful of routes
 * over a list an officer adds to over a term. This is prose somebody sits down and
 * rewrites, and its editor is on the page itself with one SAVE and one CANCEL. A timeline
 * that wrote itself the moment a line was dragged, inside a form that waited for SAVE,
 * would mean an officer pressing CANCEL and keeping half of what they'd just undone.
 *
 * So the body is the whole page and the write is one transaction: the copy is upserted and
 * the timeline replaced, or neither happens. The replace is why there's no
 * `POST /milestones` — the timeline is a dozen short lines always sent together, so
 * diffing it would be machinery in the browser to save writing twelve rows.
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

/** What the page's copy is, on both sides. `content.ts` answers with this. */
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
} as const

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
 * The whole page in one body.
 *
 * The lab's four fields are nullable as a set, and every one is sent whether or not it was
 * filled in: `PUT` is the whole of the thing, so a body that omits the street is asking for
 * no street rather than to keep the one that's there.
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
  milestones: z
    .array(
      z.object({
        /** A year, or a span, or "Last spring". Free text because the page prints it as
            one — see the column. */
        when: z.string().trim().min(1).max(40),
        what: z.string().trim().min(1).max(300),
      }),
    )
    .max(MAX_MILESTONES)
    .default([]),
})

/** An empty box and an absent field are the same answer for every nullable string on this
    page: nothing to print. */
const orNull = (value: string | null) =>
  value === null || value === '' ? null : value

aboutPage.put(
  '/',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', aboutBody),
  async (c) => {
    const body = c.req.valid('json')

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

    /**
     * One transaction, so the page is never half saved.
     *
     * The unfiltered `deleteMany` is the one place on this API that deliberately takes
     * every row of a table, and it's safe for the reason nothing else here would be: the
     * request carries the whole timeline, so what it deletes is exactly what the statement
     * after it puts back, and a failure rolls both away. It's also why the suite borrows
     * the club's timeline and hands it back rather than namespacing fixtures.
     */
    const [saved] = await prisma.$transaction([
      prisma.aboutPage.upsert({
        where: { id: ABOUT_ROW },
        create: { id: ABOUT_ROW, ...fields },
        update: fields,
        select: aboutCopySelect,
      }),
      prisma.aboutMilestone.deleteMany(),
      prisma.aboutMilestone.createMany({
        data: body.milestones.map((milestone, index) => ({
          ...milestone,
          sortOrder: index,
        })),
      }),
    ])

    const milestones = await prisma.aboutMilestone.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: milestoneSelect,
    })

    // The saved page, in the shape the public route answers with, so the editor can put it
    // straight on screen without a second read.
    return c.json({ ...saved, milestones })
  },
)
