import { useState } from 'react'
import type { ApiEvent, ApiMeEvent, ApiMyProject } from '../../lib/api'
import { formatMeetingTime } from '../../lib/meetings'
import { addMonths, startOfMonth } from '../../lib/months'
import type { ApiState } from '../../lib/useApi'
import { useApi } from '../../lib/useApi'
import { MonthCalendar } from '../shared/MonthCalendar'

/**
 * The member's calendar: the shared month grid over `/api/me/events` — public
 * events plus their own projects' unpublished ones — with each project's
 * weekly meeting painted on top.
 *
 * The meeting chips are synthesised here, client-side, from the three schedule
 * fields on the project. That is the whole recurrence model: no generated
 * Event rows to sweep or dedupe, just arithmetic over the days of whatever
 * month is showing. Their ids carry a `meeting:` prefix so nothing mistakes
 * them for rows the server owns; the title says whose meeting it is, because
 * on a calendar that also shows club-wide events, "Meeting" alone answers
 * nothing.
 */
export function DashboardCalendar({
  projects,
}: {
  projects: ApiState<ApiMyProject[]>
}) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()))

  const from = encodeURIComponent(month.toISOString())
  const to = encodeURIComponent(addMonths(month, 1).toISOString())
  const events = useApi<ApiMeEvent[]>(`/me/events?from=${from}&to=${to}`)

  const merged: ApiState<ApiEvent[]> =
    events.status === 'ready'
      ? {
          status: 'ready',
          data: [
            ...events.data,
            ...meetingsIn(
              month,
              projects.status === 'ready' ? projects.data : [],
            ),
          ].sort(
            (a, b) =>
              new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
          ),
        }
      : events

  return (
    <div>
      <p className="text-faint mb-1 font-mono text-[10px] font-medium tracking-[0.16em]">
        CALENDAR
      </p>
      <MonthCalendar month={month} onMonthChange={setMonth} events={merged} />
    </div>
  )
}

/**
 * One synthetic entry per matching weekday of the visible month, per project
 * with a schedule. Wall-clock in the visitor's zone — the same reading every
 * other part of the site gives `meetingTime` — and one hour long, which is a
 * chip's worth of honesty for a meeting whose real length nobody recorded.
 */
function meetingsIn(month: Date, memberships: ApiMyProject[]): ApiEvent[] {
  const entries: ApiEvent[] = []
  const daysInMonth = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0,
  ).getDate()

  for (const { project } of memberships) {
    if (project.meetingWeekday === null || !project.meetingTime) continue

    const [hour = 0, minute = 0] = project.meetingTime.split(':').map(Number)

    for (let dayOfMonth = 1; dayOfMonth <= daysInMonth; dayOfMonth++) {
      const day = new Date(month.getFullYear(), month.getMonth(), dayOfMonth)
      if (day.getDay() !== project.meetingWeekday) continue

      const startsAt = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        hour,
        minute,
      )

      entries.push({
        id: `meeting:${project.id}:${startsAt.toISOString()}`,
        slug: project.slug,
        title: `${project.title} meeting`,
        description: `Weekly ${project.title} meeting — ${formatMeetingTime(project.meetingTime)}, every week. Set by the project lead.`,
        type: 'MEETING',
        location: project.meetingLocation,
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000).toISOString(),
        allDay: false,
        registrationUrl: null,
      })
    }
  }

  return entries
}
