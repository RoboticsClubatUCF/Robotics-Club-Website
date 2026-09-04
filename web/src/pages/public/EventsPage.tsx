import { useId, useState } from 'react'
import { FilterChips } from '../../components/shared/FilterChips'
import { AgendaRow, AgendaSkeleton } from '../../components/shared/MonthCalendar'
import { FormEyebrow, FormHeading, fieldClass } from '../../components/shared/formChrome'
import type { ApiEvent } from '../../lib/api/api'
import { hits } from '../../lib/equipment/catalogue'
import { useApi } from '../../lib/api/useApi'

/**
 * `/events` — the schedule as a list, forwards and backwards.
 *
 * Deliberately not a second calendar. The front page's month grid answers "what is on this week";
 * this answers "what is coming up" and "what did we do" — neither of which fits in thirty squares,
 * and the second of which the grid can't reach without pressing the back arrow eight times. So one
 * list, ordered, with the past a chip away.
 *
 * It draws the calendar's own row. `AgendaRow` went from private to exported in
 * `shared/MonthCalendar.tsx` for this — an event on the front page and the same event here must not
 * be two different objects, and what would drift is what nobody would notice for a year: the
 * add-to-calendar menu, and the time label that says the day twice when a run crosses midnight.
 *
 * Project meetings aren't in this list, and that's the endpoint's rule rather than an omission. A
 * meeting is a recurrence, not a row, and `GET /events` only expands one against a named window —
 * "the next fifty events" has no answer for a rule that repeats until December. Every caller that
 * wants meetings is a calendar and every calendar asks for a month, so the lede points at the one
 * on the front page.
 *
 * `when` refetches; type and the search box narrow what arrived. Past and upcoming are different
 * rows in a different order, so that one is `?when=` and the path change is what `useApi` re-runs
 * on.
 */

/** The server caps `limit` at 100. Past this the page wants pagination, not a
    bigger number — a club with more than a hundred upcoming events has a
    different problem. */
const LIMIT = 100

/** "Don't narrow by this". No `EventType` can collide with it. */
const ANY = 'ALL' as const

type When = 'upcoming' | 'past'

const whenOptions = [
  { value: 'upcoming' as const, label: 'UPCOMING' },
  { value: 'past' as const, label: 'PAST' },
]

export function EventsPage() {
  const id = useId()

  const [when, setWhen] = useState<When>('upcoming')
  /**
   * Typed off the wire rather than off the `EventType` enum, because the chips are built from the
   * types the fetched rows actually carry. The union is wider than this page can ever see —
   * `'TASK'` is a task deadline on one member's own calendar and never reaches `/api/events` — but
   * restating the enum here would be a second list to keep in step for the sake of excluding a
   * value that can't arrive.
   */
  const [type, setType] = useState<ApiEvent['type'] | typeof ANY>(ANY)
  const [query, setQuery] = useState('')

  const events = useApi<ApiEvent[]>(`/events?when=${when}&limit=${LIMIT}`)

  const all = events.status === 'ready' ? events.data : []

  /**
   * The types to offer, off the response rather than off the enum.
   *
   * `EventType` has six values and a club rarely uses all six at once — a chip for FUNDRAISER on a
   * page with no fundraisers can only ever show an empty list, which reads as broken. Same rule the
   * officer archive's year chips follow. It also means the row follows the window: press PAST and
   * the types that year actually used arrive with it.
   */
  const typeOptions = [
    { value: ANY, label: 'ALL TYPES' },
    ...[...new Set(all.map((event) => event.type))].map((value) => ({
      value,
      label: value,
    })),
  ]

  const shown = all.filter(
    (event) =>
      (type === ANY || event.type === type) &&
      hits([event.title, event.description, event.location, event.type], query),
  )

  return (
    <section className="px-page py-12 wide:py-18">
      <div className="mb-9">
        <FormEyebrow>/ EVENTS</FormEyebrow>
        <FormHeading>What&rsquo;s on.</FormHeading>
        <p className="text-dim max-w-[36rem] text-sm leading-[1.7] text-pretty">
          Competitions, workshops, outreach and socials — everything the club has
          published, newest first once you look backwards. Weekly project
          meetings repeat rather than being scheduled one at a time, so they live
          on the{' '}
          {/* A plain `<a>`, not a `<Link>`: this one carries a hash. A `<Link>`
              takes the navigation over and then does not scroll anywhere, which
              is the rule in `.claude/docs/frontend.md`. */}
          <a
            href="/#events"
            className="text-primary border-primary/40 hover:border-primary border-b transition-colors duration-200"
          >
            month grid on the front page
          </a>
          .
        </p>
      </div>

      <div className="mb-9 space-y-2.5">
        <div>
          <label htmlFor={`${id}-search`} className="sr-only">
            Search events
          </label>
          <input
            id={`${id}-search`}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
            placeholder="Search events…"
            className={`${fieldClass} max-w-[22rem]`}
          />
        </div>

        {/* Rendered while the request is in flight as well, unlike the roster's
            controls: this row is what *caused* the request, and a pair of chips
            that vanish on every press is a control somebody has to hunt for
            again each time they use it. */}
        <FilterChips
          label="WHEN"
          options={whenOptions}
          value={when}
          onChange={setWhen}
          disabled={events.status === 'loading'}
        />

        {typeOptions.length > 2 && (
          <FilterChips
            label="TYPE"
            options={typeOptions}
            value={type}
            onChange={setType}
          />
        )}
      </div>

      {events.status === 'loading' && <AgendaSkeleton />}

      {events.status === 'error' && (
        <p className="border-rule text-faint border-t py-6.5 text-sm">
          Couldn&rsquo;t load the schedule just now. Please try again later.
        </p>
      )}

      {events.status === 'ready' &&
        (all.length === 0 ? (
          <p className="border-rule text-faint border-t py-6.5 text-sm">
            {when === 'past'
              ? 'Nothing has been recorded yet.'
              : 'Nothing is scheduled yet. Check the Discord in the meantime.'}
          </p>
        ) : (
          <>
            <p
              className="text-faint mb-5 font-mono text-[10px] font-medium tracking-[0.16em]"
              aria-live="polite"
            >
              {shown.length === 0
                ? 'NO MATCHES'
                : `${shown.length} SHOWN OF ${all.length}`}
            </p>

            {shown.length === 0 ? (
              <p className="border-rule text-dim border-t py-6.5 text-sm leading-[1.7]">
                Nothing on the schedule matches that.
              </p>
            ) : (
              <div>
                {shown.map((event) => (
                  <AgendaRow key={event.id} event={event} />
                ))}
                {/* Closes the list — every row draws its own top rule, so
                    without this the last one has no bottom edge. */}
                <div className="border-rule border-t" />
              </div>
            )}
          </>
        ))}
    </section>
  )
}
