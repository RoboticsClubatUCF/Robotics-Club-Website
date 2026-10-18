import { describe, expect, it } from 'vitest'
import { calendarFile, type FeedEntry } from './ics.js'

const header = { name: 'RCCF', description: 'Club events.' }
const now = new Date('2026-10-01T12:00:00Z')

const entry = (over: Partial<FeedEntry> = {}): FeedEntry => ({
  uid: 'one@rccf',
  title: 'Build night',
  description: null,
  location: null,
  // 18:00 in Orlando, during daylight saving.
  startsAt: new Date('2026-10-06T22:00:00Z'),
  endsAt: new Date('2026-10-07T02:00:00Z'),
  allDay: false,
  url: null,
  cancelled: false,
  ...over,
})

/** The file with its folds undone, one property per line. */
const unfolded = (file: string) => file.replace(/\r\n /g, '').split('\r\n')

describe('calendarFile', () => {
  it('writes CRLF lines, names the calendar and ends with a line break', () => {
    const file = calendarFile(header, [entry()], now)

    expect(file.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(file.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(file.replace(/\r\n/g, '')).not.toContain('\n')
    expect(unfolded(file)).toContain('X-WR-CALNAME:RCCF')
  })

  it('writes timed entries as UTC instants', () => {
    const lines = unfolded(calendarFile(header, [entry()], now))

    expect(lines).toContain('DTSTART:20261006T220000Z')
    expect(lines).toContain('DTEND:20261007T020000Z')
    expect(lines).toContain('DTSTAMP:20261001T120000Z')
  })

  it('ends an all-day entry the day after its last campus day', () => {
    const lines = unfolded(
      calendarFile(
        header,
        [
          entry({
            allDay: true,
            // Midnight to 23:59 on campus, which is the next UTC day at the far end.
            startsAt: new Date('2026-10-10T04:00:00Z'),
            endsAt: new Date('2026-10-12T03:59:00Z'),
          }),
        ],
        now,
      ),
    )

    expect(lines).toContain('DTSTART;VALUE=DATE:20261010')
    expect(lines).toContain('DTEND;VALUE=DATE:20261012')
  })

  it('gives a one-day all-day entry with no end a whole day', () => {
    const lines = unfolded(
      calendarFile(
        header,
        [entry({ allDay: true, startsAt: new Date('2026-12-31T05:00:00Z'), endsAt: null })],
        now,
      ),
    )

    expect(lines).toContain('DTSTART;VALUE=DATE:20261231')
    expect(lines).toContain('DTEND;VALUE=DATE:20270101')
  })

  it('escapes the characters the format reserves', () => {
    const lines = unfolded(
      calendarFile(
        header,
        [entry({ title: 'Rover, arm; wiring', description: 'Bring a laptop\nand a\\cable' })],
        now,
      ),
    )

    expect(lines).toContain('SUMMARY:Rover\\, arm\\; wiring')
    expect(lines).toContain('DESCRIPTION:Bring a laptop\\nand a\\\\cable')
  })

  it('marks a cancelled meeting in the title and the status', () => {
    const lines = unfolded(calendarFile(header, [entry({ cancelled: true })], now))

    expect(lines).toContain('SUMMARY:Cancelled: Build night')
    expect(lines).toContain('STATUS:CANCELLED')
  })

  it('folds long lines at 75 bytes, counting multi-byte characters', () => {
    const description = `${'Robot — '.repeat(30)}end`
    const file = calendarFile(header, [entry({ description })], now)
    const encoder = new TextEncoder()

    for (const line of file.split('\r\n')) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75)
    }
    expect(unfolded(file)).toContain(`DESCRIPTION:${description}`)
  })
})
