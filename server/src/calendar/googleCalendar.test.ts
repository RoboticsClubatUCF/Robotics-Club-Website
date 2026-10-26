import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../core/db.js'
import {
  calendarIdOf,
  calendarName,
  parseCalendar,
  removeGoogleCalendar,
  syncCalendar,
} from './googleCalendar.js'

/**
 * Everything is dated 2035 and synced at a 2035 `now`, so the window the sync may delete from
 * holds no real rows, and every sync is scoped to a fixture calendar. Fixtures are found by the
 * `test-gcal-` prefix on their UID and their calendar's address.
 */

const PREFIX = 'test-gcal-'
const NOW = new Date('2035-03-01T12:00:00Z')
const WINDOW = {
  from: new Date('2034-12-31T12:00:00Z'),
  to: new Date('2035-08-28T12:00:00Z'),
}

const ZONE = `BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE`

const vevent = (lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\n')

const feed = (events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Google Inc//Google Calendar 70.9054//EN', ZONE, ...events, 'END:VCALENDAR'].join('\n')

const single = (title = 'Kickoff') =>
  vevent([
    `UID:${PREFIX}single`,
    'DTSTART;TZID=America/New_York:20350305T183000',
    'DTEND;TZID=America/New_York:20350305T200000',
    `SUMMARY:${title}`,
    'LOCATION:ENG2 102',
    'DESCRIPTION:Bring a laptop.<br>Pizza after &amp; games.',
  ])

const allDay = vevent([
  `UID:${PREFIX}allday`,
  'DTSTART;VALUE=DATE:20350315',
  'DTEND;VALUE=DATE:20350317',
  'SUMMARY:Competition',
])

const weekly = [
  vevent([
    `UID:${PREFIX}weekly`,
    'DTSTART;TZID=America/New_York:20350301T190000',
    'DTEND;TZID=America/New_York:20350301T200000',
    'RRULE:FREQ=WEEKLY;COUNT=4',
    'EXDATE;TZID=America/New_York:20350308T190000',
    'SUMMARY:Build night',
  ]),
  // Moved a day later.
  vevent([
    `UID:${PREFIX}weekly`,
    'RECURRENCE-ID;TZID=America/New_York:20350315T190000',
    'DTSTART;TZID=America/New_York:20350316T190000',
    'DTEND;TZID=America/New_York:20350316T200000',
    'SUMMARY:Build night (moved)',
  ]),
  vevent([
    `UID:${PREFIX}weekly`,
    'RECURRENCE-ID;TZID=America/New_York:20350322T190000',
    'DTSTART;TZID=America/New_York:20350322T190000',
    'STATUS:CANCELLED',
    'SUMMARY:Build night',
  ]),
]

const hiddenOnes = [
  vevent([
    `UID:${PREFIX}private`,
    'DTSTART;TZID=America/New_York:20350306T120000',
    'CLASS:PRIVATE',
    'SUMMARY:Officer dentist',
  ]),
  vevent([
    `UID:${PREFIX}later`,
    'DTSTART;TZID=America/New_York:20360601T120000',
    'SUMMARY:Next year',
  ]),
]

const everything = feed([single(), allDay, ...weekly, ...hiddenOnes])

describe('calendarIdOf', () => {
  it('reads the calendar out of a secret or public address', () => {
    expect(
      calendarIdOf(
        'https://calendar.google.com/calendar/ical/club%40group.calendar.google.com/private-0123abcd/basic.ics',
      ),
    ).toBe('club@group.calendar.google.com')
    expect(
      calendarIdOf('https://calendar.google.com/calendar/ical/club%40gmail.com/public/basic.ics'),
    ).toBe('club@gmail.com')
  })

  it.each([
    'http://calendar.google.com/calendar/ical/a/private-b/basic.ics',
    'https://calendar.google.com.evil.test/calendar/ical/a/private-b/basic.ics',
    'https://localhost:5433/calendar/ical/a/private-b/basic.ics',
    'https://calendar.google.com/calendar/embed?src=a',
    'not a url',
  ])('refuses %s', (url) => {
    expect(calendarIdOf(url)).toBeNull()
  })
})

describe('parseCalendar', () => {
  const items = parseCalendar(everything, WINDOW)
  const byId = new Map(items.map((item) => [item.googleId, item]))

  it('reads a timed event in its zone, with plain-text detail', () => {
    expect(byId.get(`${PREFIX}single`)).toEqual({
      googleId: `${PREFIX}single`,
      title: 'Kickoff',
      description: 'Bring a laptop.\nPizza after & games.',
      location: 'ENG2 102',
      // EST until the 11th.
      startsAt: new Date('2035-03-05T23:30:00Z'),
      endsAt: new Date('2035-03-06T01:00:00Z'),
      allDay: false,
    })
  })

  it('ends an all-day event at 23:59 on its last day, campus time', () => {
    expect(byId.get(`${PREFIX}allday`)).toMatchObject({
      allDay: true,
      startsAt: new Date('2035-03-15T04:00:00Z'),
      endsAt: new Date('2035-03-17T03:59:00Z'),
    })
  })

  it('expands a repeating event, skipping excluded and cancelled dates', () => {
    const weeklyItems = items.filter((item) => item.googleId.startsWith(`${PREFIX}weekly#`))
    expect(weeklyItems.map((item) => [item.title, item.startsAt.toISOString()])).toEqual([
      ['Build night', '2035-03-02T00:00:00.000Z'],
      ['Build night (moved)', '2035-03-16T23:00:00.000Z'],
    ])
  })

  it('leaves out private events and anything outside the window', () => {
    expect(byId.has(`${PREFIX}private`)).toBe(false)
    expect(byId.has(`${PREFIX}later`)).toBe(false)
    expect(items).toHaveLength(4)
  })
})

describe('calendarName', () => {
  it("reads Google's name for the calendar", () => {
    expect(calendarName('BEGIN:VCALENDAR\nX-WR-CALNAME:RCCF\\, general\nEND:VCALENDAR')).toBe(
      'RCCF, general',
    )
    expect(calendarName('BEGIN:VCALENDAR\nEND:VCALENDAR')).toBeNull()
  })
})

describe('syncing a calendar', () => {
  /** A fixture calendar. Its address is never fetched: every sync here passes the feed. */
  const calendarRow = (name: string) =>
    prisma.googleCalendar.create({
      data: {
        icsUrl: `https://calendar.google.com/calendar/ical/${PREFIX}${name}/public/basic.ics`,
      },
    })

  const clear = async () => {
    await prisma.event.deleteMany({ where: { googleId: { startsWith: PREFIX } } })
    await prisma.event.deleteMany({ where: { slug: { startsWith: PREFIX } } })
    await prisma.googleCalendar.deleteMany({ where: { icsUrl: { contains: `/${PREFIX}` } } })
  }

  beforeEach(clear)
  afterAll(async () => {
    await clear()
    await prisma.$disconnect()
  })

  const find = (googleCalendarId: string, googleId: string) =>
    prisma.event.findUniqueOrThrow({
      where: { googleCalendarId_googleId: { googleCalendarId, googleId } },
    })

  it('creates public rows, updates what changed, and removes what Google dropped', async () => {
    const calendar = await calendarRow('main')

    expect(await syncCalendar(calendar, { now: NOW, ics: everything })).toEqual({
      created: 4,
      updated: 0,
      removed: 0,
    })
    const created = await find(calendar.id, `${PREFIX}single`)
    expect(created).toMatchObject({ published: true, type: 'MEETING', projectId: null })
    expect(await prisma.googleCalendar.findUniqueOrThrow({ where: { id: calendar.id } })).toMatchObject(
      { syncError: null, syncedAt: expect.any(Date) as Date },
    )

    // Officers' choices survive a sync.
    await prisma.event.update({
      where: { id: created.id },
      data: { type: 'SOCIAL', published: false },
    })

    expect(
      await syncCalendar(calendar, {
        now: NOW,
        ics: feed([single('Kickoff night'), allDay, ...weekly]),
      }),
    ).toEqual({ created: 0, updated: 1, removed: 0 })
    expect(await prisma.event.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
      title: 'Kickoff night',
      type: 'SOCIAL',
      published: false,
    })

    expect(await syncCalendar(calendar, { now: NOW, ics: feed([allDay, ...weekly]) })).toEqual({
      created: 0,
      updated: 0,
      removed: 1,
    })
  })

  it("keeps each calendar's events to itself", async () => {
    const first = await calendarRow('first')
    const second = await calendarRow('second')

    // The same event in both, as happens when one is shared into the other.
    await syncCalendar(first, { now: NOW, ics: feed([single()]) })
    await syncCalendar(second, { now: NOW, ics: feed([single(), allDay]) })

    // Emptying the second removes only its own rows.
    expect(await syncCalendar(second, { now: NOW, ics: feed([]) })).toMatchObject({ removed: 2 })
    expect(await find(first.id, `${PREFIX}single`)).toMatchObject({ title: 'Kickoff' })
  })

  it('keeps imports older than the window', async () => {
    const calendar = await calendarRow('old')
    await prisma.event.create({
      data: {
        slug: `${PREFIX}old`,
        googleCalendarId: calendar.id,
        googleId: `${PREFIX}old`,
        title: 'Last year',
        startsAt: new Date('2034-06-01T12:00:00Z'),
      },
    })

    await syncCalendar(calendar, { now: NOW, ics: feed([]) })

    expect(await find(calendar.id, `${PREFIX}old`)).toMatchObject({ title: 'Last year' })
  })

  it('turns imports into ordinary events when their calendar is removed', async () => {
    const calendar = await calendarRow('gone')
    await syncCalendar(calendar, { now: NOW, ics: feed([single()]) })
    const row = await find(calendar.id, `${PREFIX}single`)

    expect(await removeGoogleCalendar(calendar.id)).toBe(1)

    expect(await prisma.event.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      googleCalendarId: null,
      googleId: null,
      title: 'Kickoff',
    })
    expect(await prisma.googleCalendar.findUnique({ where: { id: calendar.id } })).toBeNull()
    // Released rows have no prefixed UID left to find them by.
    await prisma.event.delete({ where: { id: row.id } })
  })
})
