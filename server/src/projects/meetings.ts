import { CAMPUS_ZONE } from '../lab/labStatus.js'
import type { Season } from '../generated/prisma/enums.js'
import { getTerm, type Term } from '../membership/semester.js'

/**
 * When a project meets, turned into occurrences on a calendar.
 *
 * The club's one recurring thing. A project stores what a lead would say out
 * loud — "Tuesdays and Thursdays, six till ten, in the lab" — as three columns
 * rather than as generated `Event` rows, and this is the module that expands
 * them. See `Project.meetingWeekdays` in `schema.prisma` for why the columns
 * are shaped that way; this file is the other half of that decision.
 *
 * **It lives on the server, and that is the change.** The expansion used to be
 * `meetingsIn` in `DashboardCalendar.tsx`, in the browser, for the dashboard
 * only. Three things forced it here:
 *
 *   - The landing page is anonymous. It has no `/me/projects` to read a
 *     schedule out of, and shipping every project's schedule to every visitor
 *     so the browser could do the arithmetic is a worse version of this.
 *   - The bounds are async. A term's dates come from UCF's calendar through a
 *     cached network read, and so does finals week; neither is something a
 *     browser should be asking about.
 *   - Two implementations of "when does this project meet" is the bug class
 *     this codebase keeps warning about. There is one now, and both calendars
 *     read it.
 *
 * Two rules make an occurrence, and both are subtractive:
 *
 *   - **It stops at the end of the project's own term.** A project is stamped
 *     `(termYear, termSeason)` and that term has an end; meetings do not run
 *     past it. The old client-side version painted Tuesdays into the next
 *     decade, which is how a graduated lead's project still claimed to meet.
 *   - **Finals week is skipped.** The club puts every project on halt for it.
 *     When nobody has said when finals is, nothing is skipped — see
 *     `Term.finalsStartAt` for why that is null rather than a guess.
 */

/** What the expander needs off a project row, and nothing else. */
export const meetingProjectSelect = {
  id: true,
  slug: true,
  title: true,
  termYear: true,
  termSeason: true,
  meetingWeekdays: true,
  meetingStartTime: true,
  meetingEndTime: true,
  meetingLocation: true,
  meetingDescription: true,
} as const

export interface MeetingProject {
  id: string
  slug: string
  title: string
  termYear: number
  termSeason: Season
  meetingWeekdays: number[]
  meetingStartTime: string | null
  meetingEndTime: string | null
  meetingLocation: string | null
  meetingDescription: string | null
}

/**
 * The whole series in one object, carried on every occurrence.
 *
 * This is what lets a member press one button and have the entire term in their
 * phone, rather than adding next Tuesday and then the Tuesday after. A calendar
 * app wants a rule plus its exceptions, not a list of instances, so the client
 * needs the days, the hours, the last date and the gap — and rebuilding those
 * in the browser from a list of occurrences would be guessing at what this
 * module already knows.
 *
 * Repeated on each occurrence rather than sent alongside: the two calendars
 * both hand a flat array to the same widget, and a parallel structure keyed by
 * project would have to survive every filter and sort that widget does.
 */
export interface MeetingSeries {
  projectSlug: string
  projectTitle: string
  /** 0-6, Sunday first, sorted. */
  weekdays: number[]
  /** Campus wall-clock, "18:00". */
  startTime: string
  endTime: string
  location: string | null
  /** The last day the series runs: the end of the project's term, as ISO. */
  untilDate: string
  /** Finals week, which the series skips, or null when nobody has set one. */
  skip: { from: string; to: string } | null
  /**
   * The exact occurrences finals week eats, as ISO instants.
   *
   * Worked out here rather than left to the client, and that is the same
   * decision this whole module is: a calendar app needs `EXDATE` lines and each
   * one has to name a real instant of the series to the second, so somebody has
   * to walk the finals window against the meeting days. Doing it in the browser
   * would be a second implementation of the halt — the exact thing moving the
   * expansion to the server was meant to end — and it would have to re-derive
   * campus wall-clock times to do it.
   *
   * Empty when no finals week is set, which is also when `skip` is null.
   */
  skipDates: string[]
}

/** One meeting, shaped like the events it sits beside on a calendar. */
export interface MeetingOccurrence {
  id: string
  slug: string
  title: string
  description: string | null
  type: 'MEETING'
  location: string | null
  startsAt: string
  endsAt: string
  allDay: false
  registrationUrl: null
  meeting: MeetingSeries
  /** For the member view, which says which project a row came from. */
  projectId: string
  project: { slug: string; title: string }
}

/**
 * The longest window anybody may expand at once.
 *
 * A year and a bit, which covers the widest thing the site asks for — a
 * calendar paging through an academic year — and refuses the request that would
 * hurt: `?from=2020&to=2100` is four hundred occurrences a project per decade,
 * built one `Intl` call at a time, on a cached public endpoint. The term bound
 * already caps it in practice; this caps it in principle, before the work
 * starts rather than after.
 */
