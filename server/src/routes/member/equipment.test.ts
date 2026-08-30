import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { prisma } from '../../core/db.js'
import { env } from '../../core/env.js'
import { LoanStatus, UserRole } from '../../generated/prisma/enums.js'
import { createSession } from '../../auth/session.js'

/**
 * Borrowing, against the live database.
 *
 * The arithmetic is what this suite is for: availability is `quantity` minus
 * the loans holding a unit, and "holding" includes APPROVED — a drill
 * promised to somebody who has not collected it yet is not free. The
 * expensive way to learn that is two members turning up for one drill.
 *
 * Discord is stubbed for the same reason `print.test.ts` stubs it: the dev
 * database has real officers with real ids in it.
 */

vi.mock('../../discord/discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../discord/discord.js')>()),
  discordConfigured: true,
  sendDirectMessage: vi.fn(() => Promise.resolve({ status: 'sent' as const })),
}))

const PREFIX = 'test-equip-'
const email = (name: string) => `${PREFIX}${name}@ucf.edu`
/** Equipment names are unique, so the fixtures are namespaced too. */
const itemName = (name: string) => `${PREFIX}${name}`

const clearWindows = () =>
  prisma.rateLimit.deleteMany({
    where: {
      OR: [{ key: { startsWith: 'equipment:' } }, { key: { startsWith: 'officer:' } }],
    },
  })

