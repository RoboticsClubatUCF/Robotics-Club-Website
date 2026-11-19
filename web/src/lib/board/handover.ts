import type {
  ApiBoardPerson,
  ApiBoardSeat,
  ApiOfficerDesk,
  OfficerPosition,
} from '../api/api'

/**
 * The handover page's plan: who holds each seat next, and who stays on without one.
 *
 * Built from today's board, so everybody keeps their place unless an officer changes it.
 * The server works out the difference itself (`POST /api/officer/terms/handover` in
 * `routes/officer/officer.ts`); this only has to describe the board as it should be.
 */

/** Somebody who can sit on the new board. `termId` is set for a term with no account
    behind it, which can only keep its seat or leave. */
export type Holder = {
  key: string
  fullName: string
  userId: string | null
  termId: string | null
  email: string | null
  discordUsername: string | null
}

export type Plan = {
  seats: Partial<Record<OfficerPosition, Holder | null>>
  seatless: Holder[]
}

export const holderOfMember = (member: ApiBoardPerson): Holder => ({
  key: `u:${member.id}`,
  fullName: member.fullName,
  userId: member.id,
  termId: null,
  email: member.email ?? null,
  discordUsername: member.discordUsername,
})

export const holderOfSeat = (seat: ApiBoardSeat): Holder =>
  seat.user
    ? holderOfMember(seat.user)
    : {
        key: `t:${seat.id}`,
        fullName: seat.fullName,
        userId: null,
        termId: seat.id,
        email: null,
        discordUsername: null,
      }

/** Today's board as a plan that changes nothing. */
export function planFrom(desk: ApiOfficerDesk): Plan {
  const seats: Plan['seats'] = {}

  for (const seat of desk.seats) {
    const held = desk.board.find((term) => term.position === seat)
    seats[seat] = held ? holderOfSeat(held) : null
  }

  return {
    seats,
    seatless: desk.board.filter((term) => term.position === null).map(holderOfSeat),
  }
}

/** Where everybody on today's board sits: a seat, or null for no named seat. */
export function placesNow(desk: ApiOfficerDesk): Map<string, OfficerPosition | null> {
  const places = new Map<string, OfficerPosition | null>()

  for (const term of desk.board) {
    const { key } = holderOfSeat(term)
    if (!places.has(key)) places.set(key, term.position)
  }

  return places
}

/** Where everybody in the plan sits. */
export function placesNext(plan: Plan): Map<string, OfficerPosition | null> {
  const places = new Map<string, OfficerPosition | null>()

  for (const [seat, holder] of Object.entries(plan.seats)) {
    if (holder) places.set(holder.key, seat as OfficerPosition)
  }
  for (const holder of plan.seatless) places.set(holder.key, null)

  return places
}

/** Take somebody out of wherever the plan has them. */
function without(plan: Plan, key: string): Plan {
  const seats: Plan['seats'] = {}

  for (const [seat, holder] of Object.entries(plan.seats)) {
    seats[seat as OfficerPosition] = holder?.key === key ? null : holder
  }

  return {
    seats,
    seatless: plan.seatless.filter((holder) => holder.key !== key),
  }
}

/**
 * Put somebody in a seat, or on the board without one. Anywhere else the plan had them
 * is emptied, so picking the vice president for president is a move rather than one
 * person in two places.
 */
export function place(plan: Plan, holder: Holder, seat: OfficerPosition | null): Plan {
  const rest = without(plan, holder.key)

  if (seat === null) {
    return { ...rest, seatless: [...rest.seatless, holder] }
  }

  return { ...rest, seats: { ...rest.seats, [seat]: holder } }
}

export const emptySeat = (plan: Plan, seat: OfficerPosition): Plan => ({
  ...plan,
  seats: { ...plan.seats, [seat]: null },
})

export const dropSeatless = (plan: Plan, key: string): Plan => ({
  ...plan,
  seatless: plan.seatless.filter((holder) => holder.key !== key),
})

