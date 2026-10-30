import { Hono, type MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import {
  isOfficer,
  ledProjectIds,
  requireCurrentDues,
  requireOfficer,
  runsPrintQueue,
} from '../../auth/authz.js'
import {
  type AuthEnv,
  type SessionUser,
  originGuard,
  requireAuth,
} from '../../auth/session.js'
import { prisma } from '../../core/db.js'
import { rateLimit } from '../../core/rateLimit.js'
import { validate } from '../../core/validate.js'
import { pushRoles } from '../../discord/discordRoles.js'
import { notifyPrintOwner } from '../../discord/printNotify.js'
import { PrintRequestStatus, UserRole } from '../../generated/prisma/enums.js'
import { membershipStanding } from '../../membership/semester.js'
import {
  allowanceIn,
  allowanceKey,
  allowancesFor,
  roundGrams,
} from '../../printing/printAllowance.js'
import { deleteHeldFiles } from '../../printing/printLifecycle.js'
import { printedColumns, printedSettings } from '../../printing/printSettings.js'
import { printSelect, withGrams } from '../member/print.js'

/**
 * The 3D print queue, and who may work it.
 *
 *   GET    /api/officer/print-queue?status=&all=  -> the queue, as far as the caller may see it
 *   PATCH  /api/officer/print/:id                 -> move one through it, and record what it cost
 *   GET    /api/officer/print/:id/slice-file      -> a sliced filament plate's .3mf
 *   GET    /api/officer/print-operators           -> the members an officer has let run the queue
 *   PUT    /api/officer/print-operators/:userId   -> let one in
 *   DELETE /api/officer/print-operators/:userId   -> take it back
 *
 * Three kinds of caller, all needing current dues:
 *
 *   - Officers work every print.
 *   - Operators, members an officer let in, work every print but their own, and can stop one
 *     that's on the printer. Declining a waiting request and printing past somebody's
 *     allowance stay with officers: both judge the request.
 *   - Project leads see the prints sent for projects they lead, and may decline one that's
 *     still waiting. Nothing else: they aren't at the printer.
 *
 * One person can be an operator and a lead and gets both. Each row carries `can`, worked out
 * here, so the page only draws buttons that will go through.
 *
 * Under `/api/officer` because the page always lived there; granting is officers only.
 */
export const printQueue = new Hono<AuthEnv>()

/** The officer desk's write budget, shared: working a queue is dozens of writes a sitting. */
const writes = rateLimit('officer', 60)

const forbidden = () =>
  new HTTPException(403, { message: 'You do not have permission to do that.' })

interface QueueAccess {
  officer: boolean
  /** Works every print but their own. True for officers too. */
  operator: boolean
  /** Projects whose waiting prints they may decline. Empty for officers, who decline any. */
  leads: Set<string>
}

/**
 * What this caller may do in the queue, or the shared 403. Dues after rank, as in `authz.ts`,
 * so somebody who could never get in isn't told that paying would let them.
 */
async function queueAccess(user: SessionUser): Promise<QueueAccess> {
  const officer = isOfficer(user)
  const operator = runsPrintQueue(user)
  const leads = new Set(officer ? [] : await ledProjectIds(user.id))

  if (!operator && leads.size === 0) throw forbidden()
  await requireCurrentDues(user)

  return { officer, operator, leads }
}

/** What one print allows this caller. */
function allowed(
  access: QueueAccess,
  user: SessionUser,
  print: { userId: string; projectId: string | null; status: PrintRequestStatus },
) {
  if (access.officer) return { work: true, decline: true, override: true }

  // Somebody else settles an operator's own print, so nobody charges their own grams.
  const work = access.operator && print.userId !== user.id

  return {
    work,
    // `REJECTED` is two acts. Stopping a running print is the printer's business, so an
    // operator may; refusing a waiting request is a lead's, for their own project.
    decline:
      (print.status === PrintRequestStatus.PRINTING && work) ||
      (print.status === PrintRequestStatus.PENDING &&
        print.projectId !== null &&
        access.leads.has(print.projectId)),
    override: false,
  }
}

/** For the routes that are the printer's business: officers and operators, paid up. */
const requireQueueWorker: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const user = c.get('user')

  if (!runsPrintQueue(user)) throw forbidden()
  await requireCurrentDues(user)
  await next()
}

// -------------------------------------------------------------- the queue

