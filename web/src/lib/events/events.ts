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
