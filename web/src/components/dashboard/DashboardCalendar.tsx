import { useState } from 'react'
import type { ApiMeEvent } from '../../lib/api/api'
import { addMonths, startOfMonth } from '../../lib/events/months'
import { useApi } from '../../lib/api/useApi'
import { MonthCalendar } from '../shared/MonthCalendar'

/**
 * The member's calendar: the shared month grid over `/api/me/events`.
 *
 * That endpoint answers with everything the member should see on one calendar —
 * the public events, their own projects' unpublished ones, and every project
 * meeting they are entitled to. All three arrive as one sorted array, so this
 * component is now the fetch and nothing else.
 *
 * **It used to synthesise the meeting chips itself**, in `meetingsIn`, from the
 * three schedule columns on each of `/me/projects`. That has moved to
 * `server/src/projects/meetings.ts`, and the move was not a tidy-up. The browser version
 * had no way to know when a project's term ended, so it painted Tuesdays into
 * the next decade; it had no way to know when finals week was, so it never
 * paused anything; and the landing page could not use it at all, being
 * anonymous — which would have meant a second implementation of the same
 * arithmetic for the public calendar. One answer, on the server, and both
 * calendars read it.
 *
 * The `projects` prop went with it. Nothing here needs the membership list any
 * more.
 */
export function DashboardCalendar() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()))

  const from = encodeURIComponent(month.toISOString())
  const to = encodeURIComponent(addMonths(month, 1).toISOString())
  const events = useApi<ApiMeEvent[]>(`/me/events?from=${from}&to=${to}`)

  return (
    <div>
      <p className="text-faint mb-1 font-mono text-[10px] font-medium tracking-[0.16em]">
        CALENDAR
      </p>
      <MonthCalendar month={month} onMonthChange={setMonth} events={events} />
    </div>
  )
}
