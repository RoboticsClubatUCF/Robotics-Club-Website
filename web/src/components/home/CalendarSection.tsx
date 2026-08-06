import { useEffect, useRef, useState } from 'react'
import type { ApiEvent } from '../../lib/api'
import { useApi } from '../../lib/useApi'

/**
 * The club calendar: a month grid with the same month's events listed under it.
 *
 * Both halves show one month because the grid is what you scan and the list is
 * what you read — a cell four columns wide has no room for a time and a room
 * number, and an agenda on its own loses the shape of the week. The grid is
 * pure date arithmetic, so it renders before the fetch lands and never reflows
 * when it does; only the chips and the list below wait on data.
 *
 * Everything is computed in the visitor's local zone. The API sends UTC ISO
 * strings and `new Date(...)` plus the local `get*` accessors do the conversion,
 * which is what puts an event that starts at 8pm Eastern on the right square for
 * someone reading in Orlando.
 */

const weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

/** How many chips fit in a cell before the rest become a count. */
const CHIPS_PER_CELL = 2

const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1)

const addMonths = (date: Date, count: number) =>
  new Date(date.getFullYear(), date.getMonth() + count, 1)

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate())

const sameDay = (a: Date, b: Date) =>
  startOfDay(a).getTime() === startOfDay(b).getTime()

/**
 * The month as rows of seven, padded with nulls to whole weeks so the grid keeps
 * its rectangle whichever weekday the 1st lands on.
 */
