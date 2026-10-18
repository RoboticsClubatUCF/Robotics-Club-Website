import { createHash } from 'node:crypto'
import { prisma } from '../core/db.js'
import { env } from '../core/env.js'
import {
  deleteScheduledEvent,
  discordConfigured,
  type ScheduledEventBody,
  writeScheduledEvent,
} from './discord.js'

/**
 * The public calendar, copied onto the club's Discord as scheduled events.
 *
 * One direction only: the site is the record and Discord follows it. Every published event
 * that hasn't finished gets an EXTERNAL scheduled event, edited when the event changes and
 * deleted when it's unpublished or deleted. Discord starts and ends them itself. Events
 * somebody creates by hand in Discord are never touched, since the sync only acts on the ids
 * in `discord_scheduled_events`. One deleted by hand in Discord comes back on the next pass;
 * unpublishing it on the site is how to take it off.
 *
 * Project meetings stay off. A term of Tuesdays per project would bury the club's events in
 * Discord's list, and its repeat rules can't skip finals week or a cancelled night.
 */

export const eventSyncConfigured = discordConfigured && env.DISCORD_EVENT_SYNC

/**
 * The most site events on Discord at once, nearest first. A guild holds 100 scheduled or
 * active events, and officers make their own too.
 */
export const MAX_SYNCED = 50

/** Discord writes per pass. A first run with a full calendar finishes over a few sweeps. */
export const WRITE_BUDGET = 10

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/** Discord won't schedule something that has already started, so a new copy needs this much lead. */
const LEAD_MS = MINUTE_MS

export interface SyncableEvent {
  id: string
  title: string
  description: string | null
  location: string | null
  startsAt: Date
  endsAt: Date | null
  allDay: boolean
  registrationUrl: string | null
}

const syncableSelect = {
  id: true,
  title: true,
  description: true,
  location: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  registrationUrl: true,
} as const

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

/**
 * Where it ends on Discord, which insists on an end. A timed event with none gets an hour, an
 * all-day one the rest of its day.
 */
function endOf(event: SyncableEvent): Date {
  if (event.endsAt) return event.endsAt
  return new Date(
    event.startsAt.getTime() + (event.allDay ? 24 * HOUR_MS - MINUTE_MS : HOUR_MS),
  )
}

export function scheduledEventFor(event: SyncableEvent): ScheduledEventBody {
  const description = [
    event.description?.trim(),
    event.registrationUrl ? `Sign up: ${event.registrationUrl}` : null,
  ]
    .filter(Boolean)
    .join('\n\n')

  return {
    name: clip(event.title, 100),
    ...(description ? { description: clip(description, 1000) } : {}),
    scheduled_start_time: event.startsAt.toISOString(),
    scheduled_end_time: endOf(event).toISOString(),
    privacy_level: 2,
    entity_type: 3,
    // Required on an EXTERNAL event, 1 to 100 characters.
    entity_metadata: { location: clip(event.location?.trim() || 'TBA', 100) },
  }
}

export const fingerprintOf = (body: ScheduledEventBody) =>
  createHash('sha256').update(JSON.stringify(body)).digest('hex')

export interface EventSyncReport {
  created: number
  updated: number
  deleted: number
  /** Rows let go without a write, because Discord ended the event itself. */
  dropped: number
  /** Why the pass stopped early, or null when it finished. */
  stopped: 'throttled' | 'unavailable' | 'refused' | 'budget' | null
}

/**
 * Creates Discord refused, by event and fingerprint, so a body Discord won't take is
 * logged once per process rather than every ten minutes. A changed event is tried again.
 */
const refusedCreates = new Set<string>()

/** Forget the refusals above. For tests. */
export function forgetRefusedCreates(): void {
  refusedCreates.clear()
}

/**
 * One pass: make Discord match the published calendar.
 *
 * Unconditional, so tests can drive it with Discord mocked. The server goes through
 * `queueDiscordEventSync`, which checks the switch.
 */
