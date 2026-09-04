import { useEffect, useRef, useState } from 'react'
import type { ApiEvent } from '../../lib/api/api'
import { AddToCalendar } from './AddToCalendar'
import { isGeneratedMeeting, isTaskEntry } from '../../lib/events/events'
import { addMonths, startOfMonth } from '../../lib/events/months'
import type { ApiState } from '../../lib/api/useApi'

/**
 * A month grid with the same month's events listed under it — the club's one
 * calendar widget.
 *
 * Extracted from the landing page's `CalendarSection` the day the dashboard
 * needed the same grid over a different endpoint. The split of labour: this
 * component owns *presentation* — the grid, the chips, the agenda, which day
 * is open — while the caller owns the *data*: which endpoint, which month, and
 * the fetch state. Month state lives with the caller because the caller's
 * fetch is keyed on it; the selected day lives here because nothing outside
 * cares which square is open.
 *
 * The grid is what you scan and the list is what you read — a cell four columns
 * wide has no room for a time and a room number, and an agenda on its own loses
 * the shape of the week.
 *
 * **Only the grid is a month.** The list under it is everything still ahead,
 * whichever month is on screen. Cut at the month's edge it was empty for the
 * last week of every month while the club had three things in the first week of
 * the next — and "what is on soon" is the one question a calendar on a front
 * page exists to answer. Opening a day still narrows the list to that day, past
 * days included: that is the grid's own window, and on a phone it is the only
 * way to read an event at all.
 *
 * So there are two fetches and `upcoming` is the second — the grid's window is
 * a month, the list's has no end. What a window *generates* rather than stores
 * (project meetings, task deadlines) can only come from the first, because a
 * recurrence has no answer for "the next fifty"; `publicMeetings` in
 * `server/src/routes/public/content.ts` is where that rule is written down. The
 * list therefore merges the month's generated entries into the forward stored
 * ones.
 *
 * The grid is pure date arithmetic, so it renders before the fetch lands and
 * never reflows when it does; only the chips and the list below wait on data.
 *
 * Everything is computed in the visitor's local zone. The API sends UTC ISO
 * strings and `new Date(...)` plus the local `get*` accessors do the
 * conversion, which is what puts an event that starts at 8pm Eastern on the
 * right square for someone reading in Orlando.
 *
 * Project meetings arrive as ordinary entries in the same array. They are
 * generated rather than stored — `server/src/projects/meetings.ts` expands them from the
 * project's schedule, stops them at the end of its term and drops finals week —
 * and this component neither knows nor needs to: the only thing it does with
 * the extra `meeting` field is hand it to `AddToCalendar`, so one press takes
 * the whole term rather than one evening.
 */

const weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

/** How many chips fit in a cell before the rest become a count. */
const CHIPS_PER_CELL = 2

/**
 * How many rows the schedule draws before it needs asking.
 *
 * The list stopped being a month and became "everything ahead", which is the
 * right answer to the question and the wrong length for a landing page — a term
 * with thirty things on it would push the rest of the page below two screens of
 * agenda. Five is what is happening soon; the button is for the rest of it.
 */
const AGENDA_ROWS = 5

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
 * A generated entry — a project meeting or a task deadline — rather than a
 * stored row. These exist only inside the window they were expanded for, which
 * is why the schedule takes them off the month rather than off the endless
 * upcoming list.
 */
const isGenerated = (event: ApiEvent) =>
  isGeneratedMeeting(event) || isTaskEntry(event)

/**
 * Hasn't finished yet — `unfinishedBy` in `routes/public/content.ts` to the
 * letter, so the list and the server agree on what "upcoming" means. An event
 * with no end is over the moment it starts; one with an end keeps its place at
 * the top of the list while it runs, rather than dropping off on its middle
 * day.
 */
const unfinished = (event: ApiEvent, now: Date) =>
  new Date(event.endsAt ?? event.startsAt).getTime() >= now.getTime()

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