function monthGrid(month: Date): (Date | null)[][] {
  const leading = month.getDay()
  // Day 0 of the next month is the last day of this one.
  const length = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()

  const cells: (Date | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from(
      { length },
      (_, index) => new Date(month.getFullYear(), month.getMonth(), index + 1),
    ),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  return Array.from({ length: cells.length / 7 }, (_, week) =>
    cells.slice(week * 7, week * 7 + 7),
  )
}

/**
 * Every event touching `day`, not just the ones starting on it — a four-day
 * competition has to appear on all four squares.
 */
function eventsOn(events: ApiEvent[], day: Date): ApiEvent[] {
  const from = day.getTime()
  const to = from + 24 * 60 * 60 * 1000

  return events.filter((event) => {
    const starts = new Date(event.startsAt).getTime()
    const ends = event.endsAt ? new Date(event.endsAt).getTime() : starts
    return starts < to && ends >= from
  })
}

const monthName = (date: Date) =>
  date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

const dayName = (date: Date) =>
  date.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

const shortDate = (date: Date) =>
  date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

const clockTime = (date: Date) =>
  date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

function dateLabel(event: ApiEvent): string {
  const starts = new Date(event.startsAt)
  const ends = event.endsAt ? new Date(event.endsAt) : null

  return ends && !sameDay(starts, ends)
    ? `${shortDate(starts)} – ${shortDate(ends)}`
    : shortDate(starts)
}

function timeLabel(event: ApiEvent): string {
  // `allDay` is the flag that says the timestamps carry a date and nothing else,
  // so printing "12:00 AM – 11:59 PM" here would be inventing precision.
  if (event.allDay) return 'ALL DAY'

  const starts = new Date(event.startsAt)
  if (!event.endsAt) return clockTime(starts)

  const ends = new Date(event.endsAt)
  // A run that crosses midnight has to say the day twice: on its own,
  // "7:00 PM – 10:00 PM" reads as three hours when it was three days.
  return sameDay(starts, ends)
    ? `${clockTime(starts)} – ${clockTime(ends)}`
    : `${shortDate(starts)}, ${clockTime(starts)} – ${shortDate(ends)}, ${clockTime(ends)}`
}

export function CalendarSection() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [selected, setSelected] = useState<Date | null>(null)
  const schedule = useRef<HTMLDivElement>(null)
  const today = new Date()

  const goToMonth = (next: Date) => {
    setMonth(next)
    // The selected day is not in the month being moved to, and a filter you
    // can no longer see the cell for is a filter you can't undo.
    setSelected(null)
  }

  useEffect(() => {
    if (!selected) return

    // `nearest` scrolls only if the schedule is off screen, which on a phone it
    // is — the grid is most of the viewport — and on a desktop it isn't, so
    // nothing jumps. Optional call because jsdom has no layout and therefore no
    // `scrollIntoView`.
    schedule.current?.scrollIntoView?.({ block: 'nearest' })
  }, [selected])

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

  const rows = monthGrid(month)
  const showing = events.status === 'ready' ? events.data : []
  const onThisMonth = sameDay(startOfMonth(today), month)
  // `eventsOn` rather than a start-date match, so a competition that runs Friday
  // to Sunday opens on all three days and not only the one it began.
  const listed = selected ? eventsOn(showing, selected) : showing

  return (
    <section
      id="events"
      className="border-rule px-page scroll-mt-20 border-t py-12 wide:py-18"
    >
      <div className="mb-9 flex items-baseline justify-between">
        <h2 className="text-faint font-mono text-[13px] font-bold tracking-[0.2em]">
          / EVENTS
        </h2>
        <a
          href="/events"
          className="text-primary border-primary/40 hover:border-primary border-b pb-0.5 text-xs font-medium transition-colors duration-200"
        >
          All events
        </a>
      </div>

      <div className="border-rule mb-px flex items-center justify-between border-t pt-5 pb-5">
        <h3
          /* aria-live so a screen reader is told which month it moved to — the
             month name is the only thing that changes when the arrows are used. */
          aria-live="polite"
          className="text-lg font-semibold tracking-[-0.01em] uppercase wide:text-xl"
        >
          {monthName(month)}
        </h3>

        <div className="flex items-center gap-2">
          {!onThisMonth && (
            <button
              type="button"
              onClick={() => {
                goToMonth(startOfMonth(new Date()))
              }}
              className="text-faint border-rule hover:border-primary hover:text-primary focus-visible:outline-primary mr-1 flex min-h-11 cursor-pointer items-center border px-3 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 wide:min-h-8"
            >
              TODAY
            </button>
          )}
          <MonthButton label="Previous month" onClick={() => { goToMonth(addMonths(month, -1)) }}>
            ‹
          </MonthButton>
          <MonthButton label="Next month" onClick={() => { goToMonth(addMonths(month, 1)) }}>
            ›
          </MonthButton>
        </div>
      </div>

      {/* A real table, not a grid of divs: the columns mean weekdays, which is
          what `scope="col"` on the headers tells assistive tech. Tailwind's
          preflight collapses the borders, so adjacent cells share one hairline
          instead of stacking two. */}
      <table
        className="w-full table-fixed"
        aria-label={`Events in ${monthName(month)}`}
      >
        <thead>
          <tr>
            {weekdays.map((weekday) => (
              <th
                key={weekday}
                scope="col"
                className="text-faint border-rule border px-2 py-2 text-center font-mono text-[9px] font-medium tracking-[0.14em] wide:text-[10px]"
              >
                {weekday}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((week, index) => (
            <tr key={index}>
              {week.map((day, dayIndex) =>
                day === null ? (
                  /* Padding to the week's edge. `bg-base-200` sets it a step
                     back from the month so the rectangle reads as a frame
                     rather than as more days. */
                  <td
                    key={dayIndex}
                    className="border-rule bg-base-200 border"
                    aria-hidden
                  />
                ) : (
                  <DayCell
                    key={dayIndex}
                    day={day}
                    isToday={sameDay(day, today)}
                    events={eventsOn(showing, day)}
                    /* The hover card is wider than a square, so it has to know
                       which way it can afford to spill. Thursday is the pivot:
                       anything from there rightwards hangs off its right edge
                       instead, or Saturday's card would leave the page. */
                    alignRight={dayIndex >= 4}
                    isSelected={selected !== null && sameDay(day, selected)}
                    onSelect={() => {
                      // Toggling, so the cell that opened the day also closes
                      // it — otherwise the only way back to the month is the
                      // button below the grid, which may be off screen.
                      setSelected(
                        selected !== null && sameDay(day, selected) ? null : day,
                      )
                    }}
                  />
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {/* The schedule is where a day opens. Selecting a square filters this list
          rather than adding a second one beside it: two lists of the same events
          on one screen is one list too many, and this one already knows how to
          draw an event. */}
      <div ref={schedule} className="mt-10 scroll-mt-24">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3
            /* Live, because on a phone the tapped square and this heading are
               rarely on screen together — the change of heading is how you know
               the list below is now one day. */
            aria-live="polite"
            className="text-faint font-mono text-[10px] font-medium tracking-[0.16em]"
          >
            {(selected ? dayName(selected) : monthName(month)).toUpperCase()} · SCHEDULE
          </h3>

          {selected && (
            <button
              type="button"
              onClick={() => {
                setSelected(null)
              }}
              className="text-primary border-primary/40 hover:border-primary focus-visible:outline-primary cursor-pointer border-b pb-0.5 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              SHOW THE WHOLE MONTH
            </button>
          )}
        </div>

        {events.status === 'loading' && <AgendaSkeleton />}

        {events.status === 'error' && (
          <p className="border-rule text-faint border-t py-6.5 text-sm">
            Couldn't load the calendar just now. Please try again later.
          </p>
        )}

        {events.status === 'ready' &&
          (listed.length === 0 ? (
            <p className="border-rule text-faint border-t py-6.5 text-sm">
              {selected
                ? 'Nothing on this day.'
                : 'Nothing on the calendar this month.'}
            </p>
          ) : (
            listed.map((event) => <AgendaRow key={event.id} event={event} />)
          ))}

        {/* Every row draws its own top rule, so the list needs a closing edge. */}
        <div className="border-rule border-t" />
      </div>
    </section>
  )
}

function MonthButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      /* 44px on a phone, back to 32 where there is a pointer. Two arrows eight
         pixels apart is a coin toss with a thumb. */
      className="border-rule text-dim hover:border-primary hover:text-primary focus-visible:outline-primary flex size-11 cursor-pointer items-center justify-center border text-lg leading-none transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 wide:size-8"
    >
      {children}
    </button>
  )
}

/**
 * One square.
 *
 * A day that has something on it is a button: pressing it opens that day in the
 * schedule below, which is the only way to read an event on a phone — a square
 * is forty pixels wide there and carries dots, not text. A day with nothing on
 * it is not a button, because there is nothing to open and thirty empty tab
 * stops between the ones that matter help nobody.
 *
 * The chips inside are spans, not buttons. They can't be: a button cannot
 * contain a button, and the square is the more useful target of the two. Their
 * hover cards are `aria-hidden` and the square carries an explicit `aria-label`,
 * so a card's paragraph of detail can't leak into the button's name.
 */
function DayCell({
  day,
  isToday,
  events,
  alignRight,
  isSelected,
  onSelect,
}: {
  day: Date
  isToday: boolean
  events: ApiEvent[]
  alignRight: boolean
  isSelected: boolean
  onSelect: () => void
}) {
  const overflow = events.length - CHIPS_PER_CELL

  const inner = (
    <>
      <span
        className={
          isToday
            ? /* Filled rather than merely gold, so today survives
                 `prefers-reduced-motion` and colour-blind viewing — the shape
                 changes, not just the hue. */
              'bg-primary text-primary-content flex size-5 items-center justify-center rounded-[2px] font-mono text-[10px] font-semibold'
            : 'text-dim flex size-5 items-center justify-center font-mono text-[10px] font-medium'
        }
      >
        {day.getDate()}
      </span>

      {/* Below the breakpoint a cell is about 40px wide, which fits a dot per
          event and nothing legible. The chips take over at `wide`. */}
      {events.length > 0 && (
        <span className="mt-1 flex flex-wrap justify-center gap-0.5 wide:hidden">
          {events.map((event) => (
            <span
              key={event.id}
              title={event.title}
              className="bg-primary size-1 rounded-full"
            />
          ))}
        </span>
      )}

      <span className="mt-1 hidden flex-col gap-0.5 wide:flex">
        {events.slice(0, CHIPS_PER_CELL).map((event) => (
          <EventChip key={event.id} event={event} alignRight={alignRight} />
        ))}
        {overflow > 0 && (
          <span className="text-faint px-1 font-mono text-[9px] font-medium">
            +{overflow} more
          </span>
        )}
      </span>
    </>
  )

  const padding = 'flex w-full flex-col items-start p-1 text-left wide:min-h-24 wide:p-1.5'

  return (
    <td
      className={`border-rule border p-0 align-top ${
        isSelected ? 'bg-wash' : 'bg-base-100'
      }`}
    >
      {events.length === 0 ? (
        <div className={padding}>{inner}</div>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={isSelected}
          /* The label, not the contents. Without it the accessible name would
             be the day number, every chip, and every hover card's paragraph,
             read out in one breath. */
          aria-label={`${dayName(day)}, ${events.length} ${
            events.length === 1 ? 'event' : 'events'
          }`}
          className={`${padding} hover:bg-wash focus-visible:outline-primary cursor-pointer transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 ${
            isSelected ? 'outline-primary outline-2 -outline-offset-2' : ''
          }`}
        >
          {inner}
        </button>
      )}
    </td>
  )
}

/**
 * A chip in a square, and the card it shows on hover.
 *
 * A square is about a hundred pixels wide, so the chip can only ever be a
 * truncated title; the card is where the same event gets its date, its full time
 * range and its description. It replaces the `title` attribute that used to sit
 * on the chip — a native tooltip would have raced this one and won after a
 * second.
 *
 * Hover needs no state: `:hover` matches an ancestor whose descendant is
 * hovered, so the card counts as part of the chip even though it hangs outside
 * the square, and the gap between the two is the card's own `pt-1.5` rather than
 * a margin — a real gap would drop the hover as the pointer crossed it.
 *
 * There is no click and no focus here, because the chip is inside the square's
 * button and a button cannot contain a button. That is the right way round: the
 * square opens the whole day in the schedule below, which is readable, works on
 * a phone, and doesn't strand anyone on a card that vanishes. The card is a
 * shortcut for a pointer, `aria-hidden` because every word of it is in that
 * schedule.
 *
 * Hidden, it is `invisible` rather than merely transparent. An `opacity-0` card
 * would still swallow clicks meant for the squares underneath it.
 */
function EventChip({ event, alignRight }: { event: ApiEvent; alignRight: boolean }) {
  return (
    <span className="group/chip relative block w-full">
      <span className="bg-base-300 group-hover/chip:bg-primary group-hover/chip:text-primary-content block truncate px-1 py-0.5 text-[10px] leading-tight transition-colors duration-200">
        {event.title}
      </span>

      <span
        aria-hidden
        className={`pointer-events-none invisible absolute top-full z-20 w-64 translate-y-1 pt-1.5 opacity-0 transition-[opacity,translate,visibility] duration-200 group-hover/chip:visible group-hover/chip:translate-y-0 group-hover/chip:opacity-100 ${
          alignRight ? 'right-0' : 'left-0'
        }`}
      >
        {/* A step lighter than the squares it floats over — the hairline alone
            is not enough separation at this contrast. */}
        <span className="border-rule bg-base-300 block border p-3 text-left">
          <span className="text-primary block font-mono text-[10px] font-medium tracking-[0.14em] uppercase">
            {dateLabel(event)}
          </span>
          <span className="mt-1.5 block text-[13px] leading-snug font-semibold">
            {event.title}
          </span>
          <span className="text-dim mt-1 block font-mono text-[11px] font-medium tracking-[0.06em]">
            {timeLabel(event)}
          </span>
          <span className="text-faint mt-1.5 block font-mono text-[9px] font-medium tracking-[0.14em]">
            {event.type}
            {event.location && ` · ${event.location}`}
          </span>
          {event.description && (
            <span className="text-dim mt-2 line-clamp-3 block text-xs leading-[1.5]">
              {event.description}
            </span>
          )}
        </span>
      </span>
    </span>
  )
}

/**
 * The time used to sit in a third column, right-aligned — which put it past the
 * description at every width and after it entirely below the breakpoint. It
 * reads as part of the entry, so it belongs under the title with the rest of the
 * detail, and the row is two columns again.
 */
const agendaRowClass =
  'border-rule grid grid-cols-[4.5rem_1fr] items-start gap-3 border-t py-4 wide:grid-cols-[7rem_1fr] wide:gap-6'

function AgendaRow({ event }: { event: ApiEvent }) {
  return (
    <article className={agendaRowClass}>
      <div className="text-primary pt-0.5 font-mono text-[11px] font-medium tracking-[0.06em] uppercase">
        {dateLabel(event)}
      </div>

      <div>
        <h4 className="text-base leading-snug font-semibold">{event.title}</h4>
        <p className="text-dim mt-1 font-mono text-[11px] font-medium tracking-[0.06em]">
          {timeLabel(event)}
        </p>
        <p className="text-faint mt-1 font-mono text-[10px] font-medium tracking-[0.14em]">
          {event.type}
          {event.location && ` · ${event.location}`}
        </p>
        {event.description && (
          <p className="text-dim mt-2 max-w-[42rem] text-sm leading-[1.6] text-pretty">
            {event.description}
          </p>
        )}
        {event.registrationUrl && (
          <a
            href={event.registrationUrl}
            className="text-primary border-primary/40 hover:border-primary mt-2.5 inline-block border-b pb-0.5 text-xs font-medium transition-colors duration-200"
          >
            Register
          </a>
        )}
      </div>
    </article>
  )
}

/** Placeholder rows at the real height, so the footer doesn't jump. */
function AgendaSkeleton() {
  return (
    <div aria-hidden>
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className={agendaRowClass}>
          <div className="bg-base-300 mt-1 h-2.5 w-14 animate-pulse rounded-[2px]" />
          <div className="space-y-2">
            <div className="bg-base-300 h-4 w-40 animate-pulse rounded-[2px]" />
            <div className="bg-base-300 h-2.5 w-28 animate-pulse rounded-[2px]" />
            <div className="bg-base-300 h-2.5 w-56 animate-pulse rounded-[2px]" />
          </div>
        </div>
      ))}
    </div>
  )
}
