import { useState } from 'react'
import { Link } from 'react-router'
import type { ApiEvent } from '../../lib/api/api'
import { addMonths, startOfMonth } from '../../lib/events/months'
import { useApi } from '../../lib/api/useApi'
import { MonthCalendar } from '../shared/MonthCalendar'

/**
 * The landing page's calendar: the shared `MonthCalendar` over the public
 * events endpoint.
 *
 * The grid, the chips and the agenda all live in `shared/MonthCalendar.tsx` —
 * they moved there when the dashboard needed the same widget over
 * `/api/me/events`. What stays here is exactly what is specific to this page:
 * the section chrome, and the fetch against the public route.
 */
export function CalendarSection() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()))

  // Half-open, and the same window the server filters on. Derived straight from
  // `month` rather than memoised: the string is what `useApi` keys its effect
  // on, and an identical month yields an identical string.
  const from = encodeURIComponent(month.toISOString())
  const to = encodeURIComponent(addMonths(month, 1).toISOString())
  // `when=all` because a grid has to show the days that have already gone; the
  // range is what limits the response, not the upcoming/past split.
  const events = useApi<ApiEvent[]>(
    `/events?when=all&limit=100&from=${from}&to=${to}`,
  )

  return (
    <section
      id="events"
      className="border-rule px-page scroll-mt-20 border-t py-12 wide:py-18"
    >
      <div className="mb-9 flex items-baseline justify-between">
        <h2 className="text-faint font-mono text-[13px] font-bold tracking-[0.2em]">
          / EVENTS
        </h2>
        {/* A real `<Link>` since `/events` became a page: this grid shows one
            month, and the listing is where the rest of the term is. */}
        <Link
          to="/events"
          className="text-primary border-primary/40 hover:border-primary border-b pb-0.5 text-xs font-medium transition-colors duration-200"
        >
          All events
        </Link>
      </div>

      <MonthCalendar month={month} onMonthChange={setMonth} events={events} />
    </section>
  )
}