const queueSelect = {
  ...printSelect,
  userId: true,
  termYear: true,
  termSeason: true,
  user: { select: { fullName: true, email: true, discordUsername: true } },
  decidedBy: { select: { fullName: true } },
  slice: { select: { outputFileId: true, layerCount: true, filamentMeters: true } },
} as const

/** Drafts are their owners' business until they're sent. */
const SENT = { not: PrintRequestStatus.DRAFT }

/** What "the queue" means with nothing asked for: work still to do. */
const LIVE_PRINTS: PrintRequestStatus[] = [
  PrintRequestStatus.PENDING,
  PrintRequestStatus.PRINTING,
]

/**
 * `?all=1` — every status at once, whatever the filter says. The loan queue in
 * `officer.ts` takes it too.
 *
 * The LIVE view's search box has to reach a print already done or declined, and it
 * can't search rows it was never sent. A literal rather than a coerced boolean:
 * `z.coerce.boolean()` reads the string "false" as true.
 */
export const scope = z.object({ all: z.literal('1').optional() })

/**
 * Which end of the list `take` cuts from.
 *
 * Live work reads oldest-first, because that's the queue. History reads
 * newest-first, and has to — a hundred rows off the old end of a print archive is
 * the least useful hundred there are.
 */
export const queueOrder = (live: boolean): 'asc' | 'desc' => (live ? 'asc' : 'desc')

