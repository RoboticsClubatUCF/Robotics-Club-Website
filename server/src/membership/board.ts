import { HTTPException } from 'hono/http-exception'
import { prisma } from '../core/db.js'
import { OfficerPosition, UserRole } from '../generated/prisma/enums.js'
import { membershipStanding } from './semester.js'

/**
 * The officer board, and the rule that ties it to the officer desks.
 *
 * The board is kept by hand on the roles desk. Nothing reads Discord to decide who is on it:
 * the club's Officers role is given and taken in Discord by people, and the site neither
 * follows it nor writes it. What the site does is say, after each change, whose Discord role
 * needs changing (`DiscordToDo`).
 *
 * Holding an open term in any seat but faculty advisor makes somebody an `OFFICER`. Losing
 * the last such term hands them back to whatever their dues say. Every board write goes
 * through `changeBoard`, so the seat and the desks move in one transaction and can't drift
 * apart the way they did when one was set in Prisma Studio and the other on the desk.
 *
 * `authz.ts` still asks `User.role`, never the term. This is the writer of that column's
 * `OFFICER` edge, not a second permission check. `ADMIN` is never written: an admin can sit on
 * the board, and their role stays a person's call in Studio.
 */

/**
 * Whether a seat comes with the officer desks.
 *
 * The faculty advisor is on the board as a plain member, which is why seat and role are
 * separate columns at all. An advisor who should have the desks is an admin's call.
 */
export const grantsDesks = (position: OfficerPosition | null): boolean =>
  position !== OfficerPosition.FACULTY_ADVISOR

/** A seat's name for the archive's sentences. Mirrors `seatLabel` in `web/src/lib/officerTerms.ts`. */
export function seatName(position: OfficerPosition | null): string {
  if (position === null) return 'Officer'

  return position
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ')
}

/**
 * What somebody is once they stop being an officer.
 *
 * Not a fixed value, because both fixed answers are wrong. `MEMBER` for everybody strands an
 * ex-officer with no `duesPaidThrough`, whom `sweepLapsedMembers` then never touches again.
 * `GUEST` for everybody takes membership from somebody who paid and merely stepped off the
 * board. So it asks what the dues loop would ask and hands them back to it.
 */
export async function standingRole(
  paidThrough: Date | null,
  now: Date,
): Promise<UserRole> {
  if (paidThrough === null) return UserRole.GUEST

  const standing = await membershipStanding(paidThrough, now)

  // On guessed dates, leave them a member: taking membership away on a fallback calendar is
  // the mistake `membershipSweep` refuses to make.
  if (!standing.billable.fromCalendar) return UserRole.MEMBER

  // `duesRequired`, the signal `membershipSweep` demotes on, so an ex-officer lapses on the
  // same day an ordinary member in their position would.
  return standing.duesRequired ? UserRole.GUEST : UserRole.MEMBER
}

/** An open term as a plan is made against it. */
export type OpenTerm = {
  id: string
  userId: string | null
  position: OfficerPosition | null
  startedAt: Date
  fullName: string
}

/** Today's board. Plans are made against this and `changeBoard` checks it hasn't moved. */
export function readBoard(): Promise<OpenTerm[]> {
  return prisma.officerTerm.findMany({
    where: { endedAt: null },
    select: { id: true, userId: true, position: true, startedAt: true, fullName: true },
  })
}

const fingerprint = (terms: { id: string; position: OfficerPosition | null }[]) =>
  terms
    .map((term) => `${term.id}:${term.position ?? '-'}`)
    .sort()
    .join(',')

/** Whether a plan was made against the board as it stands. Compares seats as well as terms,
    because a seat moved in place keeps its term id. */
export const sameBoard = (
  a: { id: string; position: OfficerPosition | null }[],
  b: { id: string; position: OfficerPosition | null }[],
) => fingerprint(a) === fingerprint(b)

export const OFF = 'OFF' as const

export type Move = {
  userId: string
  /** A seat, null for the board without a named seat, or `OFF` the board altogether. */
  to: OfficerPosition | null | typeof OFF
}

export type BoardPerson = {
  id: string
  fullName: string
  discordUsername: string | null
}

/** The Discord Officers role changes a board change implies. The site makes none of them. */
export type DiscordToDo = { give: BoardPerson[]; take: BoardPerson[] }

export type BoardChangeResult = {
  joined: BoardPerson[]
  left: BoardPerson[]
  moved: BoardPerson[]
  /** Whoever lost a seat to somebody else, by name. */
  succeeded: string[]
  discord: DiscordToDo
}

/**
 * A seat taken less than a day ago is still being decided, so moving it corrects the term in
 * place. Anything older is history: the term closes and a new one opens, so the archive keeps
 * "Vice President, 2025–2026" when that person becomes president.
 */
const SETTLED_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * Change the board: move people between seats, onto it or off it, and set their role to match.
 *
 * `snapshot` is the board the caller planned against. It's read again under a lock, and a
 * difference is a 409 rather than a plan applied to a board it wasn't made for.
 *
 * `endTerms` closes open terms with no account behind them (the officers desk can enter those),
 * which a `Move` can't name.
 *
 * Nobody outside `moves` is touched, role or term.
 */
