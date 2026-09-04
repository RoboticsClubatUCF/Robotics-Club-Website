import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { validate } from '../../core/validate.js'
import { requireOfficer } from '../../auth/authz.js'
import { prisma } from '../../core/db.js'
import {
  assertUsableRole,
  discordRoleField,
  pushRoles,
} from '../../discord/discordRoles.js'
import { copyIfStored } from '../../files/files.js'
import { appointLead } from '../../projects/projectLead.js'
import {
  DuesPlan,
  LoanStatus,
  OfficerPosition,
  OfficerTermSource,
  PrintRequestStatus,
  ProjectMemberRank,
  ProjectStatus,
  Season,
} from '../../generated/prisma/enums.js'
import type { Prisma } from '../../generated/prisma/client.js'
import { capFrom, loanDate, startsAt } from '../../equipment/loanWindow.js'
import {
  allowanceIn,
  allowanceKey,
  allowancesFor,
} from '../../printing/printAllowance.js'
import { printedColumns, printedSettings } from '../../printing/printSettings.js'
import {
  MEETING_ORDER,
  meetingFields,
  meetingRunsForward,
} from '../../projects/projectMeeting.js'
import {
  TERM_PAIRED,
  termFields,
  termFor,
  termsAgree,
} from '../../projects/projectTerm.js'
import { rateLimit } from '../../core/rateLimit.js'
import { SEASONS, forgetTermOverrides, getTerm } from '../../membership/semester.js'
import { type AuthEnv, originGuard, requireAuth } from '../../auth/session.js'
import { grantMembership } from '../member/dues.js'
import { HOLDING } from '../member/equipment.js'
import { printSelect } from '../member/print.js'

/**
 * The officer desk: club business rather than any one project's.
 *
 *   POST  /api/officer/projects                          -> create a project
 *   POST  /api/officer/projects/:id/duplicate            -> run it again next term
 *   PATCH /api/officer/projects/:id/members/:userId/rank -> appoint or demote a project lead
 *   GET   /api/officer/members?query=                    -> find a person, for the pickers
 *   POST  /api/officer/members/:id/membership            -> grant a term, no money involved
 *   GET   /api/officer/print-queue?status=&all=          -> the 3D print queue
 *   PATCH /api/officer/print/:id                         -> move one through it, and record what it cost
 *   GET   /api/officer/equipment                         -> the inventory, with what is out
 *   POST  /api/officer/equipment                         -> add an item
 *   PATCH /api/officer/equipment/:id                     -> edit or retire one
 *   DELETE /api/officer/equipment/:id                    -> remove it and its history
 *   GET   /api/officer/loans?status=&all=                -> the borrowing queue
 *   PATCH /api/officer/loans/:id                         -> approve, hand over, take back
 *   GET   /api/officer/terms                             -> today's board, seats and all
 *   PATCH /api/officer/terms/seat                        -> put somebody in a seat, or clear one
 *                                                           (`takeOver` succeeds the incumbent)
 *   DELETE /api/officer/terms/:userId                    -> stand somebody down
 *   GET   /api/officer/semesters/:year                   -> the three terms, and what dated them
 *   PUT   /api/officer/semesters/:year/:season           -> set the club's own dates
 *   DELETE /api/officer/semesters/:year/:season          -> hand it back to UCF's calendar
 *
 * The survey desk is `surveyAdmin.ts`, not here: half of it is the editor for
 * `routes/member/survey.ts` and the two are one feature read from either end.
 *
 * Projects are created here and nowhere else — which projects the club runs is a
 * board decision, and appointing their leads is that decision a step later.
 * Granting a term is here for the same reason, and writes through
 * `grantMembership` in `dues.ts` so the one file that owns `duesPaidThrough`
 * still owns it.
 *
 * Everything answers per-caller and most of it writes, so the whole router sits
 * outside `publicApi` and every route requires an officer first.
 */
export const officer = new Hono<AuthEnv>()

/**
 * One budget for all officer writes. Sixty, not the site default of five —
 * working a queue is dozens of legitimate writes in a sitting, and the people
 * this limiter guards against can't reach these routes at all.
 */
const writes = rateLimit('officer', 60)

/**
 * What officer surfaces get back about a project: the public `projectSelect` plus
 * the meeting fields, which aren't secret but which the public routes have no
 * reason to carry.
 */
export const managedProjectSelect = {
  id: true,
  slug: true,
  title: true,
  summary: true,
  season: true,
  // Both, and they aren't the same idea: `season` is the label a lead types, this
  // pair is what `currentTerm()` compares against.
  termYear: true,
  termSeason: true,
  competition: true,
  status: true,
  // The cover, its framing, and whether either is read — the editor prefills all
  // four from this shape, so a missing one is a control that opens on the wrong answer.
  coverUrl: true,
  coverFromGallery: true,
  coverFocalX: true,
  coverFocalY: true,
  coverZoom: true,
  galleryHeading: true,
  resourcesHeading: true,
  teamHeading: true,
  featured: true,
  startedAt: true,
  completedAt: true,
  meetingWeekdays: true,
  meetingStartTime: true,
  meetingEndTime: true,
  meetingLocation: true,
  meetingDescription: true,
  // Officer business rather than a lead's, and the dashboard prints it because
  // "why is my project not on the front page" is otherwise unanswerable.
  meetingsPublic: true,
  discordRoleId: true,
} as const

