import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { prisma } from '../core/db.js'

export const OfficerPosition = {
  PRESIDENT: 'PRESIDENT',
  VICE_PRESIDENT: 'VICE_PRESIDENT',
  TREASURER: 'TREASURER',
  SECRETARY: 'SECRETARY',
  MARKETING: 'MARKETING',
  OUTREACH: 'OUTREACH',
  LAB_MANAGER: 'LAB_MANAGER',
  FACULTY_ADVISOR: 'FACULTY_ADVISOR',
} as const

const CUSTOM_PREFIX = 'custom:'
const noControlCharacters = (value: string) => !/\p{Cc}/u.test(value)
export const seatPosition = z.string().min(1).max(CUSTOM_PREFIX.length + 80)
  .refine(noControlCharacters, "Choose an existing board seat.")
export const seatNameField = z.string().trim().max(80)
  .transform((name) => name.normalize('NFC').replace(/\s+/g, ' '))
  .pipe(z.string().min(1, 'Enter a seat name.').max(80))
  .refine(noControlCharacters, 'Use a seat name without control characters.')

export function seatName(position: string): string {
  if (position.startsWith(CUSTOM_PREFIX)) return position.slice(CUSTOM_PREFIX.length)

  return position
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ')
}

export const customSeat = (name: string) => ({
  position: `${CUSTOM_PREFIX}${name}`,
  nameKey: name.toLowerCase(),
})

export const seatOrder = [{ seat: { displayOrder: 'asc' } }, { position: 'asc' }] as const

export async function readSeats(): Promise<string[]> {
  const seats = await prisma.officerSeat.findMany({
    select: { position: true },
    orderBy: [{ displayOrder: 'asc' }, { position: 'asc' }],
  })

  return seats.map((seat) => seat.position)
}

export async function requireSeats(positions: string[]): Promise<void> {
  const unique = [...new Set(positions)]
  if (unique.length === 0) return

  const count = await prisma.officerSeat.count({ where: { position: { in: unique } } })
  if (count !== unique.length) {
    throw new HTTPException(400, { message: 'Choose an existing board seat.' })
  }
}