export function MonthCalendar({
  month,
  onMonthChange,
  events,
  upcoming,
}: {
  month: Date
  onMonthChange: (next: Date) => void
  /** The month on screen: the grid, the chips, and whatever a day opens. */
  events: ApiState<ApiEvent[]>
  /** Everything still ahead, month boundaries ignored: the schedule below. */
  upcoming: ApiState<ApiEvent[]>
}) {
  const [selected, setSelected] = useState<Date | null>(null)
  const [expanded, setExpanded] = useState(false)
  const schedule = useRef<HTMLDivElement>(null)
  const today = new Date()

  /**
   * Open a day, or go back to the whole list. Never `setSelected` on its own:
   * a new list starts collapsed, because the count on the button is a promise
   * about what is below it and an expansion carried over from the last one
   * breaks it.
   */
  const showDay = (day: Date | null) => {
    setSelected(day)
    setExpanded(false)
  }

  const goToMonth = (next: Date) => {
    onMonthChange(next)
    // The selected day is not in the month being moved to, and a filter you
    // can no longer see the cell for is a filter you can't undo.
    showDay(null)
  }

  useEffect(() => {
    if (!selected) return

    // `nearest` scrolls only if the schedule is off screen, which on a phone it
    // is — the grid is most of the viewport — and on a desktop it isn't, so
    // nothing jumps. Optional call because jsdom has no layout and therefore no
    // `scrollIntoView`.
    schedule.current?.scrollIntoView?.({ block: 'nearest' })
  }, [selected])

  const rows = monthGrid(month)
  const showing = events.status === 'ready' ? events.data : []
  const ahead = upcoming.status === 'ready' ? upcoming.data : []
  const onThisMonth = sameDay(startOfMonth(today), month)

  /**
   * What the schedule lists: one day, or everything still to come.
   *
   * `eventsOn` rather than a start-date match, so a competition that runs Friday
   * to Sunday opens on all three days and not only the one it began.
   *
   * The forward list is the stored rows the second request went and got, plus
   * the generated ones only the month window carries — see the header. Both go
   * through `unfinished`, the generated half because it was fetched for a month
   * rather than for a moment and half of that month has already been.
   */
  const listed = selected
    ? eventsOn(showing, selected)
    : [...ahead, ...showing.filter(isGenerated)]
        .filter((event) => unfinished(event, today))
        .sort(
          (a, b) =>
            new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
        )

  /** Five rows, or the lot once somebody has asked for it. */
  const shown = expanded ? listed : listed.slice(0, AGENDA_ROWS)

  /**
   * The schedule waits on both requests while it is showing what is coming up,
   * and on the month alone once a day is open — everything on a day comes from
   * the grid's own window. Loading until both have landed rather than drawing
   * the stored rows and threading the meetings in between them a moment later:
   * a list that reorders itself under the reader is worse than a beat of
   * skeleton.
   */
  const listState: ApiState<unknown>['status'] = selected
    ? events.status
    : events.status === 'error' || upcoming.status === 'error'
      ? 'error'
      : events.status === 'ready' && upcoming.status === 'ready'
        ? 'ready'
        : 'loading'

  return (
    <>
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
          <MonthButton
            label="Previous month"
            onClick={() => {
              goToMonth(addMonths(month, -1))
            }}
          >
            ‹
          </MonthButton>
          <MonthButton
            label="Next month"
            onClick={() => {
              goToMonth(addMonths(month, 1))
            }}
          >
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
                      // it — otherwise the only way back to the full list is
                      // the button below the grid, which may be off screen.
                      showDay(
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
            {/* Not the month, because the list is not the month — naming it
                after the grid was what made an empty last week read as "the
                club has nothing on" rather than "look at September". */}
            {selected ? dayName(selected).toUpperCase() : 'UPCOMING'} · SCHEDULE
          </h3>

          {selected && (
            <button
              type="button"
              onClick={() => {
                showDay(null)
              }}
              className="text-primary border-primary/40 hover:border-primary focus-visible:outline-primary cursor-pointer border-b pb-0.5 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              SHOW EVERYTHING COMING UP
            </button>
          )}
        </div>

        {listState === 'loading' && <AgendaSkeleton />}

        {listState === 'error' && (
          <p className="border-rule text-faint border-t py-6.5 text-sm">
            Couldn't load the calendar just now. Please try again later.
          </p>
        )}

        {listState === 'ready' &&
          (listed.length === 0 ? (
            <p className="border-rule text-faint border-t py-6.5 text-sm">
              {selected ? 'Nothing on this day.' : 'Nothing coming up.'}
            </p>
          ) : (
            shown.map((event) => <AgendaRow key={event.id} event={event} />)
          ))}

        {/* Every row draws its own top rule, so the list needs a closing edge. */}
        <div className="border-rule border-t" />

        {/* Under the rule rather than above it, so the five rows still read as
            a finished list and this reads as more of it. The count is on the
            button because "SHOW ALL" alone gives no reason to press it — the
            number is the reason. */}
        {listState === 'ready' && listed.length > AGENDA_ROWS && (
          <button
            type="button"
            onClick={() => {
              setExpanded(!expanded)
            }}
            aria-expanded={expanded}
            className="text-primary border-primary/40 hover:border-primary focus-visible:outline-primary mt-5 cursor-pointer border-b pb-0.5 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {expanded ? 'SHOW FEWER' : `SHOW ALL ${listed.length}`}
          </button>
        )}
      </div>
    </>
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
 * That button is an overlay — `absolute inset-0`, painted behind the square's
 * own contents — rather than a wrapper around them. It has to be: the chips'
 * cards carry an "add to calendar" menu now, and a button can contain neither a
 * button nor a link. So the chips sit above the overlay with pointer events of
 * their own and press it themselves, everything else in the square is
 * `pointer-events-none` so a press there falls through, and the square's
 * `aria-label` is the whole of its accessible name because the button has no
 * contents left to build one from.
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
              'bg-primary text-primary-content pointer-events-none relative flex size-5 items-center justify-center rounded-[2px] font-mono text-[10px] font-semibold'
            : 'text-dim pointer-events-none relative flex size-5 items-center justify-center font-mono text-[10px] font-medium'
        }
      >
        {day.getDate()}
      </span>

      {/* Below the breakpoint a cell is about 40px wide, which fits a dot per
          event and nothing legible. The chips take over at `wide`. */}
      {events.length > 0 && (
        <span className="pointer-events-none relative mt-1 flex flex-wrap justify-center gap-0.5 wide:hidden">
          {events.map((event) => (
            <span
              key={event.id}
              title={event.title}
              className="bg-primary size-1 rounded-full"
            />
          ))}
        </span>
      )}

      {/* `pointer-events-none` on the column and back on per chip, so the gaps
          and the "+n more" count press the square underneath rather than
          swallowing the press into a dead strip. */}
      <span className="pointer-events-none relative mt-1 hidden flex-col gap-0.5 wide:flex">
        {events.slice(0, CHIPS_PER_CELL).map((event) => (
          <EventChip
            key={event.id}
            event={event}
            alignRight={alignRight}
            onSelect={onSelect}
          />
        ))}
        {overflow > 0 && (
          <span className="text-faint px-1 font-mono text-[9px] font-medium">
            +{overflow} more
          </span>
        )}
      </span>
    </>
  )

  return (
    <td
      className={`border-rule border p-0 align-top ${
        isSelected ? 'bg-wash' : 'bg-base-100'
      }`}
    >
      {/* `relative` on every piece of `inner` is what puts the contents in
          front of the overlay: both are positioned and neither carries a
          z-index, so document order decides, and the button is first. */}
      <div className="group/day relative flex w-full flex-col items-start p-1 text-left wide:min-h-24 wide:p-1.5">
        {events.length > 0 && (
          <button
            type="button"
            onClick={onSelect}
            aria-pressed={isSelected}
            /* The label is the button, now that the button has no contents.
               Named for the day and a count rather than for the events on it:
               the detail is a chip away and a paragraph of it read out in one
               breath is not a name. */
            aria-label={`${dayName(day)}, ${events.length} ${
              events.length === 1 ? 'event' : 'events'
            }`}
            /* `group-hover/day` rather than `hover`, so the square still lights
               up while the pointer is on one of the chips in front of it. */
            className={`group-hover/day:bg-wash focus-visible:outline-primary absolute inset-0 cursor-pointer transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 ${
              isSelected ? 'outline-primary outline-2 -outline-offset-2' : ''
            }`}
          />
        )}

        {inner}
      </div>
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
 * **The card takes pointer events, so it stays up while you are on it**, and
 * that is what lets it carry "add to calendar": a card that vanished the moment
 * the pointer left the chip could hold nothing anybody had to reach. It is why
 * the square behind is an overlay button and this chip is a button of its own —
 * see `DayCell`. The menu that button opens is a descendant of the card, so the
 * pointer never leaves the hovered subtree on its way down into it.
 *
 * The chip is out of the tab order, as it was when it was a span. The keyboard
 * route to an event is the square, which opens the day in the schedule below —
 * that is readable, works on a phone, and has the same "add to calendar" on
 * every row, so nobody is stranded on a card that needs a pointer to hold open.
 * `focus-within` is here for the one case that does put focus inside: clicking
 * the menu open.
 *
 * Hidden, it is `invisible` rather than merely transparent. An `opacity-0` card
 * would still swallow clicks meant for the squares underneath it — and now that
 * it has controls in it, tab stops as well.
 */
function EventChip({
  event,
  alignRight,
  onSelect,
}: {
  event: ApiEvent
  alignRight: boolean
  onSelect: () => void
}) {
  return (
    <div className="group/chip pointer-events-auto relative w-full">
      <button
        type="button"
        /* A chip is drawn on top of the square's overlay button, so it has to
           carry that button's press itself or it is a dead strip in the grid. */
        onClick={onSelect}
        /* Out of the tab order all the same: the square is already this day's
           tab stop, and three per day is two too many. */
        tabIndex={-1}
        /* Press without taking focus. The click still fires; what it stops is
           `focus-within` latching the card open over the grid every time
           somebody uses a chip to open its day. */
        onMouseDown={(mouse) => {
          mouse.preventDefault()
        }}
        /* A deadline is marked rather than coloured: the same left bar the
           dashboard rail uses for "you are here", because a chip in a different
           colour reads as a different *kind of event* and this is not one — it
           is a task, and only the person it belongs to can see it at all. */
        className={`bg-base-300 group-hover/chip:bg-primary group-hover/chip:text-primary-content block w-full cursor-pointer truncate py-0.5 text-left text-[10px] leading-tight transition-colors duration-200 ${
          isTaskEntry(event)
            ? 'border-warning border-l-2 pr-1 pl-1.5'
            : 'px-1'
        }`}
      >
        {event.title}
      </button>

      <div
        className={`invisible absolute top-full z-20 w-64 translate-y-1 pt-1.5 opacity-0 transition-[opacity,translate,visibility] duration-200 group-hover/chip:visible group-hover/chip:translate-y-0 group-hover/chip:opacity-100 group-focus-within/chip:visible group-focus-within/chip:translate-y-0 group-focus-within/chip:opacity-100 ${
          alignRight ? 'right-0' : 'left-0'
        }`}
      >
        {/* A step lighter than the squares it floats over — the hairline alone
            is not enough separation at this contrast. */}
        <div className="border-rule bg-base-300 border p-3 text-left">
          <p className="text-primary font-mono text-[10px] font-medium tracking-[0.14em] uppercase">
            {dateLabel(event)}
          </p>
          <p className="mt-1.5 text-[13px] leading-snug font-semibold">
            {event.title}
          </p>
          <p className="text-dim mt-1 font-mono text-[11px] font-medium tracking-[0.06em]">
            {timeLabel(event)}
          </p>
          <p className="text-faint mt-1.5 font-mono text-[9px] font-medium tracking-[0.14em]">
            {event.type}
            {event.location && ` · ${event.location}`}
          </p>
          {event.description && (
            <p className="text-dim mt-2 line-clamp-3 text-xs leading-[1.5]">
              {event.description}
            </p>
          )}

          {/* Aligned with the card, not with the chip: on the right-hand
              columns the card already hangs left, and a menu wider than the
              card would otherwise reach past the edge of the grid. */}
          <AddToCalendar
            event={event}
            align={alignRight ? 'right' : 'left'}
            className="mt-3"
          />
        </div>
      </div>
    </div>
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

/**
 * Exported for `/events`, which is the same entry without a grid over it — the
 * listing page shows a whole term at once rather than the month this widget is
 * looking at. Two implementations of "an event, as a row" would have drifted the
 * first time one of them was touched, and the add-to-calendar button and the
 * midnight-crossing time label are exactly the details that would drift.
 */
export function AgendaRow({ event }: { event: ApiEvent }) {
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
        {/* The two things somebody does with an entry, on one row: sign up for
            it, or put it in their own calendar. Both are last because both are
            actions and everything above them is the description of the thing. */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <AddToCalendar event={event} />

          {event.registrationUrl && (
            <a
              href={event.registrationUrl}
              className="text-primary border-primary/40 hover:border-primary border-b pb-0.5 text-xs font-medium transition-colors duration-200"
            >
              Register
            </a>
          )}
        </div>
      </div>
    </article>
  )
}

/** Placeholder rows at the real height, so the footer doesn't jump. Exported
    alongside the row itself — a page drawing one has the other's problem. */
export function AgendaSkeleton() {
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