const createProject = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        'Slugs are lowercase words joined by hyphens, like "mars-rover".',
      )
      .max(60),
    title: z.string().trim().min(1).max(160),
    /**
     * Required, unlike the two below. This is the one line the projects list
     * prints under the title, and a project without one reads as an empty row —
     * the first thing anybody deciding whether to join sees.
     */
    summary: z.string().trim().min(1).max(500),
    season: z.string().trim().max(40).optional(),
    competition: z.string().trim().max(160).optional(),
    /**
     * The write-up, accepted at creation because it can be: it's a column on the
     * project and needs nothing to exist first, unlike a gallery picture or a
     * resource link. The desk shows every field on one page, so anything typeable
     * before the project exists has to be storable with it.
     *
     * The repository used to be here and is an ordinary resource link now, so it's
     * held in the draft and published after the create.
     */
    description: z.string().trim().max(20_000).optional(),
    ...termFields,
    /**
     * Required, unlike everything else about a project that isn't its name.
     *
     * A build's meeting time is the one thing a prospective member needs and the
     * one nobody remembers to fill in later — the columns existed for months while
     * the create form never touched them, so every project's schedule had to be
     * added by hand. Asking here is asking when somebody is thinking about it.
     *
     * The edit route lets it be cleared: starting a build without knowing when it
     * meets isn't a real case, finishing one and wanting the Tuesday off the front
     * page is.
     */
    ...meetingFields,
    ...discordRoleField,
  })
  .refine(termsAgree, TERM_PAIRED)
  .refine(meetingRunsForward, MEETING_ORDER)

officer.post(
  '/projects',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', createProject),
  async (c) => {
    const data = c.req.valid('json')

    // Pre-checked rather than caught: Prisma 7's driver adapter buries P2002 in
    // three different shapes, and two officers racing to one slug isn't worth that
    // decoding. The loser of a genuine race gets the 500 and tries again.
    if (await prisma.project.findUnique({ where: { slug: data.slug } })) {
      throw new HTTPException(409, {
        message: 'A project already has that slug.',
      })
    }

    // Nothing but the project. This used to accept a `leadUserId` and seat the lead
    // inside the create; appointing lives on the roles desk now, so one route grants
    // that rank instead of two. A project with no lead is normal — the board agrees
    // to run something before settling who runs it, and a lead may walk out with
    // nobody lined up. Checked before the write, because a role id matching nobody
    // is not an error at Discord's API or in Postgres.
    await assertUsableRole(data.discordRoleId)

    const project = await prisma.project.create({
      data: { ...data, ...(await termFor(data)) },
      select: managedProjectSelect,
    })

    return c.json(project, 201)
  },
)

/**
 * Running last term's project again this term.
 *
 * The club's builds don't fit in a semester, and the dashboard asks every project
 * which term it belongs to — so a build that carries on is several rows, one per
 * term. This is how the next row gets made without retyping a write-up somebody
 * spent an afternoon on.
 *
 * The writing comes across; the people don't. Summary, write-up, competition,
 * repository, the meeting slot, the links and the gallery are copied. Members,
 * teams, tasks and events aren't: a new term is when people decide again, and a
 * copy that re-enrolled last spring's roster would put a project on the dashboard
 * of somebody who graduated.
 *
 * The copy starts `IN_PROGRESS` and unfeatured whatever the original became.
 * Duplicating an `ARCHIVED` project is how a build comes back, so inheriting the
 * status would break the one case this route is for.
 */
const duplicateProject = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Slugs are lowercase words joined by hyphens, like "mars-rover".',
    )
    .max(60),
  /** Defaults to the original's. Offered because "Knightmare" run twice is two rows
      with one name, and some officers would rather say "Knightmare 2027". */
  title: z.string().trim().min(1).max(160).optional(),
  /** The free-text label, which almost always wants changing when the term does. */
  season: z.string().trim().max(40).nullable().optional(),
  ...termFields,
  /** Defaults to the original's, unlike the term. The same build next semester is
      the same crew in the same Discord channel, which is why the column carries no
      unique index. */
  ...discordRoleField,
}).refine(termsAgree, TERM_PAIRED)

officer.post(
  '/projects/:id/duplicate',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', duplicateProject),
  async (c) => {
    const { slug, title, season, discordRoleId, ...named } =
      c.req.valid('json')

    const source = await prisma.project.findUnique({
      where: { id: c.req.param('id') },
      select: {
        title: true,
        summary: true,
        description: true,
        season: true,
        competition: true,
        coverUrl: true,
        // The framing travels with the cover, like a gallery picture's below.
        // Copying the bytes and leaving these behind would recentre the one picture
        // the copy shows on `/projects`.
        coverFromGallery: true,
        coverFocalX: true,
        coverFocalY: true,
        coverZoom: true,
        // A lead's wording for their own sections is writing like the rest of it,
        // and the same build next semester calls them the same things.
        galleryHeading: true,
        resourcesHeading: true,
        teamHeading: true,
        discordRoleId: true,
        meetingWeekdays: true,
        meetingStartTime: true,
        meetingEndTime: true,
        meetingLocation: true,
        meetingDescription: true,
        // Copied like the rest of the writing. The same build next semester meets
        // the same nights until somebody says otherwise, and a duplicate that landed
        // off the public calendar would be a project that quietly stopped existing.
        meetingsPublic: true,
        images: {
          orderBy: { sortOrder: 'asc' },
          select: {
            url: true,
            caption: true,
            sortOrder: true,
            focalX: true,
            focalY: true,
            zoom: true,
          },
        },
        links: {
          orderBy: { sortOrder: 'asc' },
          select: { label: true, url: true, sortOrder: true },
        },
      },
    })

    if (!source) throw new HTTPException(404, { message: 'No such project' })

    // Pre-checked for the same reason `POST /projects` pre-checks it.
    if (await prisma.project.findUnique({ where: { slug } })) {
      throw new HTTPException(409, {
        message: 'A project already has that slug.',
      })
    }

    const { images, links, coverUrl, ...content } = source
    const officerId = c.get('user').id

    // Only what the officer typed is checked. The source's own id came through this
    // check when it was set, and re-checking would let a role since deleted in
    // Discord block a duplication that has nothing to do with it.
    await assertUsableRole(discordRoleId)

    // The bytes first, and outside the create: copying a gallery is a read and a
    // write per picture, and an interactive transaction holding one connection is
    // the wrong place for that. Nothing is linked yet, so the worst a failure leaves
    // is orphaned rows in `stored_files` — cheaper than a duplication that half happened.
    const [cover, gallery] = await Promise.all([
      coverUrl ? copyIfStored(coverUrl, officerId) : Promise.resolve(null),
      Promise.all(
        images.map(async (image) => ({
          ...image,
          url: await copyIfStored(image.url, officerId),
        })),
      ),
    ])

    const project = await prisma.project.create({
      data: {
        ...content,
        slug,
        ...(title === undefined ? {} : { title }),
        ...(season === undefined ? {} : { season }),
        ...(discordRoleId === undefined ? {} : { discordRoleId }),
        ...(await termFor(named)),
        coverUrl: cover,
        status: ProjectStatus.IN_PROGRESS,
        featured: false,
        images: { create: gallery },
        links: { create: links },
      },
      select: managedProjectSelect,
    })

    return c.json(project, 201)
  },
)