const clearRows = async () => {
  await prisma.equipment.deleteMany({ where: { name: { startsWith: PREFIX } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
}

async function cookieFor(userId: string): Promise<string> {
  const { token } = await createSession(userId)
  return `${env.SESSION_COOKIE_NAME}=${token}`
}

let memberCookie: string
let otherCookie: string
let officerCookie: string
/** Quantity 1, so every availability rule is one loan away from biting. */
let drillId: string

/**
 * Paid up, and the suite is deterministic only because they are. Both routers
 * need current dues now — the club's line is that a lapsed account gets the
 * dues page and its own projects and nothing else — and whether *anybody* is
 * lapsed depends on the calendar, so fixtures with no date would pass all
 * summer and fail the week fall's trial closes. The lapsed case is covered in
 * `authz.test.ts`, which pins its clock for the same reason.
 */
const PAID_UP = new Date('2035-12-31T23:59:59')
/**
 * The other gate, and it sits in front of the dues one. Every fixture that has
 * to reach anything needs both — a missing survey is a 403 that looks exactly
 * like a missing payment, and it is not what these tests are about.
 */
const SURVEYED = new Date('2035-09-01T00:00:00')

beforeEach(async () => {
  await clearWindows()
  await clearRows()

  const [member, other, officer] = await Promise.all([
    prisma.user.create({
      data: {
        fullName: 'Equip Member',
        email: email('member'),
        role: UserRole.MEMBER,
        duesPaidThrough: PAID_UP,
        surveyCompletedAt: SURVEYED,
      },
    }),
    prisma.user.create({
      data: {
        fullName: 'Equip Other',
        email: email('other'),
        role: UserRole.MEMBER,
        duesPaidThrough: PAID_UP,
        surveyCompletedAt: SURVEYED,
      },
    }),
    prisma.user.create({
      data: {
        fullName: 'Equip Officer',
        email: email('officer'),
        role: UserRole.OFFICER,
        duesPaidThrough: PAID_UP,
        surveyCompletedAt: SURVEYED,
      },
    }),
  ])

  const drill = await prisma.equipment.create({
    data: { name: itemName('Cordless drill'), quantity: 1 },
  })
  drillId = drill.id

  memberCookie = await cookieFor(member.id)
  otherCookie = await cookieFor(other.id)
  officerCookie = await cookieFor(officer.id)
})

afterAll(async () => {
  await clearWindows()
  await clearRows()
  await prisma.$disconnect()
})

const request = (method: string, path: string, cookie: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      cookie,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/**
 * Dates relative to now, because the route compares them to the wall clock.
 *
 * Pinning them the way the fixtures' dues are pinned would put every ask
 * either in the past or a decade past the item's borrow cap, which are the two
 * things the route refuses. `THREE_DAYS` sits comfortably inside the default
 * seven-day cap without landing on its boundary.
 */
const daysFromNow = (n: number) =>
  new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString()
const THREE_DAYS = () => daysFromNow(3)

const ask = (cookie: string, equipmentId = drillId, body: unknown = {}) =>
  request('POST', `/api/equipment/${equipmentId}/loans`, cookie, {
    note: 'For the chassis',
    requestedDueAt: THREE_DAYS(),
    ...(body as object),
  })

const decide = (loanId: string, body: unknown) =>
  request('PATCH', `/api/officer/loans/${loanId}`, officerCookie, body)

/** The fixture item, out of the member-facing catalogue. */
async function catalogueEntry(cookie = memberCookie) {
  const response = await request('GET', '/api/equipment', cookie)
  const items = (await response.json()) as {
    id: string
    available: number
    quantity: number
    maxLoanDays: number
  }[]
  return items.find((item) => item.id === drillId)!
}

describe('the catalogue', () => {
  it('needs a member, and counts what is free', async () => {
    expect((await app.request('/api/equipment')).status).toBe(401)

    // The borrow cap comes with the item, because the form has to be able to
    // say "up to seven days" before somebody picks a date it will refuse.
    expect(await catalogueEntry()).toMatchObject({
      quantity: 1,
      available: 1,
      maxLoanDays: 7,
    })
  })

  it('hides retired items from members but keeps them for officers', async () => {
    await request('PATCH', `/api/officer/equipment/${drillId}`, officerCookie, {
      active: false,
    })

    const members = (await (
      await request('GET', '/api/equipment', memberCookie)
    ).json()) as { id: string }[]
    expect(members.find((item) => item.id === drillId)).toBeUndefined()

    const officers = (await (
      await request('GET', '/api/officer/equipment', officerCookie)
    ).json()) as { id: string }[]
    expect(officers.find((item) => item.id === drillId)).toBeDefined()
  })
})

/**
 * The club lends its own things, and the gate is now the same one everything
 * else uses: `duesPaidThrough` in the future, `ADMIN` aside.
 *
 * This used to be a stricter check of its own that refused a `GUEST` whatever
 * their standing. It was necessary while the summer and the opening weeks
 * reported access for everybody — standing alone would then have handed the
 * loan shelf to an account made ten minutes ago — and redundant the moment
 * access became the date, since nothing sets that date without promoting the
 * account in the same transaction.
 *
 * Which sentence each refusal gets is `authz.test.ts`'s matrix, where the clock
 * is pinned; the wording turns on whether a free window is running today, so it
 * cannot be asserted from a suite reading the real calendar.
 */
describe('who may borrow', () => {
  const withDues = async (
    name: string,
    duesPaidThrough: Date | null,
    role: UserRole = UserRole.MEMBER,
  ) => {
    const person = await prisma.user.create({
      data: {
        fullName: 'Equip Borrower',
        email: email(name),
        role,
        duesPaidThrough,
        // Answered, always. The dues date is what these cases vary; a missing
        // survey would refuse every one of them for the other reason.
        surveyCompletedAt: SURVEYED,
      },
    })
    return cookieFor(person.id)
  }

  it('shuts the whole router to an account with no cover', async () => {
    const cookie = await withDues('lapsed', new Date('2024-01-15T00:00:00'))

    expect((await request('GET', '/api/equipment', cookie)).status).toBe(403)
    expect((await ask(cookie)).status).toBe(403)
  })

  it('refuses an account that never paid anything', async () => {
    const cookie = await withDues('newcomer', null)

    expect((await ask(cookie)).status).toBe(403)
  })

  /**
   * **The role does not decide this any more, and that is the change.** A
   * `GUEST` carrying a live date is somebody an officer set a date on by hand;
   * under one rule they are covered, and the old check refused them for a
   * reason that no longer exists.
   */
  it('lets a covered account through whatever its role says', async () => {
    const cookie = await withDues('coveredguest', PAID_UP, UserRole.GUEST)

    expect((await request('GET', '/api/equipment', cookie)).status).toBe(200)
    expect((await ask(cookie)).status).toBe(201)
  })
})

describe('the lifecycle', () => {
  it('walks REQUESTED → APPROVED → CHECKED_OUT → RETURNED, stamping each step', async () => {
    const created = await ask(memberCookie)
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: string }

    const approved = await decide(id, {
      status: 'APPROVED',
      dueAt: '2035-11-01T00:00:00.000Z',
      officerNote: 'Bench 3.',
    })
    expect(approved.status).toBe(200)
    expect(await approved.json()).toMatchObject({
      status: 'APPROVED',
      decidedBy: { fullName: 'Equip Officer' },
    })

    const out = await decide(id, { status: 'CHECKED_OUT' })
    expect((await out.json()) as unknown).toMatchObject({ status: 'CHECKED_OUT' })

    const back = await decide(id, { status: 'RETURNED' })
    expect(back.status).toBe(200)

    const final = await prisma.equipmentLoan.findUniqueOrThrow({ where: { id } })
    expect(final.status).toBe(LoanStatus.RETURNED)
    expect(final.checkedOutAt).not.toBeNull()
    expect(final.returnedAt).not.toBeNull()
    expect(final.dueAt).not.toBeNull()
  })

  it('refuses a move the lifecycle does not have, in words', async () => {
    const { id } = (await (await ask(memberCookie)).json()) as { id: string }
    await decide(id, { status: 'APPROVED' })
    await decide(id, { status: 'CHECKED_OUT' })
    await decide(id, { status: 'RETURNED' })

    const again = await decide(id, { status: 'CHECKED_OUT' })

    expect(again.status).toBe(409)
    expect(await again.json()).toMatchObject({
      error: expect.stringContaining('returned'),
    })
  })

  /**
   * The club's rule: an officer approves a request before the member can take
   * the thing. A shortcut from REQUESTED straight to CHECKED_OUT used to exist
   * for the officer standing at the shelf, and it meant the record could not
   * say an approval had happened.
   */
  it('will not hand something over that has not been approved', async () => {
    const { id } = (await (await ask(memberCookie)).json()) as { id: string }

    const straightOut = await decide(id, { status: 'CHECKED_OUT' })

    expect(straightOut.status).toBe(409)
    expect(await straightOut.json()).toMatchObject({
      error: expect.stringContaining('requested'),
    })

    // Two clicks rather than one, which is the whole cost of the change.
    expect((await decide(id, { status: 'APPROVED' })).status).toBe(200)
    expect((await decide(id, { status: 'CHECKED_OUT' })).status).toBe(200)
  })

  /** Checking something back in is an officer's move and only an officer's. */
  it('keeps check-in on the officer desk', async () => {
    const { id } = (await (await ask(memberCookie)).json()) as { id: string }
    await decide(id, { status: 'APPROVED' })
    await decide(id, { status: 'CHECKED_OUT' })

    const byMember = await request(
      'PATCH',
      `/api/officer/loans/${id}`,
      memberCookie,
      { status: 'RETURNED' },
    )

    expect(byMember.status).toBe(403)
    expect(
      await prisma.equipmentLoan.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({ status: LoanStatus.CHECKED_OUT })
  })

  it('records a denial rather than deleting the ask', async () => {
    const { id } = (await (await ask(memberCookie)).json()) as { id: string }

    const response = await decide(id, {
      status: 'DENIED',
      officerNote: 'It is in for repair.',
    })

    expect(response.status).toBe(200)
    expect(await prisma.equipmentLoan.findUnique({ where: { id } })).toMatchObject({
      status: LoanStatus.DENIED,
      officerNote: 'It is in for repair.',
    })
  })
})

describe('the availability arithmetic', () => {
  /** The rule the whole model turns on. */
  it('counts an approved-but-uncollected loan as holding the unit', async () => {
    const { id } = (await (await ask(memberCookie)).json()) as { id: string }

    // Merely requested holds nothing — an unanswered ask is not a promise.
    expect(await catalogueEntry()).toMatchObject({ available: 1 })

    await decide(id, { status: 'APPROVED' })
    expect(await catalogueEntry()).toMatchObject({ available: 0 })

    await decide(id, { status: 'CHECKED_OUT' })
    expect(await catalogueEntry()).toMatchObject({ available: 0 })

    await decide(id, { status: 'RETURNED' })
    expect(await catalogueEntry()).toMatchObject({ available: 1 })
  })

  it('refuses a second approval of the last unit, whoever is asking', async () => {
    const mine = (await (await ask(memberCookie)).json()) as { id: string }
    const theirs = (await (await ask(otherCookie)).json()) as { id: string }

    expect((await decide(mine.id, { status: 'APPROVED' })).status).toBe(200)

    // The binding check: two officers working the queue would both have seen
    // one drill free a moment ago.
    const second = await decide(theirs.id, { status: 'APPROVED' })
    expect(second.status).toBe(409)
    expect(await second.json()).toMatchObject({
      error: expect.stringContaining('all out'),
    })

    expect(
      await prisma.equipmentLoan.findUnique({ where: { id: theirs.id } }),
    ).toMatchObject({ status: LoanStatus.REQUESTED })
  })

  it('turns a new ask away once everything is out', async () => {
    const mine = (await (await ask(memberCookie)).json()) as { id: string }
    await decide(mine.id, { status: 'APPROVED' })
    await decide(mine.id, { status: 'CHECKED_OUT' })

    const response = await ask(otherCookie)

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('all out'),
    })
  })

  it('lets quantity carry more than one loan at a time', async () => {
    const bench = await prisma.equipment.create({
      data: { name: itemName('Soldering station'), quantity: 2 },
    })

    const first = (await (await ask(memberCookie, bench.id)).json()) as { id: string }
    const second = (await (await ask(otherCookie, bench.id)).json()) as { id: string }

    expect((await decide(first.id, { status: 'APPROVED' })).status).toBe(200)
    expect((await decide(second.id, { status: 'APPROVED' })).status).toBe(200)

    // The role has to be spelled out: `UserRole` defaults to `GUEST`, and the
    // counter now refuses a guest whatever their dues say. What is under test
    // here is the availability arithmetic, so this fixture has to get past the
    // door to reach it.
    const third = await prisma.user.create({
      data: {
        fullName: 'Equip Third',
        email: email('third'),
        role: UserRole.MEMBER,
        duesPaidThrough: PAID_UP,
        surveyCompletedAt: SURVEYED,
      },
    })
    const overflow = await ask(await cookieFor(third.id), bench.id)
    expect(overflow.status).toBe(409)
  })
})

describe('the member side', () => {
  it('refuses a second ask for something they already have coming', async () => {
    await ask(memberCookie)

    const again = await ask(memberCookie)

    expect(again.status).toBe(409)
    expect(await again.json()).toMatchObject({
      error: expect.stringContaining('already'),
    })
  })

  it('cancels an undecided ask, and cannot cancel a decided one', async () => {
    const { id } = (await (await ask(memberCookie)).json()) as { id: string }

    const cancelled = await request(
      'POST',
      `/api/equipment/loans/${id}/cancel`,
      memberCookie,
    )
    expect(cancelled.status).toBe(200)
    expect(await cancelled.json()).toMatchObject({ status: 'CANCELED' })

    // And a cancelled ask frees nothing, because it was holding nothing.
    expect(await catalogueEntry()).toMatchObject({ available: 1 })

    const second = (await (await ask(otherCookie)).json()) as { id: string }
    await decide(second.id, { status: 'APPROVED' })
    const late = await request(
      'POST',
      `/api/equipment/loans/${second.id}/cancel`,
      otherCookie,
    )
    expect(late.status).toBe(409)
  })

  it("cannot cancel somebody else's", async () => {
    const { id } = (await (await ask(memberCookie)).json()) as { id: string }

    const response = await request(
      'POST',
      `/api/equipment/loans/${id}/cancel`,
      otherCookie,
    )

    expect(response.status).toBe(404)
  })

  it('lists my loans and nobody else’s', async () => {
    await ask(memberCookie)
    await ask(otherCookie)

    const response = await request('GET', '/api/me/loans', memberCookie)
    const mine = (await response.json()) as { equipment: { id: string } }[]

    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ equipment: { id: drillId } })
  })
})