export async function changeBoard({
  snapshot,
  moves,
  endTerms = [],
  leaveReason,
  now = new Date(),
}: {
  snapshot: OpenTerm[]
  moves: Move[]
  endTerms?: string[]
  /** Why a term ends when its holder leaves and nobody takes the seat. */
  leaveReason: string
  now?: Date
}): Promise<BoardChangeResult> {
  const ids = moves.map((move) => move.userId)

  if (new Set(ids).size !== ids.length) {
    throw new HTTPException(400, { message: 'Somebody is listed twice.' })
  }

  const people = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      fullName: true,
      discordUsername: true,
      role: true,
      duesPaidThrough: true,
      joinedAt: true,
    },
  })

  if (people.length !== ids.length) {
    throw new HTTPException(404, { message: 'No such member' })
  }

  // Before the transaction, because it can read UCF's calendar and an interactive transaction
  // shouldn't wait on the network.
  const fallback = new Map<string, UserRole>()
  for (const person of people) {
    if (person.role === UserRole.OFFICER) {
      fallback.set(person.id, await standingRole(person.duesPaidThrough, now))
    }
  }

  const target = new Map(moves.map((move) => [move.userId, move.to]))
  const ending = new Set(endTerms)

  // Who sits where once this lands: everyone untouched, plus everyone moved into a seat.
  const seated = new Map<OfficerPosition, string>()

  for (const term of snapshot) {
    if (term.userId !== null && target.has(term.userId)) continue
    if (ending.has(term.id)) continue
    if (term.position !== null) seated.set(term.position, term.fullName)
  }

  for (const person of people) {
    const to = target.get(person.id)
    if (to === undefined || to === OFF || to === null) continue

    const holder = seated.get(to)
    if (holder !== undefined) {
      throw new HTTPException(409, {
        message: `${holder} already holds ${seatName(to)}. The board has one of each.`,
      })
    }

    seated.set(to, person.fullName)
  }

  const result: BoardChangeResult = {
    joined: [],
    left: [],
    moved: [],
    succeeded: [],
    discord: { give: [], take: [] },
  }

  const why = (position: OfficerPosition | null, holder: string) => {
    const successor = position === null ? undefined : seated.get(position)

    if (successor === undefined) return leaveReason

    result.succeeded.push(holder)
    return `Succeeded by ${successor}`
  }

  await prisma.$transaction(async (tx) => {
    // One board, one writer at a time. There's no row that stands for the board, so the
    // lock is advisory and held to commit. The number is arbitrary and used nowhere else.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(7340211)`

    const fresh = await tx.officerTerm.findMany({
      where: { endedAt: null },
      select: { id: true, position: true },
    })

    if (!sameBoard(fresh, snapshot)) {
      throw new HTTPException(409, {
        message: 'The board changed a moment ago. Reload it and try again.',
      })
    }

    for (const term of snapshot) {
      if (term.userId !== null || !ending.has(term.id)) continue

      await tx.officerTerm.update({
        where: { id: term.id },
        data: { endedAt: now, endedReason: why(term.position, term.fullName) },
      })
    }

    for (const person of people) {
      const to = target.get(person.id)
      if (to === undefined) continue

      const mine = snapshot.filter((term) => term.userId === person.id)
      const before = mine.some((term) => grantsDesks(term.position))
      const after = to !== OFF && grantsDesks(to)

      if (to === OFF) {
        for (const term of mine) {
          await tx.officerTerm.update({
            where: { id: term.id },
            data: { endedAt: now, endedReason: why(term.position, person.fullName) },
          })
        }

        if (mine.length > 0) result.left.push(asPerson(person))
      } else {
        const [term] = mine

        if (!term) {
          await tx.officerTerm.create({
            data: {
              userId: person.id,
              fullName: person.fullName,
              position: to,
              startedAt: now,
            },
          })
          result.joined.push(asPerson(person))
        } else if (term.position !== to) {
          if (now.getTime() - term.startedAt.getTime() < SETTLED_AFTER_MS) {
            await tx.officerTerm.update({
              where: { id: term.id },
              data: { position: to },
            })
          } else {
            await tx.officerTerm.update({
              where: { id: term.id },
              data: {
                endedAt: now,
                endedReason:
                  to === null
                    ? 'Stayed on the board without a seat'
                    : `Moved to ${seatName(to)}`,
              },
            })
            await tx.officerTerm.create({
              data: {
                userId: person.id,
                fullName: person.fullName,
                position: to,
                startedAt: now,
              },
            })
          }
          result.moved.push(asPerson(person))
        }
      }

      // The role follows the seat. Guarded on the role at the write, so `ADMIN` is never
      // touched and a racing write lands once.
      if (after) {
        await tx.user.updateMany({
          where: { id: person.id, role: { in: [UserRole.MEMBER, UserRole.GUEST] } },
          data: {
            role: UserRole.OFFICER,
            // An officer with no `joinedAt` prints a blank year on their public profile.
            ...(person.joinedAt === null ? { joinedAt: now } : {}),
          },
        })
      } else if (person.role === UserRole.OFFICER) {
        await tx.user.updateMany({
          where: { id: person.id, role: UserRole.OFFICER },
          data: { role: fallback.get(person.id) ?? UserRole.GUEST },
        })
      }

      // Somebody given the role in Studio and never seated counts as an officer already.
      const wasOfficer = before || person.role === UserRole.OFFICER

      if (after && !wasOfficer) result.discord.give.push(asPerson(person))
      if (!after && wasOfficer) result.discord.take.push(asPerson(person))
    }
  })

  return result
}

const asPerson = (person: BoardPerson): BoardPerson => ({
  id: person.id,
  fullName: person.fullName,
  discordUsername: person.discordUsername,
})