/**
 * Appointing and un-appointing project leads.
 *
 * A project has one lead, so appointing over a sitting one is refused with a 409
 * naming them rather than a swap: which of two people runs a build isn't something
 * to infer from a click. The officer stands the incumbent down first, with the
 * button beside this one. Re-appointing the person already there answers 200.
 *
 * The rule itself is `projects/projectLead.ts` — it needs a row lock to be true
 * under two officers pressing at once. This route keeps its own 404s, because "no
 * such project" is about the request rather than about who leads what.
 *
 * `TEAM_LEAD` is deliberately not an option here: team leads are appointed against
 * a team, through `PATCH /api/projects/:id/members/:userId` in `projectManage.ts`,
 * which officers reach as readily as leads do. One route for that rank, both
 * audiences.
 *
 * Nothing here writes `User.role`. Appointing somebody a lead used to also stamp a
 * roster label, which is the confusion this model was refactored to remove; an
 * officer appointing themselves is ordinary and costs them nothing by construction.
 */
const rankBody = z.object({
  rank: z.enum([ProjectMemberRank.PROJECT_LEAD, ProjectMemberRank.MEMBER]),
})

officer.patch(
  '/projects/:id/members/:userId/rank',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', rankBody),
  async (c) => {
    const projectId = c.req.param('id')
    const userId = c.req.param('userId')
    const { rank } = c.req.valid('json')

    const [project, user] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId } }),
      prisma.user.findUnique({ where: { id: userId } }),
    ])

    if (!project) throw new HTTPException(404, { message: 'No such project' })
    if (!user) throw new HTTPException(404, { message: 'No such member' })

    // The one-lead rule, the 409 naming the incumbent and the upsert all live in
    // `projects/projectLead.ts` — one place that sentence is true, and closing the
    // race it used to have needs a transaction this handler has no reason to open.
    const membership = await appointLead(projectId, userId, rank)

    pushRoles(
      userId,
      rank === ProjectMemberRank.PROJECT_LEAD
        ? 'appointed project lead'
        : 'stood down as project lead',
    )

    return c.json(membership)
  },
)

/**
 * The people picker. Email is in the answer on purpose — it's how an officer tells
 * two students with the same name apart, and every caller here is already trusted
 * with the roster spreadsheet.
 */
// -------------------------------------------------------------- print queue

const queueSelect = {
  ...printSelect,
  userId: true,
  termYear: true,
  termSeason: true,
  user: { select: { fullName: true, email: true, discordUsername: true } },
  decidedBy: { select: { fullName: true } },
} as const

/** What "the queue" means with nothing asked for: work still to do. */
const LIVE_PRINTS: PrintRequestStatus[] = [
  PrintRequestStatus.PENDING,
  PrintRequestStatus.PRINTING,
]

/**
 * `?all=1` — every status at once, whatever the filter says.
 *
 * The LIVE view's search box has to reach a print already done or declined, and it
 * can't search rows it was never sent. A literal rather than a coerced boolean:
 * `z.coerce.boolean()` reads the string "false" as true.
 */
const scope = z.object({ all: z.literal('1').optional() })

/**
 * Which end of the list `take` cuts from.
 *
 * Live work reads oldest-first, because that's the queue. History reads
 * newest-first, and has to — a hundred rows off the old end of a print archive is
 * the least useful hundred there are.
 */
const queueOrder = (live: boolean): 'asc' | 'desc' => (live ? 'asc' : 'desc')

officer.get(
  '/print-queue',
  requireAuth,
  requireOfficer,
  validate(
    'query',
    scope.extend({ status: z.enum(PrintRequestStatus).optional() }),
  ),
  async (c) => {
    const { status, all } = c.req.valid('query')
    const live = !all && (!status || LIVE_PRINTS.includes(status))

    const requests = await prisma.printRequest.findMany({
      // Unfiltered, the queue is the live work: waiting plus on a printer. History
      // is asked for by status, or by `all`.
      where: all ? {} : status ? { status } : { status: { in: LIVE_PRINTS } },
      orderBy: { createdAt: queueOrder(live) },
      take: 100,
      select: queueSelect,
    })

    /**
     * The requester's remaining grams beside each personal row, so an officer
     * entering a figure sees what it will do first.
     *
     * Null on the rest rather than a number nobody should act on: a project print is
     * uncapped, and a balance beside one invites weighing it against a budget it
     * doesn't come out of.
     */
    const personal = requests.filter((request) => request.project === null)
    const allowances = await allowancesFor(personal)

    return c.json(
      requests.map(({ userId, termYear, termSeason, ...request }) => ({
        ...request,
        allowance:
          request.project === null
            ? (allowances.get(allowanceKey(userId, { termYear, termSeason })) ??
              null)
            : null,
      })),
    )
  },
)

/**
 * Moving a print through the queue, and recording what it cost.
 *
 * The grams are the officer's half of the material budget: they slice the model,
 * read the figure off the slicer and type it in. On a personal print that comes out
 * of the member's allowance, and this is the only route that ever writes
 * `gramsUsed` — which is what makes `printAllowance.ts` trustworthy.
 *
 * `printed` records what actually came off the machine when it differs, because
 * officers print in whatever is on the shelf. Left off, the row reads as "printed
 * as asked".
 */