export const MAX_WINDOW_DAYS = 400

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The campus clock, read the way `labStatus.ts` reads it and for the same
 * reason: Florida moves by an hour twice a year, so an offset held as a number
 * is right for eight months of it.
 */
const campusParts = new Intl.DateTimeFormat('en-US', {
  timeZone: CAMPUS_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  // The trap `labStatus.ts` documents: with `hour12: false` some ICU builds
  // render midnight as 24 and the arithmetic below lands a day out.
  hourCycle: 'h23',
})

interface CivilDate {
  year: number
  month: number
  day: number
}

function readCampus(at: Date): CivilDate & { hour: number; minute: number; second: number } {
  const parts = campusParts.formatToParts(at)
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0')

  return {
    year: field('year'),
    month: field('month'),
    day: field('day'),
    hour: field('hour'),
    minute: field('minute'),
    second: field('second'),
  }
}

/** How far the campus clock is from UTC at a given instant, in milliseconds. */
function campusOffsetMs(at: Date): number {
  const { year, month, day, hour, minute, second } = readCampus(at)
  return Date.UTC(year, month - 1, day, hour, minute, second) - at.getTime()
}

/**
 * The instant at which it is `hour:minute` on campus on a given civil date.
 *
 * The inverse of what `Intl` offers, and it has to be done by correction
 * because there is no "parse in this zone" primitive: treat the wall clock as
 * if it were UTC, ask what the offset is near that guess, and subtract it.
 *
 * Corrected twice, and the second pass is not superstition. The first guess can
 * land on the wrong side of a DST transition — 6pm on the first Sunday in
 * November is read against a guess that is still in EDT — and one more pass
 * settles it. A third would never differ; the offsets involved are an hour and
 * the transitions are hours apart.
 */
function campusInstant(
  { year, month, day }: CivilDate,
  hour: number,
  minute: number,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute)
  const first = new Date(wall - campusOffsetMs(new Date(wall)))
  return new Date(wall - campusOffsetMs(first))
}

/** "18:30" -> [18, 30], or null for anything that is not a wall-clock time. */
function readClock(time: string): [number, number] | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  if (!match) return null
  return [Number(match[1]), Number(match[2])]
}

/** The civil date `days` after this one, without touching a timezone. */
function addDays(date: CivilDate, days: number): CivilDate {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return {
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
  }
}

/**
 * Which weekday a civil date is, 0-6 with Sunday first.
 *
 * `Date.UTC` on a bare civil date is exact — no zone is involved, so this is
 * calendar arithmetic rather than a conversion, and it matches what
 * `Date.getDay()` gives the browser for the same wall date.
 */
const weekdayOf = (date: CivilDate): number =>
  new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()

const beforeOrEqual = (a: CivilDate, b: CivilDate) =>
  Date.UTC(a.year, a.month - 1, a.day) <= Date.UTC(b.year, b.month - 1, b.day)

/**
 * Every occurrence of every project's meeting inside `[from, to)`.
 *
 * Terms are read once per distinct `(year, season)` rather than once per
 * project. `getTerm` caches for a day so the repeat would usually be free, but
 * "usually free" is a property of the cache and this is a loop over every
 * project on the site — the first call after a deploy would otherwise be one
 * network read per project.
 *
 * Half-open at the top, matching the window semantics both calendar routes
 * already use, so a meeting at midnight on the 1st belongs to the month that is
 * starting rather than to both.
 */
