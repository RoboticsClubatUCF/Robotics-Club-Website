import type { ApiEvent, ApiMeEvent, EventType } from '../api/api'

/**
 * The bits of an event two pages both need.
 *
 * These lived at the top of `ProjectManagePage.tsx` while it was the only thing that wrote an
 * event. The events desk at `/dashboard/events` is the second, and the house rule is that two users
 * earns `lib/` — a second copy of the type list is a menu that quietly loses an option when
 * somebody adds one to the enum.
 */

/**
 * The event types, in the order the pickers offer them.
 *
 * Not the enum's own order, deliberately. `MEETING` is first because it is what most rows are, and
 * the rest run from the ordinary to the rare — a lead scheduling a weekly session should not have
 * to read past FUNDRAISER to find it.
 */
export const EVENT_TYPES: EventType[] = [
  'MEETING',
  'WORKSHOP',
  'SOCIAL',
  'COMPETITION',
  'OUTREACH',
  'FUNDRAISER',
]

/** ISO out of the API, `yyyy-mm-dd` / `HH:MM` into the form — local time both
    ways, because that is the zone the person typing is thinking in. */
export const toDateInput = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const toTimeInput = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * What an event form's END DATE starts as: blank unless the event ends on another day.
 *
 * Blank means "the day it starts", so moving a one-day event to next week is one field. A
 * prefilled end date would stay behind on the old day and the save would be refused.
 */
export const toEndDateInput = (event: ApiEvent) =>
  event.endsAt && toDateInput(event.endsAt) !== toDateInput(event.startsAt)
    ? toDateInput(event.endsAt)
    : ''

/**
 * The instants an event form sends, from its date and time fields, or the sentence
 * saying what's missing.
 *
 * Built in local time and shipped as an instant: "6:30 in the lab" is campus time, and the
 * calendar converts back on the way in. An all-day event still needs timestamps to sort and
 * range-query on, so it runs from midnight to 23:59 and `allDay` stops anything printing those.
 *
 * The order checks repeat the server's (`checkOrder` in `routes/projects/eventManage.ts`) so the
 * form can say which field to fix.
 */
export function eventInstants(fields: {
  date: string
  start: string
  endDate: string
  end: string
  allDay: boolean
}): { startsAt: string; endsAt: string | null } | { error: string } {
  const lastDay = fields.endDate || fields.date
  // `yyyy-mm-dd` sorts as text.
  if (lastDay < fields.date) {
    return { error: 'The end date is before the start date.' }
  }

  if (fields.allDay) {
    return {
      startsAt: new Date(`${fields.date}T00:00`).toISOString(),
      endsAt: new Date(`${lastDay}T23:59`).toISOString(),
    }
  }

  // Without one the date below is invalid and `toISOString` throws.
  if (!fields.start) {
    return { error: 'Add a start time, or make it all day.' }
  }

  const startsAt = new Date(`${fields.date}T${fields.start}`)

  if (!fields.end) {
    // An end date with no end time has nothing to end at, and 23:59 would be made up.
    return lastDay === fields.date
      ? { startsAt: startsAt.toISOString(), endsAt: null }
      : { error: 'An event ending on another day needs an end time.' }
  }

  const endsAt = new Date(`${lastDay}T${fields.end}`)
  // Only possible on one day, and the usual cause is a late session running past midnight.
  if (endsAt <= startsAt) {
    return {
      error:
        "The end time isn't after the start time. If it runs past midnight, set an end date.",
    }
  }

  return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }
}

/**
 * When an event is, for a manage list's one line: the start, or the whole span when it runs
 * over more than one day. A row reading only "Fri, Sep 20" for a three-day competition looks
 * like the end date didn't save.
 */
export function listedWhen(event: ApiEvent): string {
  const day = { weekday: 'short', month: 'short', day: 'numeric' } as const
  const time = event.allDay ? {} : ({ hour: 'numeric', minute: '2-digit' } as const)
  // Non-breaking inside each end, so a narrow row wraps at the dash rather than mid-date.
  const at = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { ...day, ...time }).replaceAll(' ', '\u00a0')

  return event.endsAt && toDateInput(event.endsAt) !== toDateInput(event.startsAt)
    ? `${at(event.startsAt)} – ${at(event.endsAt)}`
    : at(event.startsAt)
}

/**
 * Whether this row is a generated project meeting rather than a stored event.
 *
 * The `meeting:` prefix is the server's marker. It matters on any page with an edit button: a
 * meeting has no row behind it, so `PATCH /events/meeting:…` is a 404 and the button is a lie. The
 * schedule is edited on the project, not here.
 */
export const isGeneratedMeeting = (event: ApiEvent | ApiMeEvent) =>
  event.id.startsWith('meeting:')

/**
 * Whether this row is a task deadline rather than an event at all.
 *
 * The calendar's second generated entry, same reasoning as the meeting above: there is no `Event`
 * row behind one, so nothing may offer to edit or delete it — the task is edited on the tasks page.
 * `task:` is the server's marker, written in `routes/member/me.ts` beside the `meeting:` one.
 *
 * These reach exactly one calendar: the assignee's own, and only once they have asked for it.
 * Nothing on the public site can be one.
 */
export const isTaskEntry = (event: ApiEvent | ApiMeEvent) =>
  event.id.startsWith('task:')