const settlePrint = z.object({
  status: z.enum(PrintRequestStatus),
  officerNote: z.string().trim().max(1_000).nullable().optional(),
  /** Whole grams — see the note on the column. */
  gramsUsed: z.number().int().min(0).max(100_000).nullable().optional(),
  printed: printedSettings,
  /**
   * Print it anyway, past the member's allowance. Never a default: going over is a
   * decision taken with the numbers in front of you, and a flag that could arrive by
   * accident would make the cap advisory.
   */
  overAllowance: z.boolean().optional(),
})

officer.patch(
  '/print/:id',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', settlePrint),
  async (c) => {
    const user = c.get('user')
    const { status, officerNote, gramsUsed, printed, overAllowance } =
      c.req.valid('json')

    const request = await prisma.printRequest.findUnique({
      where: { id: c.req.param('id') },
      select: {
        id: true,
        status: true,
        startedAt: true,
        fileId: true,
        userId: true,
        projectId: true,
        termYear: true,
        termSeason: true,
      },
    })
    if (!request) {
      throw new HTTPException(404, { message: 'No such print request.' })
    }

    // DONE and REJECTED are terminal because they're the moment the file is deleted.
    // A settled request can't reopen; there's nothing left to print from.
    const settled =
      request.status === PrintRequestStatus.DONE ||
      request.status === PrintRequestStatus.REJECTED
    if (settled) {
      throw new HTTPException(409, { message: 'This request is already settled.' })
    }

    const settling =
      status === PrintRequestStatus.DONE ||
      status === PrintRequestStatus.REJECTED

    // Nothing was printed, so there's nothing to charge. Refused rather than
    // ignored: a figure typed into a row about to be declined is a mistake worth
    // pointing at.
    if (status === PrintRequestStatus.REJECTED && gramsUsed != null) {
      throw new HTTPException(400, {
        message: 'A declined print used nothing — leave the grams empty.',
      })
    }

    const personal = request.projectId === null

    /**
     * Required on a personal DONE, and only there. Without it the allowance silently
     * stops working — the balance never moves, and the omission looks exactly like a
     * print that cost nothing. A project print is uncapped, so the figure is worth
     * having and not worth blocking the officer over.
     */
    if (status === PrintRequestStatus.DONE && personal && gramsUsed == null) {
      throw new HTTPException(400, {
        message:
          'Say how much material this took — it comes out of their allowance for the semester.',
      })
    }

    if (
      status === PrintRequestStatus.DONE &&
      personal &&
      gramsUsed != null &&
      !overAllowance
    ) {
      // Against the request's own term, not today's: the grams land in the bucket the
      // request was stamped with, whenever it's settled.
      const allowance = await allowanceIn(request.userId, request)

      if (gramsUsed > allowance.remainingGrams) {
        const over = gramsUsed - allowance.remainingGrams

        throw new HTTPException(409, {
          message: `That is ${over} g past what they have left — ${allowance.usedGrams} g of their ${allowance.limitGrams} g is already spent this semester. Print it anyway, or decline it.`,
        })
      }
    }

    // One transaction: the status flip and the byte deletion are one fact. The FK is
    // SetNull, so deleting the file clears `fileId` while the request row stays as
    // the record.
    const [updated] = await prisma.$transaction([
      prisma.printRequest.update({
        where: { id: request.id },
        data: {
          status,
          officerNote,
          ...(gramsUsed === undefined ? {} : { gramsUsed }),
          ...(printed ? printedColumns(printed) : {}),
          // Stamped once, on the first move onto a printer, and never cleared. It's
          // what later tells a cancelled print from a declined request — both land on
          // `REJECTED` and they aren't the same thing to say to the person who asked.
          ...(status === PrintRequestStatus.PRINTING && request.startedAt === null
            ? { startedAt: new Date() }
            : {}),
          // Every move, not only the settling one. "Which officer approved this" has
          // to include whoever put it on the printer.
          decidedById: user.id,
        },
        select: printSelect,
      }),
      ...(settling && request.fileId
        ? [prisma.storedFile.deleteMany({ where: { id: request.fileId } })]
        : []),
    ])

    return c.json({ ...updated, fileId: settling ? null : updated.fileId })
  },
)

// ---------------------------------------------------------------- equipment

const equipmentFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  quantity: z.number().int().min(0).max(1_000),
  /**
   * The longest a member may ask to keep one. A week unless the officer says
   * otherwise — the same default the column carries, repeated on the create schema
   * so a POST that omits it is answered by this router rather than by Postgres.
   */
  maxLoanDays: z.number().int().min(1).max(365),
}

const equipmentBody = z.object({
  ...equipmentFields,
  quantity: equipmentFields.quantity.default(1),
  maxLoanDays: equipmentFields.maxLoanDays.default(7),
})

/**
 * The same fields, all optional, and without the defaults.
 *
 * Not `equipmentBody.partial()`, which looks like it would do this and doesn't:
 * `.partial()` makes a key optional but leaves the default underneath, so a patch
 * that omits the key still writes it. Ticking "retire" sent `{ active: false }` and
 * reset the item's quantity to one on the way past.
 */
const equipmentPatch = z
  .object(equipmentFields)
  .partial()
  .extend({ active: z.boolean().optional() })

/** The inventory as both officer routes return it. One shape, one place. */
const equipmentSelect = {
  id: true,
  name: true,
  description: true,
  quantity: true,
  maxLoanDays: true,
  active: true,
  /**
   * How much history a delete would take with it. `EquipmentLoan.equipment` is
   * `Cascade`, so removing an item removes every loan against it, and the officer
   * pressing the button is the only person who can weigh that. A count is what lets
   * the warning say "and its 14 borrowing records".
   */
  _count: { select: { loans: true } },
} as const

type EquipmentRow = Prisma.EquipmentGetPayload<{ select: typeof equipmentSelect }>

/** `_count` is Prisma's shape, not the API's, and `available` is derived. */
function wireEquipment({ _count, ...item }: EquipmentRow, out: number) {
  return {
    ...item,
    out,
    available: Math.max(0, item.quantity - out),
    loanCount: _count.loans,
  }
}

/**
 * Whether something is already on the list under this name, ignoring case.
 *
 * `name` is unique in Postgres and Postgres is case-sensitive: "cordless drill" and
 * "Cordless drill" are two rows to the database and one object to the club, which
 * is how a lending list ends up with the same drill counted twice.
 */