export async function expandMeetings(
  projects: MeetingProject[],
  from: Date,
  to: Date,
): Promise<MeetingOccurrence[]> {
  if (to <= from) return []
  if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * DAY_MS) {
    throw new RangeError(
      `A calendar window may cover at most ${String(MAX_WINDOW_DAYS)} days.`,
    )
  }

  const scheduled = projects.filter(
    (project) =>
      project.meetingWeekdays.length > 0 &&
      project.meetingStartTime !== null &&
      project.meetingEndTime !== null,
  )
  if (scheduled.length === 0) return []

  const terms = new Map<string, Term>()
  await Promise.all(
    [
      ...new Set(
        scheduled.map(
          (project) => `${String(project.termYear)}-${project.termSeason}`,
        ),
      ),
    ].map(async (key) => {
      const [year, season] = key.split('-') as [string, Season]
      terms.set(key, await getTerm(Number(year), season))
    }),
  )

  const occurrences: MeetingOccurrence[] = []

  for (const project of scheduled) {
    const term = terms.get(
      `${String(project.termYear)}-${project.termSeason}`,
    )
    if (!term) continue

    const start = readClock(project.meetingStartTime ?? '')
    const end = readClock(project.meetingEndTime ?? '')
    // A row whose times predate the column's validation, or were written
    // straight into Postgres. Skipped rather than guessed at: a meeting drawn
    // at midnight because "6pm-ish" would not parse is worse than no chip.
    if (!start || !end) continue

    const weekdays = [...new Set(project.meetingWeekdays)].sort((a, b) => a - b)

    // The occurrences finals week eats, walked once per project rather than
    // per request window: they are a property of the term, and a calendar app
    // needs every one of them whichever month the caller happened to ask for.
    const skipDates: string[] = []
    if (term.finalsStartAt && term.finalsEndAt) {
      const finalsFrom = addDays(readCampus(term.finalsStartAt), -1)
      const finalsTo = addDays(readCampus(term.finalsEndAt), 1)

      for (
        let day = finalsFrom;
        beforeOrEqual(day, finalsTo);
        day = addDays(day, 1)
      ) {
        if (!weekdays.includes(weekdayOf(day))) continue
        const at = campusInstant(day, start[0], start[1])
        if (at >= term.finalsStartAt && at <= term.finalsEndAt) {
          skipDates.push(at.toISOString())
        }
      }
    }

    const series: MeetingSeries = {
      projectSlug: project.slug,
      projectTitle: project.title,
      weekdays,
      startTime: project.meetingStartTime ?? '',
      endTime: project.meetingEndTime ?? '',
      location: project.meetingLocation,
      untilDate: term.endsAt.toISOString(),
      skip:
        term.finalsStartAt && term.finalsEndAt
          ? {
              from: term.finalsStartAt.toISOString(),
              to: term.finalsEndAt.toISOString(),
            }
          : null,
      skipDates,
    }

    // The lead's own note, or nothing. This used to be a sentence built here —
    // "The regular X meeting in Y. Set by the project lead, and running to the
    // end of the semester." — which told a reader the two things already
    // printed on the chip they were reading it from, and did it on every
    // occurrence of every project. What is worth saying about a meeting is
    // whatever the lead knows and the columns cannot hold, so the column holds
    // it and an empty one prints empty. The bounds that sentence also mentioned
    // are still said, by `seriesSummary` in the browser, off `meeting` below —
    // which is where they belong, because they are a property of the series.
    const description = project.meetingDescription

    // Walk the campus calendar, not the UTC one. A day is a thing on a wall,
    // and which Tuesday a meeting falls on is decided in Orlando.
    //
    // One day of slack at each end so an occurrence that starts on the campus
    // day before `from` but runs into the window still lands — a meeting
    // running to 10pm Eastern on the 31st is the 1st in UTC.
    const walkFrom = addDays(readCampus(from), -1)
    const walkTo = addDays(readCampus(to), 1)

    for (
      let day = walkFrom;
      beforeOrEqual(day, walkTo);
      day = addDays(day, 1)
    ) {
      if (!weekdays.includes(weekdayOf(day))) continue

      const startsAt = campusInstant(day, start[0], start[1])
      let endsAt = campusInstant(day, end[0], end[1])
      // A meeting that ends before it starts ran past midnight. The columns
      // hold wall-clock times with no date, so this is the only reading that
      // makes sense of "20:00 to 01:00", and it is the same reading the create
      // route refuses — this is here for rows written before it existed.
      if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + DAY_MS)

      // The term's own bounds, both ends.
      if (startsAt < term.startsAt || startsAt > term.endsAt) continue

      // The halt. Overlap rather than containment, so a meeting that begins the
      // evening finals starts is dropped too.
      if (
        term.finalsStartAt &&
        term.finalsEndAt &&
        startsAt <= term.finalsEndAt &&
        endsAt >= term.finalsStartAt
      ) {
        continue
      }

      // The requested window, half-open, applied last so the bounds above are
      // what decide whether a meeting exists at all.
      if (startsAt < from || startsAt >= to) continue

      occurrences.push({
        // The `meeting:` prefix `DashboardCalendar` already used, kept so
        // nothing downstream mistakes one of these for a row the server owns.
        id: `meeting:${project.id}:${startsAt.toISOString()}`,
        slug: project.slug,
        title: `${project.title} meeting`,
        description,
        type: 'MEETING',
        location: project.meetingLocation,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        allDay: false,
        registrationUrl: null,
        meeting: series,
        projectId: project.id,
        project: { slug: project.slug, title: project.title },
      })
    }
  }

  return occurrences
}

/** The public shape: everything a visitor may see, and none of the rest. */
export function asPublicEvent(occurrence: MeetingOccurrence) {
  const { projectId: _id, project: _project, ...rest } = occurrence
  return rest
}

/**
 * The member shape, matching what `/me/events` sends for a stored row.
 *
 * `published` is true because these are on the public calendar when the project
 * says so, and the member view never has to decide otherwise — the filtering
 * happened when the caller chose which projects to expand. `createdById` is
 * null because nobody created it: it is a rule, not a row, and a member finding
 * their own name on a meeting they never scheduled would be a lie the edit
 * buttons then act on.
 */
export function asMemberEvent(occurrence: MeetingOccurrence) {
  return {
    ...occurrence,
    published: true,
    teamId: null,
    createdById: null,
    team: null,
  }
}
