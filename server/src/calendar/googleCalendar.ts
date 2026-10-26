import ICAL from 'ical.js'
import { prisma } from '../core/db.js'
import { CAMPUS_ZONE } from '../lab/labStatus.js'
import { eventSlug } from './eventSlug.js'

type Component = InstanceType<typeof ICAL.Component>
type Time = InstanceType<typeof ICAL.Time>

/**
 * One-way import from Google Calendars into `events`. Officers add the club's on the events desk
 * (`routes/officer/googleCalendar.ts`) and project leads add their project's on its manage page
 * (`routes/projects/projectCalendars.ts`). Every imported row carries its calendar, so one
 * calendar's sync never touches another's events.
 *
 * Google owns title, description, location and times on the rows it creates; the site owns
 * type, sign-up link and `published`. A club calendar's imports go public straight away; a
 * project calendar's belong to the project and go public only if its lead said so.
 * `routes/projects/eventManage.ts` refuses edits to the Google half.
 *
 * Repeating events are expanded into one row per occurrence, because every calendar on the site
 * reads rows. Only a window around today is expanded, and only rows in that window are ever
 * removed, so older imports stay as history.
 */

const PAST_DAYS = 60
const FUTURE_DAYS = 180
/** A daily event started years ago still finishes; a broken rule can't spin forever. */
const MAX_STEPS_PER_SERIES = 5_000
const DAY_MS = 24 * 60 * 60 * 1000

export type ImportedOccurrence = {
  googleId: string
  title: string
  description: string | null
  location: string | null
  startsAt: Date
  endsAt: Date | null
  allDay: boolean
}

/** Offset of campus time from UTC at an instant, in ms. */
function campusOffset(at: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CAMPUS_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(at))
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return (
    Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
      part('second'),
    ) - at
  )
}

/** A wall-clock time on campus as an instant. */
function campusInstant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  // Twice, so a guess on the wrong side of a DST change settles.
  let at = wall - campusOffset(wall)
  at = wall - campusOffset(at)
  return new Date(at)
}

/** Floating times and dates carry no zone, so they're read as campus time. */
function toInstant(time: Time): Date {
  if (time.isDate || time.zone === ICAL.Timezone.localTimezone) {
    return campusInstant(time.year, time.month, time.day, time.hour, time.minute)
  }
  return time.toJSDate()
}

/** Google puts HTML in descriptions it edited; the site prints plain text. */
function plainText(value: string | null | undefined, max: number): string | null {
  if (!value) return null
  const text = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text ? text.slice(0, max) : null
}

const hidden = (component: Component) => {
  const status = String(component.getFirstPropertyValue('status') ?? '').toUpperCase()
  const access = String(component.getFirstPropertyValue('class') ?? '').toUpperCase()
  // The secret address includes private events in full; those never reach the site.
  return status === 'CANCELLED' || access === 'PRIVATE' || access === 'CONFIDENTIAL'
}

function occurrence(
  googleId: string,
  item: InstanceType<typeof ICAL.Event>,
  start: Time,
  end: Time | null,
): ImportedOccurrence {
  const startsAt = toInstant(start)
  let endsAt: Date | null = null
  if (start.isDate) {
    // DTEND on an all-day event is the day after; the site ends one at 23:59 on its last day,
    // the same as the events desk.
    const last = end ? end.clone() : start.clone()
    if (end) last.adjust(-1, 0, 0, 0)
    const lastDay = last.compare(start) < 0 ? start : last
    endsAt = campusInstant(lastDay.year, lastDay.month, lastDay.day, 23, 59)
  } else if (end) {
    const at = toInstant(end)
    endsAt = at > startsAt ? at : null
  }

  return {
    googleId,
    title: (item.summary || 'Untitled event').trim().slice(0, 160),
    description: plainText(item.description, 5_000),
    location: plainText(item.location, 160),
    startsAt,
    endsAt,
    allDay: start.isDate,
  }
}