const nameTaken = (name: string, exceptId?: string) =>
  prisma.equipment.findFirst({
    where: {
      name: { equals: name, mode: 'insensitive' },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true, name: true, quantity: true },
  })

const ALREADY_LISTED = (item: { name: string; quantity: number }) =>
  `“${item.name}” is already on the list, with ${item.quantity} of them. Change that row's number instead of adding a second one.`

/** The inventory as the lab manager sees it: everything, retired included. */
officer.get('/equipment', requireAuth, requireOfficer, async (c) => {
  const [items, held] = await Promise.all([
    prisma.equipment.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      select: equipmentSelect,
    }),
    prisma.equipmentLoan.groupBy({
      by: ['equipmentId'],
      where: { status: { in: [...HOLDING] } },
      _count: { _all: true },
    }),
  ])

  const out = new Map(held.map((row) => [row.equipmentId, row._count._all]))

  return c.json(items.map((item) => wireEquipment(item, out.get(item.id) ?? 0)))
})

officer.post(
  '/equipment',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', equipmentBody),
  async (c) => {
    const data = c.req.valid('json')

    // The club's real duplicate isn't a unique-constraint violation, it's a second
    // row for a drill the club already owns two of. Answered with what to do about
    // it rather than with the fact.
    const taken = await nameTaken(data.name)
    if (taken) throw new HTTPException(409, { message: ALREADY_LISTED(taken) })

    const item = await prisma.equipment.create({
      data,
      select: equipmentSelect,
    })

    return c.json(wireEquipment(item, 0), 201)
  },
)

/**
 * Edit or retire. `active: false` takes something off the members' list and leaves
 * its borrowing history intact, which is what nearly every item that stops being
 * lent out wants. The `DELETE` below is the other case.
 */
officer.patch(
  '/equipment/:id',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', equipmentPatch),
  async (c) => {
    const id = c.req.param('id')
    const patch = c.req.valid('json')

    const item = await prisma.equipment.findUnique({ where: { id } })
    if (!item) throw new HTTPException(404, { message: 'No such equipment.' })

    if (patch.name && patch.name !== item.name) {
      const taken = await nameTaken(patch.name, id)
      if (taken) throw new HTTPException(409, { message: ALREADY_LISTED(taken) })
    }

    const updated = await prisma.equipment.update({
      where: { id },
      data: patch,
      select: equipmentSelect,
    })

    const out = await prisma.equipmentLoan.count({
      where: { equipmentId: id, status: { in: [...HOLDING] } },
    })

    return c.json(wireEquipment(updated, out))
  },
)

/**
 * Remove an item outright, history and all.
 *
 * Retiring is still the right move nearly every time. This is the other case — a
 * typo, a duplicate, something added to the wrong club — where the row should never
 * have existed and a retired ghost of it is clutter.
 *
 * `EquipmentLoan.equipment` cascades, so this takes every loan ever made against
 * the item with it. That's the point, and it's why the count travels on the
 * inventory: the officer is told what it costs.
 *
 * Refused while a unit is out. Deleting the row that says Rowan has the drill
 * doesn't get the drill back — it loses the only record of where it is.
 */
officer.delete(
  '/equipment/:id',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  async (c) => {
    const id = c.req.param('id')

    const item = await prisma.equipment.findUnique({
      where: { id },
      select: { id: true, name: true },
    })
    if (!item) throw new HTTPException(404, { message: 'No such equipment.' })

    const out = await prisma.equipmentLoan.count({
      where: { equipmentId: id, status: { in: [...HOLDING] } },
    })
    if (out > 0) {
      throw new HTTPException(409, {
        message: `${item.name} is still out with somebody. Check it back in first — deleting it now would lose the only record of where it is.`,
      })
    }

    await prisma.equipment.delete({ where: { id } })

    // A body rather than a 204, matching the other deletes: the browser's `sendJson`
    // parses every response, and an empty one throws on the way back through it.
    return c.json({ deleted: true })
  },
)

// -------------------------------------------------------------- loan queue

const officerLoanSelect = {
  id: true,
  status: true,
  note: true,
  officerNote: true,
  dueAt: true,
  startAt: true,
  requestedDueAt: true,
  requestedAt: true,
  decidedAt: true,
  checkedOutAt: true,
  returnedAt: true,
  equipment: { select: { id: true, name: true } },
  user: { select: { fullName: true, email: true, discordUsername: true } },
  decidedBy: { select: { fullName: true } },
} as const

/** The live ledger: what needs deciding, and what is still out there. */
const LIVE_LOANS: LoanStatus[] = [LoanStatus.REQUESTED, ...HOLDING]

officer.get(
  '/loans',
  requireAuth,
  requireOfficer,
  validate('query', scope.extend({ status: z.enum(LoanStatus).optional() })),
  async (c) => {
    const { status, all } = c.req.valid('query')
    const live = !all && (!status || LIVE_LOANS.includes(status))

    const loans = await prisma.equipmentLoan.findMany({
      // Unfiltered, this is the live ledger. Finished loans are a filter away, and
      // `all` is the search reaching past both.
      where: all ? {} : status ? { status } : { status: { in: LIVE_LOANS } },
      orderBy: { requestedAt: queueOrder(live) },
      take: 100,
      select: officerLoanSelect,
    })

    return c.json(loans)
  },
)

/**
 * The whole lifecycle, one endpoint. Legal moves only — a returned loan doesn't go
 * back out, it becomes a new one — and the availability re-check at approval is
 * inside a transaction, because two officers working the queue at once is how a
 * single drill gets promised twice.
 *
 * Nothing leaves the lab without an approval first. A request used to be able to
 * jump straight to `CHECKED_OUT`, which was a convenience for the officer at the
 * shelf and a hole in the record for everybody else. Handing something over on the
 * spot is two clicks now, which buys a row that reads honestly. Checking it back in
 * was always an officer's move alone.
 */
