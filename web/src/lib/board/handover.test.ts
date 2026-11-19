import { describe, expect, it } from 'vitest'
import type { ApiOfficerDesk, OfficerPosition } from '../api/api'
import {
  changesOf,
  emptySeat,
  hasChanges,
  holderOfMember,
  place,
  planFrom,
  problemOf,
  rebase,
  requestOf,
} from './handover'

const SEATS: OfficerPosition[] = ['PRESIDENT', 'TREASURER', 'FACULTY_ADVISOR', 'custom:Safety Lead']

const person = (id: string, fullName: string) => ({
  id,
  fullName,
  email: null,
  discordUsername: null,
  role: 'OFFICER' as const,
})

/** A president, a safety lead, an advisor, and a treasurer with no account here. */
const DESK: ApiOfficerDesk = {
  seats: SEATS,
  board: [
    {
      id: 't1',
      position: 'PRESIDENT',
      startedAt: '2035-08-01T00:00:00.000Z',
      fullName: 'Rowan Chen',
      user: person('u1', 'Rowan Chen'),
    },
    {
      id: 't2',
      position: 'custom:Safety Lead',
      startedAt: '2035-08-01T00:00:00.000Z',
      fullName: 'Sam Patel',
      user: person('u2', 'Sam Patel'),
    },
    {
      id: 't3',
      position: 'FACULTY_ADVISOR',
      startedAt: '2030-01-01T00:00:00.000Z',
      fullName: 'Dr Alina Petrov',
      user: { ...person('u3', 'Dr Alina Petrov'), role: 'MEMBER' },
    },
    {
      id: 't4',
      position: 'TREASURER',
      startedAt: '2011-09-01T00:00:00.000Z',
      fullName: 'Marisol Vega',
      user: null,
    },
  ],
}

const jordan = holderOfMember({
  id: 'u9',
  fullName: 'Jordan Ellis',
  email: 'jordan@ucf.edu',
  discordUsername: 'jordan',
})

describe('the handover plan', () => {
  it('starts as today’s board, changing nothing', () => {
    const plan = planFrom(DESK)

    expect(plan.seats.PRESIDENT?.fullName).toBe('Rowan Chen')
    expect(plan.seats.TREASURER?.termId).toBe('t4')
    expect(plan.seats['custom:Safety Lead']?.fullName).toBe('Sam Patel')
    expect(hasChanges(changesOf(DESK, plan))).toBe(false)
  })

  it('reads a new holder as one joining and one leaving', () => {
    const plan = place(planFrom(DESK), jordan, 'PRESIDENT')
    const changes = changesOf(DESK, plan)

    expect(changes.joining).toEqual([{ holder: jordan, to: 'PRESIDENT' }])
    expect(changes.leaving.map((holder) => holder.fullName)).toEqual(['Rowan Chen'])
    expect(changes.moving).toEqual([])
  })

  it('moves somebody picked for a second place rather than seating them twice', () => {
    const start = planFrom(DESK)
    const rowan = start.seats.PRESIDENT!
    const plan = place(start, rowan, 'TREASURER')

    expect(plan.seats.PRESIDENT).toBeNull()
    expect(plan.seats.TREASURER?.key).toBe(rowan.key)
    expect(changesOf(DESK, plan).moving).toEqual([
      { holder: rowan, from: 'PRESIDENT', to: 'TREASURER' },
    ])
    // The treasurer with no account loses the seat and leaves.
    expect(changesOf(DESK, plan).leaving.map((holder) => holder.fullName)).toEqual([
      'Marisol Vega',
    ])
  })

  it('lists a seat somebody holds today and nobody will', () => {
    const start = planFrom(DESK)
    const plan = place(start, start.seats.PRESIDENT!, 'TREASURER')

    expect(changesOf(DESK, plan).emptied).toEqual(['PRESIDENT'])
  })

  it('carries a plan onto a board that changed underneath it', () => {
    // The plan: Jordan for president.
    const plan = place(planFrom(DESK), jordan, 'PRESIDENT')

    // Meanwhile somebody stood Sam down and the treasurer changed hands.
    const today: ApiOfficerDesk = {
      ...DESK,
      board: DESK.board
        .filter((term) => term.id !== 't2' && term.id !== 't4')
        .concat({
          id: 't5',
          position: 'TREASURER',
          startedAt: '2035-09-01T00:00:00.000Z',
          fullName: 'Kai Moreno',
          user: person('u5', 'Kai Moreno'),
        }),
    }

    const carried = rebase(DESK, plan, today)

    expect(carried.seats.PRESIDENT?.key).toBe('u:u9')
    expect(carried.seats.TREASURER?.fullName).toBe('Kai Moreno')
    expect(carried.seats['custom:Safety Lead']).toBeNull()
  })

  it('counts a safety lead given a seat as a move', () => {
    const start = planFrom(DESK)
    const safetyLead = start.seats['custom:Safety Lead']!
    const plan = place(emptySeat(start, 'PRESIDENT'), safetyLead, 'PRESIDENT')

    expect(changesOf(DESK, plan).moving).toEqual([
      { holder: safetyLead, from: 'custom:Safety Lead', to: 'PRESIDENT' },
    ])
  })

  it('refuses a board where nobody would have the officer desks', () => {
    const plan = emptySeat(emptySeat(planFrom(DESK), 'PRESIDENT'), 'custom:Safety Lead')

    // Left: the advisor (no desks) and a treasurer with no account.
    expect(problemOf(plan)).toMatch(/Nobody on the new board/)
    expect(problemOf(planFrom(DESK))).toBeNull()
  })

  it('sends members by id, accountless terms by term, and the board it was planned on', () => {
    const plan = place(planFrom(DESK), jordan, 'PRESIDENT')
    const body = requestOf(DESK, plan)

    expect(body.expected).toEqual([
      { id: 't1', position: 'PRESIDENT' },
      { id: 't2', position: 'custom:Safety Lead' },
      { id: 't3', position: 'FACULTY_ADVISOR' },
      { id: 't4', position: 'TREASURER' },
    ])
    expect(body.board).toEqual(
      expect.arrayContaining([
        { userId: 'u9', position: 'PRESIDENT' },
        { termId: 't4', position: 'TREASURER' },
        { userId: 'u3', position: 'FACULTY_ADVISOR' },
        { userId: 'u2', position: 'custom:Safety Lead' },
      ]),
    )
    expect(body.board).toHaveLength(4)
  })
})