/** Every visible occurrence in the feed that overlaps `[from, to)`. */
export function parseCalendar(
  ics: string,
  window: { from: Date; to: Date },
): ImportedOccurrence[] {
  const calendar = new ICAL.Component(ICAL.parse(ics))

  for (const zone of calendar.getAllSubcomponents('vtimezone')) {
    ICAL.TimezoneService.register(zone)
  }

  // A moved or cancelled instance of a repeating event is its own VEVENT with the same UID.
  const masters = new Map<string, Component>()
  const exceptions = new Map<string, Component[]>()
  for (const component of calendar.getAllSubcomponents('vevent')) {
    const uid = String(component.getFirstPropertyValue('uid') ?? '')
    if (!uid) continue
    if (component.hasProperty('recurrence-id')) {
      exceptions.set(uid, [...(exceptions.get(uid) ?? []), component])
    } else {
      masters.set(uid, component)
    }
  }

  const overlaps = (item: ImportedOccurrence) =>
    item.startsAt < window.to && (item.endsAt ?? item.startsAt) >= window.from

  const found: ImportedOccurrence[] = []

  for (const [uid, component] of masters) {
    if (hidden(component)) continue
    // Passed explicitly: left to itself, ical.js relates every instance in the file to this
    // event, whatever its UID.
    const event = new ICAL.Event(component, {
      strictExceptions: true,
      exceptions: exceptions.get(uid) ?? [],
    })
    exceptions.delete(uid)

    if (!event.isRecurring()) {
      const item = occurrence(uid, event, event.startDate, event.endDate ?? null)
      if (overlaps(item)) found.push(item)
      continue
    }

    const steps = event.iterator()
    for (let i = 0; i < MAX_STEPS_PER_SERIES; i += 1) {
      const next = steps.next()
      if (!next) break
      if (toInstant(next) >= window.to) break

      const details = event.getOccurrenceDetails(next)
      if (hidden(details.item.component)) continue
      const item = occurrence(
        `${uid}#${details.recurrenceId.toICALString()}`,
        details.item,
        details.startDate,
        details.endDate,
      )
      if (overlaps(item)) found.push(item)
    }
  }

  // Instances whose series isn't in the feed, which Google does when you're invited to one.
  for (const [uid, list] of exceptions) {
    for (const component of list) {
      if (hidden(component)) continue
      const event = new ICAL.Event(component)
      const item = occurrence(
        `${uid}#${event.recurrenceId.toICALString()}`,
        event,
        event.startDate,
        event.endDate ?? null,
      )
      if (overlaps(item)) found.push(item)
    }
  }

  return found
}

export type GoogleCalendarReport = {
  created: number
  updated: number
  removed: number
}

/** Each calendar is a fetch on every tick, so each list (the club's, or one project's) stays short. */
export const MAX_CALENDARS = 10

/** A refusal the routes pass on with its status. */
export class GoogleCalendarError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message)
  }
}

/**
 * Whose calendars a call is about: the club's (`null`, managed by officers on the events desk) or
 * one project's (managed by its lead). Every write checks the calendar is in the caller's scope, so
 * a lead can never reach the club's calendars or another project's.
 */
export type CalendarScope = { projectId: string | null }

type SyncedCalendar = { id: string; icsUrl: string; projectId: string | null; published: boolean }

/**
 * The calendar an address reads, for people to recognise it by, or null when the address isn't
 * a Google Calendar iCal feed. Only Google is accepted because the server fetches whatever is
 * saved, and an arbitrary URL would let a desk probe the box's own network.
 */
export function calendarIdOf(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const match = /^\/calendar\/ical\/([^/]+)\/(?:private-[^/]+|public)\/basic\.ics$/.exec(
    parsed.pathname,
  )
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'calendar.google.com' || !match) {
    return null
  }
  try {
    return decodeURIComponent(match[1] ?? '')
  } catch {
    return null
  }
}

/** The calendar's own name, which Google puts in `X-WR-CALNAME`. */
export function calendarName(ics: string): string | null {
  const raw = /^X-WR-CALNAME:(.*)$/m.exec(ics)?.[1]
  const name = raw?.replace(/\\([,;\\])/g, '$1').trim()
  return name ? name.slice(0, 120) : null
}

export async function fetchFeed(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) {
    throw new Error(`Google Calendar answered ${String(response.status)}.`)
  }
  const text = await response.text()
  // Anything else is an error page, and reading it as an empty calendar would delete every import.
  if (!text.includes('BEGIN:VCALENDAR')) {
    throw new Error('That address did not return a calendar.')
  }
  return text
}

const same = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null)

const failure = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Bring one calendar's events in line with its feed and note how it went on its row. `ics` skips
 * the download, for tests and for a feed already fetched to check a new address.
 */