const NEXT: Record<LoanStatus, LoanStatus[]> = {
  [LoanStatus.REQUESTED]: [LoanStatus.APPROVED, LoanStatus.DENIED],
  [LoanStatus.APPROVED]: [LoanStatus.CHECKED_OUT, LoanStatus.DENIED],
  [LoanStatus.CHECKED_OUT]: [LoanStatus.RETURNED],
  [LoanStatus.RETURNED]: [],
  [LoanStatus.DENIED]: [],
  [LoanStatus.CANCELED]: [],
}

officer.patch(
  '/loans/:id',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate(
    'json',
    z.object({
      status: z.enum(LoanStatus),
      officerNote: z.string().trim().max(1_000).nullable().optional(),
      // Bounded like the member's, for the same mistyped year. The officer's date is
      // deliberately not held to the item's cap, so this is the only thing between a
      // slipped keystroke and a loan due in 12345.
      dueAt: loanDate.nullable().optional(),
    }),
  ),
  async (c) => {
    const user = c.get('user')
    const { status, officerNote, dueAt } = c.req.valid('json')

    const loan = await prisma.equipmentLoan.findUnique({
      where: { id: c.req.param('id') },
      select: {
        id: true,
        status: true,
        equipmentId: true,
        dueAt: true,
        startAt: true,
        requestedDueAt: true,
        equipment: { select: { maxLoanDays: true } },
      },
    })
    if (!loan) throw new HTTPException(404, { message: 'No such loan.' })

    if (!NEXT[loan.status].includes(status)) {
      throw new HTTPException(409, {
        message: `A ${loan.status.toLowerCase().replace(/_/g, ' ')} loan cannot become ${status.toLowerCase().replace(/_/g, ' ')}.`,
      })
    }

    const now = new Date()
    const takingAUnit = (HOLDING as readonly LoanStatus[]).includes(status)

    /**
     * A due date, whether or not the officer typed one.
     *
     * The date box still wins; this fills the gap it leaves. The return reminder
     * hangs off `dueAt`, so a loan approved in a hurry with the box empty used to go
     * out with no deadline at all.
     *
     * The member's own date is preferred over the cap — they said when they'd bring
     * it back, and holding them to that is the point of asking. Re-checked against
     * the item's limit rather than trusted: an officer approving a fortnight-old
     * request for a thing whose cap has since shortened should get the shorter one.
     *
     * Only on the moves that actually hold a unit.
     */
    const from = startsAt(loan.startAt, now)
    const cap = capFrom(from, loan.equipment.maxLoanDays)
    const dueAtWrite =
      dueAt === undefined && takingAUnit && loan.dueAt === null
        ? loan.requestedDueAt && loan.requestedDueAt > from && loan.requestedDueAt <= cap
          ? loan.requestedDueAt
          : cap
        : dueAt

    // The transaction holds only what has to be atomic: the availability check and
    // the write it authorises. Everything inside selects scalars only — a relation
    // `select` makes Prisma fan several queries out at once, and a transaction is a
    // single connection that can't carry them.
    await prisma.$transaction(async (tx) => {
      // Inside, so the count an approval is granted against is the count at the
      // moment it's granted.
      if (takingAUnit) {
        const item = await tx.equipment.findUnique({
          where: { id: loan.equipmentId },
          select: { quantity: true },
        })
        const held = await tx.equipmentLoan.count({
          where: {
            equipmentId: loan.equipmentId,
            status: { in: [...HOLDING] },
            id: { not: loan.id },
          },
        })

        if (item && held >= item.quantity) {
          throw new HTTPException(409, {
            message: 'They are all out — nothing left to hand over.',
          })
        }
      }

      await tx.equipmentLoan.update({
        where: { id: loan.id },
        data: {
          status,
          officerNote,
          dueAt: dueAtWrite,
          decidedById: user.id,
          decidedAt: now,
          ...(status === LoanStatus.CHECKED_OUT ? { checkedOutAt: now } : {}),
          ...(status === LoanStatus.RETURNED ? { returnedAt: now } : {}),
        },
        select: { id: true },
      })
    })

    // Read back for the response, after the commit — the row is settled by now, so
    // this can't disagree with what was written.
    const updated = await prisma.equipmentLoan.findUniqueOrThrow({
      where: { id: loan.id },
      select: officerLoanSelect,
    })

    return c.json(updated)
  },
)

/**
 * Searched by name, email and Discord handle.
 *
 * The handle isn't a nicety: an account can have one and no email at all, and until
 * this arm existed those people couldn't be found by the picker that appoints
 * project leads. It's also often the only name an officer knows somebody by.
 *
 * `contains` on a `@unique` column is a sequential scan, which at club scale is
 * nothing. If the roster ever makes it hurt, the answer is a trigram index and not
 * a narrower search.
 */