printQueue.get(
  '/print-queue',
  requireAuth,
  validate(
    'query',
    scope.extend({
      status: z.enum(PrintRequestStatus).exclude([PrintRequestStatus.DRAFT]).optional(),
    }),
  ),
  async (c) => {
    const user = c.get('user')
    const access = await queueAccess(user)
    const { status, all } = c.req.valid('query')
    const live = !all && (!status || LIVE_PRINTS.includes(status))

    const requests = await prisma.printRequest.findMany({
      where: {
        // Unfiltered, the queue is the live work: waiting plus on a printer. History
        // is asked for by status, or by `all`.
        status: all ? SENT : status ? status : { in: LIVE_PRINTS },
        // A lead who doesn't work the queue sees their own projects' prints and nothing else.
        ...(access.operator ? {} : { projectId: { in: [...access.leads] } }),
      },
      // From when it was sent, so time spent on a draft doesn't move anyone up the queue.
      orderBy: { submittedAt: { sort: queueOrder(live), nulls: 'last' } },
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
      requests.map(({ userId, termYear, termSeason, slice, user: owner, ...request }) => ({
        ...withGrams(request),
        // Members' addresses are for the board; the rest of the row is what the job needs.
        user: access.officer ? owner : { ...owner, email: null },
        // Whether there's a .3mf to download, without handing out the file's id.
        sliceFile: slice?.outputFileId
          ? { layers: slice.layerCount, filamentMeters: slice.filamentMeters }
          : null,
        allowance:
          request.project === null
            ? (allowances.get(allowanceKey(userId, { termYear, termSeason })) ??
              null)
            : null,
        can: allowed(access, user, {
          userId,
          projectId: request.project?.id ?? null,
          status: request.status,
        }),
      })),
    )
  },
)

/**
 * Moving a print through the queue, and recording what it cost.
 *
 * A filament plate its owner sliced carries Orca's estimate, and MARK DONE charges that, to the
 * hundredth of a gram, unless the officer sends another figure (a failed first attempt, say). Resin and older
 * requests have no estimate, so the officer reads the grams off their slicer as before. On a
 * personal print that comes out of the member's allowance, and this is the only route that ever
 * writes `gramsUsed`, which is what makes `printAllowance.ts` trustworthy.
 *
 * `printed` records what actually came off the machine when it differs, because officers print
 * in whatever is on the shelf. Left off, the row reads as "printed as asked". A sliced plate's
 * settings are its owner's spec, so a change there goes in the note instead.
 */
const settlePrint = z.object({
  status: z.enum(PrintRequestStatus),
  officerNote: z.string().trim().max(1_000).nullable().optional(),
  /** To the hundredth of a gram, the column's precision; anything finer is rounded. */
  gramsUsed: z.number().min(0).max(100_000).transform(roundGrams).nullable().optional(),
  printed: printedSettings,
  /**
   * Print it anyway, past the member's allowance. Never a default: going over is a
   * decision taken with the numbers in front of you, and a flag that could arrive by
   * accident would make the cap advisory.
   */
  overAllowance: z.boolean().optional(),
})

printQueue.patch(
  '/print/:id',
  originGuard,
  requireAuth,
  writes,
  validate('json', settlePrint),
  async (c) => {
    const user = c.get('user')
    const access = await queueAccess(user)
    const { status, officerNote, gramsUsed: sentGrams, printed, overAllowance } =
      c.req.valid('json')

    const request = await prisma.printRequest.findUnique({
      where: { id: c.req.param('id') },
      select: {
        id: true,
        status: true,
        startedAt: true,
        userId: true,
        projectId: true,
        termYear: true,
        termSeason: true,
        slicedWith: true,
        estimatedGrams: true,
        user: { select: { id: true, fullName: true, discordId: true, discordUsername: true } },
      },
    })
    if (!request || request.status === PrintRequestStatus.DRAFT) {
      throw new HTTPException(404, { message: 'No such print request.' })
    }
    if (status === PrintRequestStatus.DRAFT) {
      throw new HTTPException(400, { message: 'Only its owner can turn a print back into a draft.' })
    }

    const can = allowed(access, user, request)
    if (status === PrintRequestStatus.REJECTED ? !can.decline : !can.work) {
      throw new HTTPException(403, {
        message:
          access.operator && request.userId === user.id
            ? 'Somebody else has to handle your own print.'
            : 'You do not have permission to do that.',
      })
    }
    if (overAllowance && !can.override) {
      throw new HTTPException(403, {
        message: 'Only an officer can print past somebody’s allowance.',
      })
    }

    if (printed && request.slicedWith !== null) {
      throw new HTTPException(400, {
        message: 'This plate was sliced by its owner. Say what changed in the note instead.',
      })
    }

    // Orca's estimate for the plate, to the hundredth of a gram, when the officer doesn't say.
    const gramsUsed =
      status === PrintRequestStatus.DONE && sentGrams == null && request.estimatedGrams !== null
        ? roundGrams(request.estimatedGrams)
        : sentGrams

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

    // Going over is an officer's call, so an operator can't start a personal print that already
    // is: nothing left, or a plate whose estimate is more than what's left.
    if (status === PrintRequestStatus.PRINTING && personal && !can.override) {
      const allowance = await allowanceIn(request.userId, request)
      const estimate =
        request.estimatedGrams === null ? null : roundGrams(request.estimatedGrams)

      if (
        allowance.remainingGrams <= 0 ||
        (estimate !== null && estimate > allowance.remainingGrams)
      ) {
        throw new HTTPException(409, {
          message: `That is past what they have left — ${allowance.remainingGrams} g of their ${allowance.limitGrams} g. Ask an officer to print it anyway.`,
        })
      }
    }

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
        const over = roundGrams(gramsUsed - allowance.remainingGrams)

        throw new HTTPException(409, {
          message: `That is ${over} g past what they have left — ${allowance.usedGrams} g of their ${allowance.limitGrams} g is already spent this semester. ${
            can.override ? 'Print it anyway, or decline it.' : 'Ask an officer to print it anyway.'
          }`,
        })
      }
    }

    // One transaction: the status flip and the byte deletion are one fact. The FKs are
    // SetNull, so deleting the files clears them while the request row stays as the record.
    const updated = await prisma.$transaction(async (tx) => {
      // A member's UNSUBMIT can land between the read above and this write.
      const now = await tx.printRequest.findUnique({
        where: { id: request.id },
        select: { status: true },
      })
      if (now?.status !== request.status) {
        throw new HTTPException(409, { message: 'This request changed. Reload the queue.' })
      }
      if (settling) await deleteHeldFiles(tx, [request.id])
      return tx.printRequest.update({
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
          ...(settling ? { settledAt: new Date() } : {}),
          // Every move, not only the settling one. "Who approved this" has to include
          // whoever put it on the printer, operator or lead as well as officer.
          decidedById: user.id,
        },
        select: printSelect,
      })
    })

    if (updated.status !== request.status) {
      void notifyPrintOwner(request.user, updated).catch((error: unknown) => {
        console.error('print owner notify failed', error)
      })
    }

    return c.json(withGrams(updated))
  },
)

/**
 * The sliced plate, for desktop OrcaSlicer: the member's models where they put them, with the
 * approved profiles and their settings inside. Named after the member and the request so a
 * downloads folder of them stays readable.
 */