export async function syncCalendar(
  calendar: SyncedCalendar,
  { now = new Date(), ics }: { now?: Date; ics?: string } = {},
): Promise<GoogleCalendarReport> {
  // Conditional on the address, so a run that started before somebody changed it can't stamp
  // the new one.
  const record = (data: { name?: string | null; syncedAt?: Date; syncError: string | null }) =>
    prisma.googleCalendar.updateMany({ where: { id: calendar.id, icsUrl: calendar.icsUrl }, data })

  try {
    const feed = ics ?? (await fetchFeed(calendar.icsUrl))
    const report = await applyFeed(calendar, feed, now)
    await record({ name: calendarName(feed), syncedAt: new Date(), syncError: null })
    return report
  } catch (error) {
    await record({ syncError: failure(error) })
    throw error
  }
}

export type GoogleCalendarsReport = GoogleCalendarReport & { failed: number }

async function syncEach(calendars: SyncedCalendar[]): Promise<GoogleCalendarsReport> {
  const total = { created: 0, updated: 0, removed: 0, failed: 0 }
  for (const calendar of calendars) {
    try {
      const report = await syncCalendar(calendar)
      total.created += report.created
      total.updated += report.updated
      total.removed += report.removed
    } catch (error) {
      total.failed += 1
      console.error(`google calendar ${calendar.id}: ${failure(error)}`)
    }
  }
  return total
}

let running: Promise<GoogleCalendarsReport> | null = null

/**
 * Sync every calendar, club and project, one after another. A failing calendar is noted on its row
 * and the rest carry on. Overlapping calls share one run.
 */
export function syncGoogleCalendars(): Promise<GoogleCalendarsReport> {
  running ??= prisma.googleCalendar
    .findMany({ orderBy: { createdAt: 'asc' } })
    .then(syncEach)
    .finally(() => {
      running = null
    })
  return running
}

/** Wait out a full sync in progress before changing what it reads. */
const settle = () => running?.catch(() => undefined)

/** Sync one scope's calendars now, for IMPORT NOW. */
export async function syncScope(scope: CalendarScope): Promise<GoogleCalendarsReport> {
  await settle()
  return syncEach(
    await prisma.googleCalendar.findMany({
      where: { projectId: scope.projectId },
      orderBy: { createdAt: 'asc' },
    }),
  )
}

async function checkedFeed(url: string): Promise<string> {
  if (!calendarIdOf(url)) {
    throw new GoogleCalendarError(
      400,
      `Paste the calendar's "Secret address in iCal format" from its Google Calendar settings.`,
    )
  }
  try {
    return await fetchFeed(url)
  } catch (error) {
    throw new GoogleCalendarError(400, `Couldn't read that calendar. ${failure(error)}`)
  }
}

async function inScope(id: string, scope: CalendarScope) {
  const calendar = await prisma.googleCalendar.findFirst({
    where: { id, projectId: scope.projectId },
  })
  if (!calendar) throw new GoogleCalendarError(404, 'No such calendar.')
  return calendar
}

/**
 * Add a calendar and import from it. Nothing is saved when the address doesn't load. A club
 * calendar is always public; a project's says so with `published`.
 */
export async function addGoogleCalendar(
  url: string,
  scope: CalendarScope,
  published = true,
): Promise<GoogleCalendarReport> {
  const count = await prisma.googleCalendar.count({ where: { projectId: scope.projectId } })
  if (count >= MAX_CALENDARS) {
    throw new GoogleCalendarError(
      409,
      `${scope.projectId ? 'A project' : 'The club'} can connect ${String(MAX_CALENDARS)} calendars at most.`,
    )
  }
  // Unique across the site, so one calendar can't feed the same events in twice.
  if (await prisma.googleCalendar.findUnique({ where: { icsUrl: url } })) {
    throw new GoogleCalendarError(409, 'That calendar is already connected.')
  }
  const feed = await checkedFeed(url)
  await settle()
  const calendar = await prisma.googleCalendar.create({
    data: {
      icsUrl: url,
      name: calendarName(feed),
      projectId: scope.projectId,
      published: scope.projectId ? published : true,
    },
  })
  return syncCalendar(calendar, { ics: feed })
}