officer.get(
  '/members',
  requireAuth,
  requireOfficer,
  validate('query', z.object({ query: z.string().trim().min(2).max(100) })),
  async (c) => {
    const { query } = c.req.valid('query')

    const members = await prisma.user.findMany({
      where: {
        OR: [
          { fullName: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
          { discordUsername: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: { fullName: 'asc' },
      take: 10,
      // The handle comes back too, so the picker can print it under the email — no
      // disclosure this router doesn't already make.
      select: {
        id: true,
        fullName: true,
        email: true,
        discordUsername: true,
        role: true,
        // So the roles desk can say where somebody stands before an officer grants
        // them a term. Granting one to a member already paid through spring isn't
        // harmful — it extends rather than resets — but it's a decision made blind.
        duesPaidThrough: true,
      },
    })

    return c.json(members)
  },
)

// -------------------------------------------------------------- memberships

/**
 * Giving somebody a term, without money changing hands.
 *
 * Cash at a meeting, a scholarship, an officer whose dues the board waives. All
 * three were being handled by typing a date into `dues_paid_through` in Prisma
 * Studio, which covers the person and does nothing else — the promotion, the
 * `joinedAt` stamp and any record of who decided are things `grantMembership` does
 * and a column edit can't.
 *
 * Officers, not just admins: collecting dues is the treasurer's job, and making
 * this admin-only would mean the person who takes the money can't record it.
 */
const grantBody = z.object({ plan: z.enum(DuesPlan) })

officer.post(
  '/members/:id/membership',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', grantBody),
  async (c) => {
    const member = await prisma.user.findUnique({
      where: { id: c.req.param('id') },
      select: { id: true, fullName: true, duesPaidThrough: true },
    })

    if (!member) throw new HTTPException(404, { message: 'No such member' })

    const standing = await grantMembership(
      member,
      c.req.valid('json').plan,
      c.get('user').id,
    )

    // The standing rather than the row, because the desk's next sentence is "covered
    // through 13 December" and that date is the result of the grant meeting whatever
    // they already held.
    return c.json({
      member: { id: member.id, fullName: member.fullName },
      paidThrough: standing.paidThrough?.toISOString() ?? null,
      status: standing.status,
    })
  },
)

// ------------------------------------------------------------ officer seats

/**
 * The board, and who sits in which chair.
 *
 * These were a Prisma Studio edit until now, which is the shape of thing this desk
 * exists to absorb.
 *
 * The seat is not the same fact as the role, and this route touches only the first.
 * Discord decides that somebody is an officer and writes `User.role`; an officer
 * decides which seat they hold and writes `OfficerTerm.position`. That separation is
 * what lets an `ADMIN` sit on the board, and why the faculty advisor can hold a
 * chair as a plain `MEMBER`.
 *
 * A term created here is `MANUAL`, which is load-bearing: the Discord sync only ever
 * closes what it opened, so a hand-appointed advisor survives every sweep.
 */
const boardSelect = {
  id: true,
  position: true,
  startedAt: true,
  source: true,
  fullName: true,
  user: {
    select: { id: true, fullName: true, email: true, role: true },
  },
} as const

/**
 * Today's board, seatless officers included — this desk is where a seat gets given,
 * so the people without one are the point rather than noise.
 *
 * `seats` is every seat there is, in board order, from the enum. The desk needs the
 * whole list: a picker offering only the seats already taken can't do its job. How
 * many there are is the database's answer, so adding one to the enum adds it to this
 * menu with no frontend edit.
 */
officer.get('/terms', requireAuth, requireOfficer, async (c) => {
  const board = await prisma.officerTerm.findMany({
    where: { endedAt: null },
    // Seated first in board order, then everyone waiting for a chair. Postgres sorts
    // nulls last on an ascending enum, which is the order this wants.
    orderBy: [{ position: 'asc' }, { startedAt: 'asc' }],
    select: boardSelect,
  })

  return c.json({ seats: Object.values(OfficerPosition), board })
})

const seatBody = z.object({
  userId: z.string().min(1),
  /** Null clears the seat and leaves them on the board — still an officer, just not
      in a named chair. Standing somebody down is the DELETE below, which is a
      different decision and should read like one. */
  position: z.enum(OfficerPosition).nullable(),
  /**
   * Take the seat from whoever is in it, closing their term as succeeded.
   *
   * Off by default, and it has to stay that way: the 409 below is what stops an
   * officer displacing a sitting one by mistake. The page sends this only from a
   * confirmation that names the incumbent.
   */
  takeOver: z.boolean().default(false),
})

officer.patch(
  '/terms/seat',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('json', seatBody),
  async (c) => {
    const { userId, position, takeOver } = c.req.valid('json')

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true },
    })

    if (!user) throw new HTTPException(404, { message: 'No such member' })

    /**
     * One person per seat, checked here because it can't be indexed.
     *
     * "Unique on `position` among rows where `ended_at` is null" is a partial unique
     * index, which Prisma can't express — it would live in the database and not in
     * `schema.prisma`, and the next generated migration would emit a `DROP INDEX` for
     * it. Same trade and same answer as the project-lead route.
     */
    const incumbent =
      position === null
        ? null
        : await prisma.officerTerm.findFirst({
            where: { position, endedAt: null, userId: { not: userId } },
            select: { id: true, fullName: true },
          })

    if (incumbent && !takeOver) {
      throw new HTTPException(409, {
        message: `${incumbent.fullName} already holds that seat. Move or stand them down first — the board has one of each.`,
      })
    }

    // Check-then-act, so appointing somebody already on the board moves their chair
    // rather than opening a second term for them.
    const held = await prisma.officerTerm.findFirst({
      where: { userId, endedAt: null },
      select: { id: true },
    })

    /**
     * Both writes together, because a handover half-done is worse than one not
     * started: the outgoing officer off the board with nobody in the chair, or — the
     * other order — two people holding one seat.
     *
     * The succession is recorded in the closed term rather than left as a gap. "Lost
     * the Discord role" and "handed over to Priya" are different history.
     *
     * A `MANUAL` term is closed here as readily as a `DISCORD` one, which doesn't
     * contradict the sync's rule: what the sync may not do on its own is close
     * somebody's hand-made appointment.
     */
    const term = await prisma.$transaction(async (tx) => {
      if (incumbent) {
        await tx.officerTerm.updateMany({
          // Guarded on still being open, so two officers pressing take-over in the
          // same instant close it once rather than overwriting each other's reason.
          where: { id: incumbent.id, endedAt: null },
          data: {
            endedAt: new Date(),
            endedReason: `Succeeded by ${user.fullName}`,
          },
        })
      }

      return held
        ? tx.officerTerm.update({
            where: { id: held.id },
            data: { position },
            select: boardSelect,
          })
        : tx.officerTerm.create({
            data: {
              userId,
              fullName: user.fullName,
              position,
              startedAt: new Date(),
              // `MANUAL`: the sync didn't put them here and must not take them away.
              // This is how the faculty advisor gets on the board at all.
              source: OfficerTermSource.MANUAL,
            },
            select: boardSelect,
          })
    })

    // Who was displaced, so the page can say "succeeding Jordan Ellis" rather than
    // leaving the officer to work out whether the take-over happened.
    return c.json({ ...term, succeeded: incumbent?.fullName ?? null })
  },
)

/**
 * Stand somebody down: close their term, which puts them on `/officers` as a past
 * officer rather than removing them from the site.
 *
 * Works on a `DISCORD` term as readily as a `MANUAL` one — a person is entitled to
 * leave the board without the club going into Discord to record it. The sweep will
 * reopen one if they still carry the role, which is correct: the role is the club's
 * answer and this route isn't a way to overrule it.
 */
officer.delete(
  '/terms/:userId',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  async (c) => {
    const userId = c.req.param('userId')
    const by = c.get('user')

    const { count } = await prisma.officerTerm.updateMany({
      where: { userId, endedAt: null },
      data: {
        endedAt: new Date(),
        endedReason: `Stood down by ${by.fullName}`,
      },
    })

    if (count === 0) {
      throw new HTTPException(404, {
        message: 'That person is not currently on the board.',
      })
    }

    return c.json({ closed: count })
  },
)

// ------------------------------------------------------------- term overrides

/**
 * The club's own answer for when a semester starts and ends.
 *
 * `src/membership/semester.ts` reads three sources in order — these rows, then
 * calendar.ucf.edu, then its fixed fallbacks — and the first with an answer wins.
 * The feed is somebody else's document: UCF publishes late, renames the events the
 * parser looks for, and sometimes omits a term, and the only remedy used to be
 * editing constants and deploying.
 *
 * This moves what the next payment buys and nothing already sold: every
 * `DuesPayment` stores its own `coversThrough`, so a member keeps the dates they
 * were charged against.
 */
const termParams = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  season: z.enum(Season),
})