/**
 * When it goes out and when it comes back.
 *
 * The member says both, the item caps the gap between them, and the officer's
 * date — typed or filled in for them — is what the return reminder hangs off.
 */
describe('the borrowing window', () => {
  const loanRow = (id: string) =>
    prisma.equipmentLoan.findUniqueOrThrow({ where: { id } })

  it('needs a return date at all', async () => {
    const response = await request(
      'POST',
      `/api/equipment/${drillId}/loans`,
      memberCookie,
      { note: 'For the chassis' },
    )

    expect(response.status).toBe(400)
  })

  it("refuses a window longer than the item's cap, and says the number", async () => {
    const response = await ask(memberCookie, drillId, {
      requestedDueAt: daysFromNow(9),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('7 days'),
    })
  })

  /**
   * Floored whole days, so an afternoon ask for a date a week out is a week
   * rather than seven days and nine hours rounded up into a refusal.
   */
  it('allows the cap exactly', async () => {
    expect((await ask(memberCookie, drillId, { requestedDueAt: daysFromNow(7) })).status).toBe(
      201,
    )
  })

  it('refuses a return date that comes before the start', async () => {
    const response = await ask(memberCookie, drillId, {
      startAt: daysFromNow(5),
      requestedDueAt: daysFromNow(2),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('after'),
    })
  })

  it('stores a future start as a booking and a past one as now', async () => {
    const booked = (await (
      await ask(memberCookie, drillId, {
        startAt: daysFromNow(10),
        requestedDueAt: daysFromNow(14),
      })
    ).json()) as { id: string }

    expect(await loanRow(booked.id)).toMatchObject({ startAt: expect.any(Date) })

    // Yesterday is not an error — the date box sends the top of the chosen
    // day, so "starting today" is already in the past by lunchtime.
    const now = (await (
      await ask(otherCookie, drillId, { startAt: daysFromNow(-1) })
    ).json()) as { id: string }

    expect(await loanRow(now.id)).toMatchObject({ startAt: null })
  })

  /**
   * A date box accepts a year of four *or more* digits, so a slipped
   * keystroke reaches the API as `12345-…`. The range checks above would
   * refuse most of these anyway — but for being longer than a week rather
   * than for being wrong, which sends whoever reads the message looking for
   * the wrong problem. `loanDate` answers the real one.
   */
  it('refuses a year with too many digits in it', async () => {
    for (const bad of [
      '12345-08-14T23:59:00.000Z',
      '+275760-09-13T00:00:00.000Z',
      '9999-12-31T23:59:00.000Z',
    ]) {
      const response = await ask(memberCookie, drillId, { requestedDueAt: bad })
      expect(response.status, bad).toBe(400)
    }

    // And on the officer's date, which is deliberately *not* held to the
    // item's cap — so this bound is the only thing under it.
    const { id } = (await (await ask(memberCookie)).json()) as { id: string }
    expect(
      (await decide(id, { status: 'APPROVED', dueAt: '12345-08-14T23:59:00.000Z' }))
        .status,
    ).toBe(400)
  })

  it('will not hold something for years', async () => {
    const response = await ask(memberCookie, drillId, {
      startAt: daysFromNow(400),
      requestedDueAt: daysFromNow(403),
    })

    expect(response.status).toBe(400)
  })

  /**
   * The reason a due date is filled in rather than left empty: the reminder
   * hangs off it, and a loan approved in a hurry with the box untouched used
   * to go out with no deadline at all.
   */
  it("fills the due date in from the member's own date when the officer types none", async () => {
    const asked = daysFromNow(4)
    const { id } = (await (
      await ask(memberCookie, drillId, { requestedDueAt: asked })
    ).json()) as { id: string }

    await decide(id, { status: 'APPROVED' })

    expect((await loanRow(id)).dueAt).toEqual(new Date(asked))
  })

  it("falls back to the item's cap when the ask no longer fits it", async () => {
    const { id } = (await (await ask(memberCookie)).json()) as { id: string }

    // The cap moves under a request that is already in the queue.
    await request('PATCH', `/api/officer/equipment/${drillId}`, officerCookie, {
      maxLoanDays: 1,
    })
    await decide(id, { status: 'APPROVED' })

    const due = (await loanRow(id)).dueAt!
    expect(due.getTime()).toBeLessThan(Date.now() + 2 * 24 * 60 * 60 * 1000)
  })

  it("leaves the officer's own date alone", async () => {
    const { id } = (await (await ask(memberCookie)).json()) as { id: string }
    const chosen = daysFromNow(2)

    await decide(id, { status: 'APPROVED', dueAt: chosen })

    expect((await loanRow(id)).dueAt).toEqual(new Date(chosen))
  })
})