/** Replace a calendar's address, after Google resets its secret. Its imports stay linked. */
export async function changeGoogleCalendar(
  id: string,
  url: string,
  scope: CalendarScope,
): Promise<GoogleCalendarReport> {
  await inScope(id, scope)
  const taken = await prisma.googleCalendar.findUnique({ where: { icsUrl: url } })
  if (taken && taken.id !== id) {
    throw new GoogleCalendarError(409, 'That calendar is already connected.')
  }
  const feed = await checkedFeed(url)
  await settle()
  const updated = await prisma.googleCalendar.update({
    where: { id },
    data: { icsUrl: url, syncError: null },
  })
  return syncCalendar(updated, { ics: feed })
}

/**
 * Put a project calendar's events on the public calendar or take them off it, the ones already
 * imported included. Club calendars are always public.
 */
export async function setGoogleCalendarPublished(
  id: string,
  scope: CalendarScope,
  published: boolean,
): Promise<void> {
  if (!scope.projectId) {
    throw new GoogleCalendarError(400, 'Club calendars are always public.')
  }
  await inScope(id, scope)
  await prisma.$transaction([
    prisma.googleCalendar.update({ where: { id }, data: { published } }),
    prisma.event.updateMany({ where: { googleCalendarId: id }, data: { published } }),
  ])
}

/**
 * Stop importing from one calendar. Its rows stay on the site as ordinary events, which can then
 * be edited and deleted like any other. Returns how many were let go.
 */
export async function removeGoogleCalendar(id: string, scope: CalendarScope): Promise<number> {
  await inScope(id, scope)
  await settle()
  const [released] = await prisma.$transaction([
    prisma.event.updateMany({
      where: { googleCalendarId: id },
      data: { googleCalendarId: null, googleId: null },
    }),
    prisma.googleCalendar.deleteMany({ where: { id } }),
  ])
  return released.count
}

/** What a desk shows. Never the address itself. */
export async function listGoogleCalendars(scope: CalendarScope) {
  const calendars = await prisma.googleCalendar.findMany({
    where: { projectId: scope.projectId },
    orderBy: { createdAt: 'asc' },
  })
  return calendars.map((calendar) => ({
    id: calendar.id,
    name: calendar.name,
    calendar: calendarIdOf(calendar.icsUrl),
    published: calendar.published,
    syncedAt: calendar.syncedAt,
    syncError: calendar.syncError,
  }))
}

async function applyFeed(
  calendar: SyncedCalendar,
  feed: string,
  now: Date,
): Promise<GoogleCalendarReport> {
  const googleCalendarId = calendar.id
  const report = { created: 0, updated: 0, removed: 0 }
  const window = {
    from: new Date(now.getTime() - PAST_DAYS * DAY_MS),
    to: new Date(now.getTime() + FUTURE_DAYS * DAY_MS),
  }
  const items = parseCalendar(feed, window)

  const existing = await prisma.event.findMany({
    where: { googleCalendarId, googleId: { in: items.map((item) => item.googleId) } },
    select: {
      id: true,
      googleId: true,
      title: true,
      description: true,
      location: true,
      startsAt: true,
      endsAt: true,
      allDay: true,
    },
  })
  const byGoogleId = new Map(existing.map((row) => [row.googleId, row]))

  for (const item of items) {
    const row = byGoogleId.get(item.googleId)
    const { googleId, ...fields } = item

    if (!row) {
      try {
        await prisma.event.create({
          data: {
            ...fields,
            googleCalendarId,
            googleId,
            // A project calendar's events are the project's: its members see them on the
            // dashboard, and `published` adds them to the public calendar.
            projectId: calendar.projectId,
            slug: eventSlug(fields.title),
            published: calendar.published,
          },
        })
        report.created += 1
      } catch (error) {
        // Another instance created it a moment ago.
        if ((error as { code?: string }).code !== 'P2002') throw error
      }
      continue
    }

    const changed =
      row.title !== fields.title ||
      row.description !== fields.description ||
      row.location !== fields.location ||
      row.allDay !== fields.allDay ||
      !same(row.startsAt, fields.startsAt) ||
      !same(row.endsAt, fields.endsAt)
    if (changed) {
      await prisma.event.update({ where: { id: row.id }, data: fields })
      report.updated += 1
    }
  }

  const { count } = await prisma.event.deleteMany({
    where: {
      googleCalendarId,
      googleId: { notIn: items.map((item) => item.googleId) },
      startsAt: { gte: window.from, lt: window.to },
    },
  })
  report.removed = count

  return report
}