const overrideBody = z
  .object({
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    /**
     * The club's own finals week, and the reason every project goes quiet for a
     * fortnight. Both or neither, and null clears it back to the feed's.
     *
     * Independent of the term dates rather than part of them: an officer whose only
     * complaint is that UCF published finals late shouldn't have to retype the term,
     * and one correcting the term shouldn't silently lose the feed's finals.
     */
    finalsStartsAt: z.coerce.date().nullable().default(null),
    finalsEndsAt: z.coerce.date().nullable().default(null),
    note: z.string().trim().max(200).nullable().default(null),
  })
  .refine(({ startsAt, endsAt }) => startsAt < endsAt, {
    message: 'A term has to end after it starts.',
    path: ['endsAt'],
  })
  .refine(
    ({ finalsStartsAt, finalsEndsAt }) =>
      (finalsStartsAt === null) === (finalsEndsAt === null),
    {
      message: 'Name both ends of finals week, or neither.',
      path: ['finalsEndsAt'],
    },
  )
  .refine(
    ({ finalsStartsAt, finalsEndsAt }) =>
      finalsStartsAt === null ||
      finalsEndsAt === null ||
      finalsStartsAt < finalsEndsAt,
    {
      message: 'Finals week has to end after it starts.',
      path: ['finalsEndsAt'],
    },
  )
  .refine(
    ({ startsAt, endsAt, finalsStartsAt, finalsEndsAt }) =>
      finalsStartsAt === null ||
      finalsEndsAt === null ||
      (finalsStartsAt >= startsAt && finalsEndsAt <= endsAt),
    {
      // Not pedantry: finals outside the term is a window nothing ever matches, so
      // every project keeps meeting and the officer who set it can't tell.
      message: 'Finals week has to fall inside the term.',
      path: ['finalsStartsAt'],
    },
  )

/**
 * Every term of one year, as the desk draws it: what the site currently believes,
 * and whether that came from an override, the feed or the fallbacks.
 *
 * Reads through `getTerm` rather than the table, deliberately — the desk has to show
 * the answer actually in force, and reading the overrides alone would show the two
 * thirds of the year nobody has touched as blank.
 */
officer.get(
  '/semesters/:year',
  requireAuth,
  requireOfficer,
  validate('param', z.object({ year: z.coerce.number().int().min(2000).max(2100) })),
  async (c) => {
    const { year } = c.req.valid('param')

    const terms = await Promise.all(
      SEASONS.map(async (season) => {
        const term = await getTerm(year, season)
        return {
          year,
          season,
          startsAt: term.startsAt,
          endsAt: term.endsAt,
          /** Which of the three answered. The desk says so, because "these dates are
              a guess" and "an officer typed these" want different words in front of
              them. */
          source: term.overridden
            ? ('override' as const)
            : term.fromCalendar
              ? ('calendar' as const)
              : ('fallback' as const),
          /** When the club puts every project on halt, and who said so. A null pair
              is "nobody has said" and nothing is paused — the desk prints that in
              words, because a blank row otherwise reads as a finals week of zero
              days. */
          finalsStartAt: term.finalsStartAt,
          finalsEndAt: term.finalsEndAt,
          finalsSource: term.finalsSource,
          note: term.overrideNote,
        }
      }),
    )

    return c.json(terms)
  },
)

officer.put(
  '/semesters/:year/:season',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('param', termParams),
  validate('json', overrideBody),
  async (c) => {
    const { year, season } = c.req.valid('param')
    const { startsAt, endsAt, finalsStartsAt, finalsEndsAt, note } =
      c.req.valid('json')
    const by = c.get('user')

    const dates = { startsAt, endsAt, finalsStartsAt, finalsEndsAt, note }

    const saved = await prisma.termOverride.upsert({
      where: { year_season: { year, season } },
      create: { year, season, ...dates, setById: by.id },
      update: { ...dates, setById: by.id },
      select: {
        year: true,
        season: true,
        startsAt: true,
        endsAt: true,
        finalsStartsAt: true,
        finalsEndsAt: true,
        note: true,
      },
    })

    // The cache in `semester.ts` is what every dues read goes through and it holds a
    // term for an hour. Without this the officer who just moved spring watches the
    // old dates for the rest of the afternoon.
    forgetTermOverrides()

    return c.json(saved)
  },
)

/** Hand the term back to UCF's calendar. */
officer.delete(
  '/semesters/:year/:season',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  validate('param', termParams),
  async (c) => {
    const { year, season } = c.req.valid('param')

    const { count } = await prisma.termOverride.deleteMany({
      where: { year, season },
    })

    forgetTermOverrides()

    return c.json({ removed: count })
  },
)