printQueue.get('/print/:id/slice-file', requireAuth, requireQueueWorker, async (c) => {
  const request = await prisma.printRequest.findUnique({
    where: { id: c.req.param('id') },
    select: {
      status: true,
      fileName: true,
      user: { select: { fullName: true } },
      slice: { select: { outputFileId: true } },
    },
  })
  if (!request || request.status === PrintRequestStatus.DRAFT || !request.slice?.outputFileId) {
    throw new HTTPException(404, { message: 'This request has no sliced plate.' })
  }
  const file = await prisma.storedFile.findUnique({
    where: { id: request.slice.outputFileId },
    select: { data: true },
  })
  if (!file) throw new HTTPException(404, { message: 'This request has no sliced plate.' })

  const name = `${request.user.fullName} - ${request.fileName.replace(/\.(stl|step|stp)/gi, '')}`
    .replace(/[^\w .()-]+/g, '')
    .trim()
    .slice(0, 120)
  c.header('Cache-Control', 'private, no-store')
  c.header('Content-Type', 'model/3mf')
  c.header('Content-Disposition', `attachment; filename="${name || 'plate'}.3mf"`)
  return c.body(new Uint8Array(file.data))
})

// -------------------------------------------------------------- operators

const operatorSelect = {
  id: true,
  fullName: true,
  email: true,
  discordUsername: true,
  role: true,
  duesPaidThrough: true,
  printQueueGrantedAt: true,
  printQueueGrantedBy: { select: { fullName: true } },
} as const

type OperatorRow = {
  id: string
  fullName: string
  email: string | null
  discordUsername: string | null
  role: UserRole
  duesPaidThrough: Date | null
  printQueueGrantedAt: Date | null
  printQueueGrantedBy: { fullName: string } | null
}

/** Whether their dues let them in today. The admin exemption is `requireCurrentDues`'s. */
const current = async (row: Pick<OperatorRow, 'role' | 'duesPaidThrough'>) =>
  row.role === UserRole.ADMIN || (await membershipStanding(row.duesPaidThrough)).hasAccess

/** One operator as the desk lists them. `active` is false while their dues have lapsed. */
const wireOperator = async (row: OperatorRow) => ({
  id: row.id,
  fullName: row.fullName,
  email: row.email,
  discordUsername: row.discordUsername,
  grantedAt: row.printQueueGrantedAt,
  grantedBy: row.printQueueGrantedBy,
  active: await current(row),
})

printQueue.get('/print-operators', requireAuth, requireOfficer, async (c) => {
  const rows = await prisma.user.findMany({
    where: { printQueueGrantedAt: { not: null } },
    orderBy: { fullName: 'asc' },
    select: operatorSelect,
  })

  return c.json(await Promise.all(rows.map(wireOperator)))
})

/**
 * Let a member run the queue. They need current dues and the slicer training: the first is
 * checked again on every request, the second is never undone. Granting twice keeps the first
 * date and the officer who gave it.
 */
printQueue.put(
  '/print-operators/:userId',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  async (c) => {
    const user = c.get('user')
    const member = await prisma.user.findUnique({
      where: { id: c.req.param('userId') },
      select: { ...operatorSelect, slicerTrainedAt: true },
    })
    if (!member) throw new HTTPException(404, { message: 'No such member.' })

    if (member.printQueueGrantedAt === null) {
      if (!(await current(member))) {
        throw new HTTPException(409, {
          message: `${member.fullName}’s dues aren’t current. The queue is for active members.`,
        })
      }
      if (member.slicerTrainedAt === null) {
        throw new HTTPException(409, {
          message: `${member.fullName} hasn’t finished the slicer training yet.`,
        })
      }

      // Conditional, so two officers pressing at once leave one grant, not the later one.
      await prisma.user.updateMany({
        where: { id: member.id, printQueueGrantedAt: null },
        data: { printQueueGrantedAt: new Date(), printQueueGrantedById: user.id },
      })
      pushRoles(member.id, 'given the print queue')
    }

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: member.id },
      select: operatorSelect,
    })
    return c.json(await wireOperator(row))
  },
)

printQueue.delete(
  '/print-operators/:userId',
  originGuard,
  requireAuth,
  requireOfficer,
  writes,
  async (c) => {
    const { count } = await prisma.user.updateMany({
      where: { id: c.req.param('userId'), printQueueGrantedAt: { not: null } },
      data: { printQueueGrantedAt: null, printQueueGrantedById: null },
    })
    if (count > 0) pushRoles(c.req.param('userId'), 'print queue taken away')

    // A body rather than a 204: the browser's `sendJson` parses every response.
    return c.json({ removed: count > 0 })
  },
)
