import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { validate } from '../../core/validate.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { LoanStatus } from '../../generated/prisma/enums.js'
import { DAY_MS, loanDate, loanDays, startsAt } from '../../equipment/loanWindow.js'
import { notifyOfficers } from '../../discord/officerNotify.js'
import { rateLimit } from '../../core/rateLimit.js'
import { requireDuesForRoute } from '../../auth/authz.js'
import { type AuthEnv, originGuard, requireAuth } from '../../auth/session.js'

/**
 * Borrowing club equipment, from the member's side.
 *
 *   GET  /api/equipment              -> what there is, and how much is free
 *   POST /api/equipment/:id/loans    -> ask for one
 *   POST /api/equipment/loans/:id/cancel -> change your mind, before it is decided
 *
 * The inventory and every decision about a loan are officer-run — see `officer.ts`. This router is
 * the counter, not the store room.
 *
 * Paid-up members only, not merely signed-in: `requireDuesForRoute` is the whole gate, the same one
 * the management pages use, because the club lends its own things and an account is not a
 * membership. It used to be a stricter check of its own, `requireClubMember`, which also refused a
 * `GUEST` — that mattered when the summer granted everybody access whether or not they had claimed
 * it. It no longer does, so the two collapsed. See `authz.ts`.
 *
 * A loan holds a unit from the moment it's approved, not from collection: a drill promised to
 * somebody who hasn't walked over yet isn't available to the next person. `HOLDING` below is that
 * rule, and it's the only definition of "out" anywhere in the codebase — a reservation for next
 * month included, which `schema.prisma` explains at length.
 */
export const equipment = new Hono<AuthEnv>()

const requests = rateLimit('equipment', 10)

/** The statuses that occupy a unit. Approved-but-uncollected counts. */
export const HOLDING = [LoanStatus.APPROVED, LoanStatus.CHECKED_OUT] as const

export const loanSelect = {
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
} as const

/**
 * How far ahead the club will take a booking.
 *
 * Not a policy so much as a floor under nonsense: a reservation for 2031 is a
 * unit held off the shelf for five years by somebody who has graduated. Half a
 * year comfortably covers "I need this for the competition next semester".
 */
const MAX_BOOKING_DAYS = 180

/**
 * The catalogue with a live count of what is free.
 *
 * One `groupBy` for every item's held count rather than a query per item —
 * the list is short, but N+1 in a loop is how a short list stops being fast
 * without anybody noticing.
 */
equipment.get('/', requireAuth, requireDuesForRoute, async (c) => {
  const [items, held] = await Promise.all([
    prisma.equipment.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        quantity: true,
        maxLoanDays: true,
      },
    }),
    prisma.equipmentLoan.groupBy({
      by: ['equipmentId'],
      where: { status: { in: [...HOLDING] } },
      _count: { _all: true },
    }),
  ])

  const out = new Map(held.map((row) => [row.equipmentId, row._count._all]))

  return c.json(
    items.map((item) => ({
      ...item,
      available: Math.max(0, item.quantity - (out.get(item.id) ?? 0)),
    })),
  )
})

equipment.post(
  '/:id/loans',
  originGuard,
  requireAuth,
  requireDuesForRoute,
  requests,
  validate(
    'json',
    z.object({
      note: z.string().trim().max(500).nullable().optional(),
      /**
       * When they want it from. Absent means now — the ordinary case of
       * somebody standing in the lab — and a date in the future is a booking.
       */
      startAt: loanDate.nullable().optional(),
      /** When they say they will bring it back. Required: see below. */
      requestedDueAt: loanDate,
    }),
  ),
  async (c) => {
    const user = c.get('user')
    const equipmentId = c.req.param('id')
    const { note, startAt, requestedDueAt } = c.req.valid('json')

    const item = await prisma.equipment.findUnique({ where: { id: equipmentId } })
    if (!item || !item.active) {
      throw new HTTPException(404, { message: 'No such equipment.' })
    }

    /**
     * The window, checked before anything is written.
     *
     * A return date is required rather than optional, which is the change of mind here: the club
     * has always had one — the officer typed it at approval — but that was the desk's guess at what
     * the member wanted. Asking the person who needs the thing is a better guess, and the only way
     * the reminder can be promised, since a loan with no due date has no day before it.
     */
    const now = new Date()
    const from = startsAt(startAt, now)

    if (from.getTime() - now.getTime() > MAX_BOOKING_DAYS * DAY_MS) {
      throw new HTTPException(400, {
        message: `You can book something up to ${MAX_BOOKING_DAYS} days ahead.`,
      })
    }

    if (requestedDueAt <= from) {
      throw new HTTPException(400, {
        message: 'The date you bring it back has to be after the date you take it.',
      })
    }

    if (loanDays(from, requestedDueAt) > item.maxLoanDays) {
      throw new HTTPException(400, {
        message: `${item.name} goes out for up to ${item.maxLoanDays} ${item.maxLoanDays === 1 ? 'day' : 'days'} at a time. Ask an officer if you need it for longer.`,
      })
    }

    // One open ask per person per item. Without this, refreshing an
    // unanswered request queues a second one and the officer approves the
    // same person twice.
    const open = await prisma.equipmentLoan.count({
      where: {
        equipmentId,
        userId: user.id,
        status: { in: [LoanStatus.REQUESTED, ...HOLDING] },
      },
    })
    if (open > 0) {
      throw new HTTPException(409, {
        message: 'You already have one of these out or on the way.',
      })
    }

    // Checked here so the page can say "none left" now rather than after an
    // officer has read it. The binding check is at approval — this one races,
    // that one does not.
    const held = await prisma.equipmentLoan.count({
      where: { equipmentId, status: { in: [...HOLDING] } },
    })
    if (held >= item.quantity) {
      throw new HTTPException(409, {
        message: 'They are all out at the moment. Ask again when one is back.',
      })
    }

    const loan = await prisma.equipmentLoan.create({
      data: {
        equipmentId,
        userId: user.id,
        note: note ?? null,
        // Only a genuine booking is stored. A start date that has already
        // gone by means "now", and writing it down would turn every ordinary
        // ask into a reservation for this morning.
        startAt: from > now ? from : null,
        requestedDueAt,
      },
      select: loanSelect,
    })

    void notifyOfficers(
      `🔧 ${user.fullName} asked to borrow ${item.name}${
        loan.startAt ? ` from ${loan.startAt.toDateString()}` : ''
      }, back by ${requestedDueAt.toDateString()}. Queue: ${env.SITE_URL}/dashboard/officer/equipment`,
    ).catch((error: unknown) => {
      console.error('officer notify failed', error)
    })

    return c.json(loan, 201)
  },
)

equipment.post(
  '/loans/:id/cancel',
  originGuard,
  requireAuth,
  requireDuesForRoute,
  requests,
  async (c) => {
    const user = c.get('user')

    const loan = await prisma.equipmentLoan.findUnique({
      where: { id: c.req.param('id') },
      select: { id: true, userId: true, status: true },
    })

    if (!loan || loan.userId !== user.id) {
      throw new HTTPException(404, { message: 'No such loan.' })
    }

    // Only an undecided ask. Once an officer has set something aside, giving
    // it back is a conversation and a shelf, not a button.
    if (loan.status !== LoanStatus.REQUESTED) {
      throw new HTTPException(409, {
        message: 'An officer has already picked this up — talk to them about it.',
      })
    }

    const updated = await prisma.equipmentLoan.update({
      where: { id: loan.id },
      data: { status: LoanStatus.CANCELED, decidedAt: new Date() },
      select: loanSelect,
    })

    return c.json(updated)
  },
)