describe('the officer desk', () => {
  it('keeps the inventory and the queue to officers', async () => {
    expect((await request('GET', '/api/officer/equipment', memberCookie)).status).toBe(
      403,
    )
    expect((await request('GET', '/api/officer/loans', memberCookie)).status).toBe(403)
    expect(
      (
        await request('POST', '/api/officer/equipment', memberCookie, {
          name: itemName('Sneaky'),
        })
      ).status,
    ).toBe(403)
  })

  it('adds an item, refuses a duplicate name, and retires rather than deletes', async () => {
    const created = await request('POST', '/api/officer/equipment', officerCookie, {
      name: itemName('Heat gun'),
      quantity: 2,
    })
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({ available: 2, out: 0 })

    const duplicate = await request('POST', '/api/officer/equipment', officerCookie, {
      name: itemName('Heat gun'),
    })
    expect(duplicate.status).toBe(409)
  })

  /**
   * Postgres thinks "cordless drill" and "Cordless drill" are two rows. The
   * club thinks they are one drill, and a lending list that counts it twice is
   * how two people are told there is one free.
   */
  it('catches a duplicate whatever its capitals, and says what to do instead', async () => {
    const response = await request('POST', '/api/officer/equipment', officerCookie, {
      name: itemName('Cordless drill').toUpperCase(),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("Change that row's number"),
    })
  })

  it('will not rename something onto a name already taken', async () => {
    const other = await prisma.equipment.create({
      data: { name: itemName('Rivet gun') },
    })

    const response = await request(
      'PATCH',
      `/api/officer/equipment/${other.id}`,
      officerCookie,
      { name: itemName('cordless drill') },
    )

    expect(response.status).toBe(409)

    // And renaming something to what it already is stays legal — the check
    // must not trip over the row it is checking.
    expect(
      (
        await request('PATCH', `/api/officer/equipment/${other.id}`, officerCookie, {
          name: itemName('Rivet gun'),
        })
      ).status,
    ).toBe(200)
  })

  it('counts the history a delete would destroy', async () => {
    const { id } = (await (await ask(memberCookie)).json()) as { id: string }
    await decide(id, { status: 'DENIED' })

    const items = (await (
      await request('GET', '/api/officer/equipment', officerCookie)
    ).json()) as { id: string; loanCount: number }[]

    expect(items.find((item) => item.id === drillId)).toMatchObject({
      loanCount: 1,
    })
  })
})

