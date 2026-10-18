import { randomBytes } from 'node:crypto'
import { prisma } from '../core/db.js'
import type { EventWhereInput } from '../generated/prisma/models.js'
import {
  campusDate,
  expandMeetings,
  meetingProjectSelect,
  type MeetingOccurrence,
  type MeetingProject,
} from '../projects/meetings.js'
import { calendarFile, type FeedEntry } from './ics.js'

/**
 * The three calendars somebody can subscribe to, and nothing else.
 *
 *   club       the public calendar: published events and public project meetings
 *   project    one project, as its members see it: every event and every meeting
 *   officers   club-wide events that aren't published yet, the board's working calendar
 *
 * Each follows the read it mirrors (`GET /api/events`, `GET /api/me/events`), so a feed
 * never shows something the site wouldn't show the same person.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * What a feed covers: the last two months and most of a year ahead. The meeting expander
 * refuses anything over `MAX_WINDOW_DAYS` (400), and an app drops whatever leaves the feed,
 * so this is also how long a past event stays in somebody's calendar.
 */
const PAST_DAYS = 60
const AHEAD_DAYS = 330

/** More than a club holds in a year, and a bound on a public endpoint. */
const MAX_EVENTS = 500

const feedWindow = (now: Date) => ({
  from: new Date(now.getTime() - PAST_DAYS * DAY_MS),
  to: new Date(now.getTime() + AHEAD_DAYS * DAY_MS),
})

const feedEventSelect = {
  id: true,
  title: true,
  description: true,
  location: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  registrationUrl: true,
} as const

type FeedEvent = {
  id: string
  title: string
  description: string | null
  location: string | null
  startsAt: Date
  endsAt: Date | null
  allDay: boolean
  registrationUrl: string | null
}

/** The `GET /api/events` window rule: anything that overlaps `[from, to)`. */
async function eventsIn(where: EventWhereInput, from: Date, to: Date) {
  return prisma.event.findMany({
    where: {
      ...where,
      AND: [{ OR: [{ endsAt: { gte: from } }, { endsAt: null, startsAt: { gte: from } }] }],
      startsAt: { lt: to },
    },
    orderBy: { startsAt: 'asc' },
    take: MAX_EVENTS,
    select: feedEventSelect,
  })
}

function eventEntry(event: FeedEvent): FeedEntry {
  const description = [
    event.description?.trim(),
    event.registrationUrl ? `Sign up: ${event.registrationUrl}` : null,
  ]
    .filter(Boolean)
    .join('\n\n')

  return {
    // The same UID the ADD TO CALENDAR download gives a stored event.
    uid: `${event.id}@rccf`,
    title: event.title,
    description: description || null,
    location: event.location,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    allDay: event.allDay,
    url: event.registrationUrl,
    cancelled: false,
  }
}

function meetingEntry(meeting: MeetingOccurrence): FeedEntry {
  const startsAt = new Date(meeting.startsAt)
  const reason = meeting.cancelled?.reason?.trim()

  return {
    // A project meets at most once a campus day, which is also what a cancellation is keyed on.
    uid: `meeting-${meeting.projectId}-${campusDate(startsAt)}@rccf`,
    title: meeting.title,
    description: meeting.cancelled
      ? reason || null
      : meeting.description,
    location: meeting.location,
    startsAt,
    endsAt: new Date(meeting.endsAt),
    allDay: false,
    url: null,
    cancelled: meeting.cancelled !== null,
  }
}

async function meetingEntries(projects: MeetingProject[], from: Date, to: Date) {
  return (await expandMeetings(projects, from, to)).map(meetingEntry)
}

const byStart = (a: FeedEntry, b: FeedEntry) =>
  a.startsAt.getTime() - b.startsAt.getTime()

export async function clubFeed(now: Date = new Date()): Promise<string> {
  const { from, to } = feedWindow(now)

  const [events, projects] = await Promise.all([
    eventsIn({ published: true }, from, to),
    prisma.project.findMany({
      where: { meetingsPublic: true, meetingRepeat: { not: null } },
      select: meetingProjectSelect,
    }),
  ])

  const entries = [
    ...events.map(eventEntry),
    ...(await meetingEntries(projects, from, to)),
  ].sort(byStart)

  return calendarFile(
    {
      name: 'RCCF',
      description: 'Robotics Club of Central Florida events and project meetings.',
    },
    entries,
    now,
  )
}

/**
 * One project as a member sees it on the dashboard: its events published or not, and its
 * meetings whether or not they're on the public calendar. The caller has checked the
 * person may see it.
 */
export async function projectFeed(
  project: MeetingProject,
  now: Date = new Date(),
): Promise<string> {
  const { from, to } = feedWindow(now)

  const events = await eventsIn({ projectId: project.id }, from, to)
  const entries = [
    ...events.map(eventEntry),
    ...(await meetingEntries(
      project.meetingRepeat ? [project] : [],
      from,
      to,
    )),
  ].sort(byStart)

  return calendarFile(
    {
      name: `RCCF · ${project.title}`,
      description: `${project.title} meetings and events.`,
    },
    entries,
    now,
  )
}

/**
 * The board's working calendar: club-wide events nobody has put on the main calendar yet.
 * Ticking "Show on the main calendar" on the events desk moves one from here to the club
 * feed, so somebody subscribed to both never sees it twice.
 */
export async function officersFeed(now: Date = new Date()): Promise<string> {
  const { from, to } = feedWindow(now)
  const events = await eventsIn({ projectId: null, published: false }, from, to)

  return calendarFile(
    {
      name: 'RCCF officers',
      description: 'Club events that are not on the public calendar yet.',
    },
    events.map(eventEntry),
    now,
  )
}

/** The shape every link carries. 32 random bytes, so 43 base64url characters. */
export const FEED_TOKEN = /^[A-Za-z0-9_-]{43}$/

const newToken = () => randomBytes(32).toString('base64url')

/** This person's token, made the first time they ask for a link. */
export async function feedTokenFor(userId: string): Promise<string> {
  const row = await prisma.calendarFeed.upsert({
    where: { userId },
    create: { userId, token: newToken() },
    update: {},
    select: { token: true },
  })
  return row.token
}

/** A new token, which kills every link made with the old one. */
export async function resetFeedToken(userId: string): Promise<string> {
  const token = newToken()
  await prisma.calendarFeed.upsert({
    where: { userId },
    create: { userId, token },
    update: { token, createdAt: new Date() },
  })
  return token
}