export type PlanChanges = {
  /** Seats somebody holds today that nobody will. */
  emptied: OfficerPosition[]
  joining: { holder: Holder; to: OfficerPosition | null }[]
  moving: { holder: Holder; from: OfficerPosition | null; to: OfficerPosition | null }[]
  leaving: Holder[]
}

/** Everybody whose place changes, by person rather than by seat. */
export function changesOf(desk: ApiOfficerDesk, plan: Plan): PlanChanges {
  const now = placesNow(desk)
  const next = placesNext(plan)
  const holders = new Map<string, Holder>()

  for (const term of desk.board) {
    const holder = holderOfSeat(term)
    holders.set(holder.key, holder)
  }
  for (const holder of Object.values(plan.seats)) {
    if (holder) holders.set(holder.key, holder)
  }
  for (const holder of plan.seatless) holders.set(holder.key, holder)

  const changes: PlanChanges = {
    emptied: desk.seats.filter(
      (seat) =>
        desk.board.some((term) => term.position === seat) && !plan.seats[seat],
    ),
    joining: [],
    moving: [],
    leaving: [],
  }

  for (const [key, holder] of holders) {
    const from = now.get(key)
    const to = next.get(key)

    if (from === undefined && to !== undefined) changes.joining.push({ holder, to })
    else if (from !== undefined && to === undefined) changes.leaving.push(holder)
    else if (from !== undefined && to !== undefined && from !== to) {
      changes.moving.push({ holder, from, to })
    }
  }

  return changes
}

export const hasChanges = (changes: PlanChanges) =>
  changes.joining.length + changes.moving.length + changes.leaving.length > 0

/** Every seat but the faculty advisor's brings the officer desks. Mirrors `grantsDesks`
    in `server/src/membership/board.ts`. */
export const grantsDesks = (seat: OfficerPosition | null) => seat !== 'FACULTY_ADVISOR'

/** Why the plan can't be sent, or null. The server checks the same thing. */
export function problemOf(plan: Plan): string | null {
  const next = placesNext(plan)
  const someoneHasDesks = [...next].some(
    ([key, seat]) => key.startsWith('u:') && grantsDesks(seat),
  )

  return someoneHasDesks ? null : 'Nobody on the new board would have the officer desks.'
}

/** The request body: the board as it should be, and the board it was planned against. */
export function requestOf(desk: ApiOfficerDesk, plan: Plan) {
  const board = [...placesNext(plan)].map(([key, position]) =>
    key.startsWith('u:')
      ? { userId: key.slice(2), position }
      : { termId: key.slice(2), position },
  )

  return {
    expected: desk.board.map((term) => ({ id: term.id, position: term.position })),
    board,
  }
}

/**
 * Carry a plan's edits onto a board that changed underneath it. A seat the plan changed keeps
 * the plan's choice; every other seat is today's. Saves redoing eight seats because somebody
 * set one on OFFICER BOARD in the meantime.
 */
export function rebase(
  oldBase: ApiOfficerDesk,
  plan: Plan,
  desk: ApiOfficerDesk,
): Plan {
  const was = planFrom(oldBase)
  const placed = placesNext(plan)
  let next = planFrom(desk)

  for (const seat of desk.seats) {
    const mine = plan.seats[seat] ?? null
    const before = was.seats[seat] ?? null

    if ((mine?.key ?? null) === (before?.key ?? null)) continue
    next = mine ? place(next, mine, seat) : emptySeat(next, seat)
  }

  const wasSeatless = new Set(was.seatless.map((holder) => holder.key))
  for (const holder of plan.seatless) {
    if (!wasSeatless.has(holder.key)) next = place(next, holder, null)
  }
  for (const holder of was.seatless) {
    if (!placed.has(holder.key)) next = dropSeatless(next, holder.key)
  }

  return next
}