/**
 * Deleting, which is the one irreversible thing on this desk.
 *
 * Retiring is right for nearly everything that stops being lent out. This is
 * for the row that should never have existed, and it takes the item's whole
 * borrowing history with it — so the only guard that matters is the one that
 * stops it happening while somebody is holding the thing.
 */
describe('deleting an item', () => {
  const del = (id: string, cookie = officerCookie) =>
    request('DELETE', `/api/officer/equipment/${id}`, cookie)

  it('removes the row and every loan against it', async () => {
    const { id } = (await (await ask(memberCookie)).json()) as { id: string }
    await decide(id, { status: 'DENIED' })

    const response = await del(drillId)

    expect(response.status).toBe(200)
    expect(await prisma.equipment.findUnique({ where: { id: drillId } })).toBeNull()
    // Cascaded, which is exactly what the warning in the browser promises.
    expect(await prisma.equipmentLoan.findUnique({ where: { id } })).toBeNull()
  })

  it('refuses while a unit is still out with somebody', async () => {
    const { id } = (await (await ask(memberCookie)).json()) as { id: string }
    await decide(id, { status: 'APPROVED' })

    const response = await del(drillId)

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('still out'),
    })
    expect(
      await prisma.equipment.findUnique({ where: { id: drillId } }),
    ).not.toBeNull()

    // Back on the shelf, and now it goes.
    await decide(id, { status: 'CHECKED_OUT' })
    await decide(id, { status: 'RETURNED' })
    expect((await del(drillId)).status).toBe(200)
  })

  it('is an officer’s button and nobody else’s', async () => {
    expect((await del(drillId, memberCookie)).status).toBe(403)
    expect(
      await prisma.equipment.findUnique({ where: { id: drillId } }),
    ).not.toBeNull()
  })

  it('says so when there is nothing to delete', async () => {
    expect((await del('019f0000-0000-7000-8000-000000000000')).status).toBe(404)
  })

  it('gives a new item a week-long borrow cap unless told otherwise', async () => {
    const byDefault = await request('POST', '/api/officer/equipment', officerCookie, {
      name: itemName('Bench vice'),
    })
    expect(await byDefault.json()).toMatchObject({ maxLoanDays: 7 })

    const named = await request('POST', '/api/officer/equipment', officerCookie, {
      name: itemName('Oscilloscope'),
      maxLoanDays: 2,
    })
    expect(await named.json()).toMatchObject({ maxLoanDays: 2 })
  })

  /**
   * Both editable fields carry a default, and a partial patch must not apply
   * them: retiring an item is one checkbox, and it silently resetting the
   * quantity to one would be found by an officer, not by a test.
   */
  it('leaves untouched fields untouched when retiring something', async () => {
    await request('PATCH', `/api/officer/equipment/${drillId}`, officerCookie, {
      quantity: 4,
      maxLoanDays: 30,
    })

    await request('PATCH', `/api/officer/equipment/${drillId}`, officerCookie, {
      active: false,
    })

    expect(
      await prisma.equipment.findUniqueOrThrow({ where: { id: drillId } }),
    ).toMatchObject({ quantity: 4, maxLoanDays: 30, active: false })
  })

  it('shows who is holding what', async () => {
    const { id } = (await (await ask(memberCookie)).json()) as { id: string }
    await decide(id, { status: 'APPROVED' })
    await decide(id, { status: 'CHECKED_OUT' })

    const response = await request('GET', '/api/officer/loans', officerCookie)
    const loans = (await response.json()) as {
      id: string
      user: { fullName: string }
    }[]

    expect(loans.find((loan) => loan.id === id)).toMatchObject({
      user: { fullName: 'Equip Member' },
    })
  })

  /**
   * `?all=1` is what makes the browser's search box on LIVE able to find a
   * loan that has already come back — it cannot search rows it was never
   * sent. Without it the queue is only the live ledger.
   */
  it('answers with every status when asked for all of them', async () => {
    const { id } = (await (await ask(memberCookie)).json()) as { id: string }
    await decide(id, { status: 'DENIED' })

    const live = (await (
      await request('GET', '/api/officer/loans', officerCookie)
    ).json()) as { id: string }[]
    expect(live.find((loan) => loan.id === id)).toBeUndefined()

    const all = (await (
      await request('GET', '/api/officer/loans?all=1', officerCookie)
    ).json()) as { id: string }[]
    expect(all.find((loan) => loan.id === id)).toBeDefined()
  })

  /**
   * History reads newest-first, and it has to: `take` cuts at a hundred, and
   * a hundred rows off the *old* end of a club's ledger is the least useful
   * hundred there are — a search across them would answer about last
   * September while missing this morning.
   */
  it('reads live work oldest-first and history newest-first', async () => {
    const first = (await (await ask(memberCookie)).json()) as { id: string }
    const second = (await (await ask(otherCookie)).json()) as { id: string }

    const live = (await (
      await request('GET', '/api/officer/loans', officerCookie)
    ).json()) as { id: string }[]
    const order = live.filter((loan) => [first.id, second.id].includes(loan.id))
    expect(order.map((loan) => loan.id)).toEqual([first.id, second.id])

    await decide(first.id, { status: 'DENIED' })
    await decide(second.id, { status: 'DENIED' })

    const settled = (await (
      await request('GET', '/api/officer/loans?status=DENIED', officerCookie)
    ).json()) as { id: string }[]
    const back = settled.filter((loan) => [first.id, second.id].includes(loan.id))
    expect(back.map((loan) => loan.id)).toEqual([second.id, first.id])
  })

  it('never leaks an email through the member-facing catalogue', async () => {
    await ask(memberCookie)

    const response = await request('GET', '/api/me/loans', memberCookie)

    expect(JSON.stringify(await response.json())).not.toContain('@ucf.edu')
  })
})