export async function syncDiscordEvents(
  now: Date = new Date(),
): Promise<EventSyncReport> {
  const report: EventSyncReport = {
    created: 0,
    updated: 0,
    deleted: 0,
    dropped: 0,
    stopped: null,
  }
  let budget = WRITE_BUDGET

  const [wanted, rows] = await Promise.all([
    prisma.event.findMany({
      where: {
        published: true,
        OR: [
          { endsAt: { gte: now } },
          // Discord gives these an hour, so they're running until then.
          { endsAt: null, startsAt: { gte: new Date(now.getTime() - HOUR_MS) } },
        ],
      },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: MAX_SYNCED,
      select: syncableSelect,
    }),
    prisma.discordScheduledEvent.findMany(),
  ])

  const wantedIds = new Set(wanted.map((event) => event.id))
  const rowsByEvent = new Map(rows.map((row) => [row.eventId, row]))

  /** Stops the pass on anything that won't get better by trying the next event. */
  const halt = (result: { status: string; reason?: string }) => {
    if (result.status === 'throttled') report.stopped = 'throttled'
    else if (result.status === 'refused') report.stopped = 'refused'
    else report.stopped = 'unavailable'
    if (result.reason) console.error(`discord events: ${result.reason}`)
  }

  // Leftovers first, so a full guild has room before anything new is created.
  const leftovers = rows.filter((row) => !wantedIds.has(row.eventId))
  const leftoverEvents = new Map(
    (
      await prisma.event.findMany({
        where: { id: { in: leftovers.map((row) => row.eventId) } },
        select: { ...syncableSelect, published: true },
      })
    ).map((event) => [event.id, event]),
  )

  for (const row of leftovers) {
    const event = leftoverEvents.get(row.eventId)
    const finished = event?.published === true && endOf(event) < now

    if (finished) {
      await prisma.discordScheduledEvent.delete({ where: { eventId: row.eventId } })
      report.dropped += 1
      continue
    }

    // Deleted, unpublished, or pushed past the nearest `MAX_SYNCED`.
    if (budget === 0) {
      report.stopped = 'budget'
      return report
    }
    budget -= 1

    const result = await deleteScheduledEvent(row.discordEventId)
    if (result.status === 'done' || result.status === 'gone') {
      await prisma.discordScheduledEvent.delete({ where: { eventId: row.eventId } })
      report.deleted += 1
    } else if (result.status !== 'unchecked') {
      halt(result)
      return report
    }
  }

  for (const event of wanted) {
    const body = scheduledEventFor(event)
    const fingerprint = fingerprintOf(body)
    const row = rowsByEvent.get(event.id)

    if (row?.fingerprint === fingerprint) continue

    if (row) {
      if (budget === 0) {
        report.stopped = 'budget'
        return report
      }
      budget -= 1

      const result = await writeScheduledEvent(row.discordEventId, body)
      if (result.status === 'done') {
        await prisma.discordScheduledEvent.update({
          where: { eventId: event.id },
          data: { fingerprint },
        })
        report.updated += 1
        continue
      }
      if (result.status === 'refused' && result.code === 400) {
        // Usually moving the start of an event Discord already started. Recorded, so it
        // isn't retried until the event changes again.
        console.warn(`discord events: ${event.id} not updated, ${result.reason}`)
        await prisma.discordScheduledEvent.update({
          where: { eventId: event.id },
          data: { fingerprint },
        })
        continue
      }
      if (result.status !== 'gone') {
        if (result.status !== 'unchecked') halt(result)
        return report
      }
      // Deleted by hand in Discord. Let the row go and make a new one below.
      await prisma.discordScheduledEvent.delete({ where: { eventId: event.id } })
    }

    if (event.startsAt.getTime() <= now.getTime() + LEAD_MS) continue

    const refusalKey = `${event.id}:${fingerprint}`
    if (refusedCreates.has(refusalKey)) continue

    if (budget === 0) {
      report.stopped = 'budget'
      return report
    }
    budget -= 1

    const result = await writeScheduledEvent(null, body)
    if (result.status === 'done') {
      // `skipDuplicates` is the claim: another instance that got here first owns the row,
      // and this copy goes.
      const { count } = await prisma.discordScheduledEvent.createMany({
        data: [{ eventId: event.id, discordEventId: result.id, fingerprint }],
        skipDuplicates: true,
      })
      if (count === 0) {
        await deleteScheduledEvent(result.id)
      } else {
        report.created += 1
      }
      continue
    }
    if (result.status === 'refused' && result.code === 400) {
      console.warn(`discord events: ${event.id} not created, ${result.reason}`)
      refusedCreates.add(refusalKey)
      continue
    }
    if (result.status === 'refused' && result.code === 403) {
      console.error(
        'discord events: refused — the bot needs the Create Events permission in the club server',
      )
    }
    if (result.status !== 'unchecked') halt(result)
    return report
  }

  return report
}

let inFlight: Promise<EventSyncReport> | null = null
let rerun = false

function logReport(report: EventSyncReport) {
  if (report.created + report.updated + report.deleted > 0) {
    console.log(
      `discord events: ${String(report.created)} created, ${String(report.updated)} updated, ${String(report.deleted)} deleted`,
    )
  }
  if (report.stopped === 'budget') {
    console.log('discord events: write budget spent, the rest follows next sweep')
  }
}

/**
 * Run a pass now, or one more straight after the pass already running, so an edit made
 * mid-pass is never left for the sweep. Null when the sync is switched off.
 */
export function queueDiscordEventSync(): Promise<EventSyncReport> | null {
  if (!eventSyncConfigured) return null

  if (inFlight) {
    rerun = true
    return inFlight
  }

  inFlight = syncDiscordEvents()
    .then((report) => {
      logReport(report)
      return report
    })
    .finally(() => {
      inFlight = null
      if (rerun) {
        rerun = false
        void queueDiscordEventSync()?.catch((error: unknown) => {
          console.error('discord event sync failed', error)
        })
      }
    })

  return inFlight
}

/** For the write routes: start a pass and don't wait on it. */
export function nudgeDiscordEvents(): void {
  void queueDiscordEventSync()?.catch((error: unknown) => {
    console.error('discord event sync failed', error)
  })
}
