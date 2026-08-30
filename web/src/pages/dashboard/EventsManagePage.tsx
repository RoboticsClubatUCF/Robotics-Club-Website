import { useCallback, useEffect, useId, useState } from 'react'
import { useOutletContext } from 'react-router'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { DuesLocked } from '../../components/dashboard/DuesLocked'
import { ConfirmDialog } from '../../components/shared/ConfirmDialog'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  fieldClass,
  labelClass,
  measureClass,
} from '../../components/shared/formChrome'
import { deleteJson, getJson, patchJson, postJson } from '../../lib/api/api'
import type {
  ApiMeEvent,
  ApiMyProject,
  ApiSemesterTerm,
  ApiUser,
  EventType,
} from '../../lib/api/api'
import { explainApiError } from '../../lib/api/apiErrors'
import { duesLocked } from '../../lib/dues/dues'
import {
  EVENT_TYPES,
  isGeneratedMeeting,
  toDateInput,
  toTimeInput,
} from '../../lib/events/events'
import { useApi } from '../../lib/api/useApi'
import { isOfficer } from '../../lib/auth/session'

/**
 * The events desk: everything on the calendar that this person may change.
 *
 * **Not an officer desk, and that is the point.** Every other page under
 * `/ MANAGE` is board business, so they all live under `/dashboard/officer/…`
 * and refuse anybody else. This one is open to project leads as well, because
 * scheduling a design review is not a decision about the club — it is a
 * decision about a build, and the person running the build is the one who knows
 * when it is. `requireEventManager` on the server has always granted exactly
 * that; there was simply no page that used it. Hence `/dashboard/events` rather
 * than `/dashboard/officer/events`: putting `officer` in a URL that leads open
 * would be a lie in the address bar.
 *
 * What separates the two audiences is not what they may do but what they may
 * reach. A lead sees their own projects in the picker; an officer additionally
 * gets *Club-wide*, which is the row with no project behind it, and the
 * PUBLISHED switch, which is the public calendar. The server re-checks both.
 *
 * The project **meetings** that now fill the calendars are deliberately not
 * editable here. They are not rows — `server/src/projects/meetings.ts` generates them
 * from three columns on the project — so an EDIT button on one would PATCH an
 * id that does not exist. They are filtered out, and the empty-state copy says
 * where the schedule actually lives.
 */
export function EventsManagePage() {
  const { user, membership, projects } = useOutletContext<DashboardContext>()

  // Dues before authority, the same order every other desk uses: a lapsed lead
  // is a lead, and the sentence they need is about a payment.
  if (duesLocked(membership, user.role)) {
    return <DuesLocked eyebrow="/ MANAGE · EVENTS" />
  }

  const officer = isOfficer(user.role)
  const mine = projects.status === 'ready' ? projects.data : []
  // Read off the membership rows rather than off `user.role`, which says
  // nothing about any project — the rule this codebase states most often.
  const leads = mine.filter(({ rank }) => rank !== 'MEMBER')

  // Nothing until the memberships land, rather than a refusal that would flash
  // at a lead on every page load. The same reasoning the rail's locks use.
  if (!officer && projects.status !== 'ready') {
    return <div aria-busy="true" className="border-rule bg-base-200 h-64 border" />
  }

  if (!officer && leads.length === 0) {
    return (
      <>
        <FormEyebrow>/ MANAGE · EVENTS</FormEyebrow>
        <FormHeading>This desk is for people running something.</FormHeading>
        <div className={measureClass}>
          <FormPanel>
            <p className="text-dim text-sm leading-[1.7] text-pretty">
              Project leads and team leads schedule their own project&rsquo;s
              events here, and officers schedule the club&rsquo;s. Everything on
              the calendar is on your dashboard either way.
            </p>
          </FormPanel>
        </div>
      </>
    )
  }

  return <Events user={user} officer={officer} leads={leads} />
}

const panelLabel =
  'text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]'
const primaryButton =
  'btn btn-primary btn-cta px-5 py-2.5 text-[12px] font-semibold disabled:opacity-60'
const smallButton =
  'text-faint hover:text-primary cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50'
const dangerButton =
  'text-faint hover:text-error cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50'
const selectClass = 'select border-rule bg-base-200 w-full text-sm'

type Message = { tone: 'error' | 'success'; text: string } | null

/** The value the project picker uses for "no project at all". */
const CLUB_WIDE = ''

function Events({
  user,
  officer,
  leads,
}: {
  user: ApiUser
  officer: boolean
  leads: ApiMyProject[]
}) {
  const id = useId()
  const [events, setEvents] = useState<ApiMeEvent[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState<ApiMeEvent | null>(null)
  const [deleting, setDeleting] = useState<ApiMeEvent | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message>(null)
  const [when, setWhen] = useState('')

  /**
   * This term, for the one warning this page gives.
   *
   * `useApi` rather than a loader: nothing on this page writes it, so the
   * hook's lack of a refetch costs nothing. The year is today's because the
   * warning is about something being scheduled now.
   */
  const terms = useApi<ApiSemesterTerm[]>(
    `/officer/semesters/${String(new Date().getFullYear())}`,
  )

  /**
   * Its own loader rather than `useApi`, which has no refetch: every write on
   * this page changes the list it is written into.
   *
   * Read from `/me/events`, which already answers with everything an officer
   * may see and everything a lead's projects carry — the same endpoint the
   * dashboard calendar uses. A dedicated officer route would be a fourth way to
   * ask the same question.
   */
  const reload = useCallback(async () => {
    setEvents(null)
    try {
      const all = await getJson<ApiMeEvent[]>(
        `/me/events?from=${encodeURIComponent(new Date().toISOString())}&limit=200`,
      )
      // Generated meetings have no row behind them — see the header.
      setEvents(all.filter((event) => !isGeneratedMeeting(event)))
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const explain = (error: unknown) =>
    explainApiError(error, {
      forbidden: 'The server does not agree you can change that event.',
    })

  const run = (action: () => Promise<void>) => {
    setBusy(true)
    setMessage(null)
    action()
      .catch((error: unknown) => {
        setMessage({ tone: 'error', text: explain(error) })
      })
      .finally(() => {
        setBusy(false)
      })
  }

  /**
   * The same matrix `requireEventManager` applies, so the buttons match what
   * the server will actually allow: officers everywhere, creators on their own,
   * and a lead on anything hanging off a project they lead.
   */
  const canTouch = (event: ApiMeEvent) =>
    officer ||
    event.createdById === user.id ||
    leads.some(({ project, rank }) => {
      if (project.id !== event.projectId) return false
      return rank === 'PROJECT_LEAD' || event.teamId !== null
    })

  const mineToEdit = (events ?? []).filter(canTouch)

  /** Finals week for the term the chosen date falls in, when one is set. */
  const finalsWarning = (() => {
    if (!when || terms.status !== 'ready') return null

    const at = new Date(`${when}T12:00`).getTime()
    const term = terms.data.find(
      (row) =>
        row.finalsStartAt !== null &&
        row.finalsEndAt !== null &&
        at >= new Date(row.finalsStartAt).getTime() &&
        at <= new Date(row.finalsEndAt).getTime(),
    )
    if (!term) return null

    return `That date is in finals week. Projects are on halt — their weekly meetings stop — but this event will still be created.`
  })()

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    // Narrowed rather than coerced: `FormData.get` can hand back a `File`, and
    // `String()` on one is the literal text '[object File]' going into the row.
    const text = (name: string) => {
      const raw = data.get(name)
      return typeof raw === 'string' ? raw.trim() : ''
    }

    const date = text('date')
    const start = text('start')
    const end = text('end')
    const allDay = data.get('allDay') === 'on'

    const body = {
      title: text('title'),
      description: text('description') || null,
      type: text('type') as EventType,
      location: text('location') || null,
      registrationUrl: text('registrationUrl') || null,
      // Built in local time and shipped as an instant — "6:30 in the lab" is
      // campus time, and the calendar converts back on the way in. An all-day
      // event still needs a timestamp to sort and range-query on, so it gets
      // midnight and the flag is what stops anything printing that as a time.
      startsAt: new Date(`${date}T${allDay ? '00:00' : start}`).toISOString(),
      endsAt: allDay
        ? new Date(`${date}T23:59`).toISOString()
        : end
          ? new Date(`${date}T${end}`).toISOString()
          : null,
      allDay,
      // Only officers may send this at all; the checkbox is not drawn for
      // anybody else, and the server refuses it from them regardless.
      ...(officer ? { published: data.get('published') === 'on' } : {}),
    }

    run(async () => {
      if (editing) {
        await patchJson(`/events/${editing.id}`, body)
        setEditing(null)
      } else {
        const project = text('project')
        const team = text('team')
        await postJson('/events', {
          ...body,
          // Absent, not null: an omitted `projectId` is what the route reads as
          // club business, and only an officer gets that option in the picker.
          ...(project === CLUB_WIDE ? {} : { projectId: project }),
          ...(team ? { teamId: team } : {}),
        })
      }
      form.reset()
      setWhen('')
      setMessage({ tone: 'success', text: 'Saved.' })
      await reload()
    })
  }

  const remove = (event: ApiMeEvent) =>
    run(async () => {
      await deleteJson(`/events/${event.id}`)
      if (editing?.id === event.id) setEditing(null)
      setDeleting(null)
      setMessage({ tone: 'success', text: `"${event.title}" is off the calendar.` })
      await reload()
    })

  const whereItHangs = (event: ApiMeEvent) =>
    event.project
      ? event.team
        ? `${event.project.title} · ${event.team.name}`
        : event.project.title
      : 'Club-wide'

  return (
    <>
      <FormEyebrow>/ MANAGE · EVENTS</FormEyebrow>
      <FormHeading>Events</FormHeading>

      {/* The calendar on one side and the form on the other, wherever there is
          room for both. Editing is what makes it worth the split: EDIT fills
          this form from a row in that list, and stacked they are far enough
          apart that pressing it looks like nothing happened. `items-start`
          keeps the form at the top of its column instead of being stretched
          down the height of a long calendar. */}
      <div className="grid-fluid items-start gap-5 [--col-min:30rem]">
        <FormPanel>
          <p className={panelLabel}>ON THE CALENDAR</p>

          {events === null && !failed && (
            <div aria-busy="true" className="space-y-2.5">
              {Array.from({ length: 3 }, (_, index) => (
                <div
                  key={index}
                  className="bg-base-300 h-12 w-full animate-pulse rounded-[2px]"
                />
              ))}
            </div>
          )}

          {failed && (
            <p className="text-dim text-sm leading-[1.7]">
              We couldn&rsquo;t load the calendar just now. Try again in a
              moment.
            </p>
          )}

          {events !== null && mineToEdit.length === 0 && (
            <p className="text-dim text-sm leading-[1.7] text-pretty">
              Nothing scheduled that you can change. A project&rsquo;s weekly
              meeting is not listed here — it is set on the project&rsquo;s own
              manage page and repeats on its own.
            </p>
          )}

          {events !== null && mineToEdit.length > 0 && (
            <ul className="border-rule divide-y divide-[var(--color-rule)] border-y">
              {mineToEdit.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3"
                >
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="truncate text-sm font-medium">
                      {event.title}
                      {!event.published && (
                        <span className="text-faint ml-2 font-mono text-[9px] tracking-[0.14em]">
                          NOT PUBLIC
                        </span>
                      )}
                    </p>
                    <p className="text-faint font-mono text-[10px] font-medium tracking-[0.1em]">
                      {new Date(event.startsAt).toLocaleString(undefined, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        ...(event.allDay
                          ? {}
                          : { hour: 'numeric', minute: '2-digit' }),
                      })}
                      {' · '}
                      {whereItHangs(event)}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={busy}
                    className={smallButton}
                    onClick={() => {
                      setEditing(event)
                      setWhen(toDateInput(event.startsAt))
                    }}
                  >
                    EDIT
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className={dangerButton}
                    onClick={() => {
                      setDeleting(event)
                    }}
                  >
                    DELETE
                  </button>
                </li>
              ))}
            </ul>
          )}
        </FormPanel>

        <FormPanel>
          {/* `key` swaps the form wholesale between "new" and "editing", which
              is what lets the uncontrolled inputs pick up an event's values as
              their defaults. */}
          <form key={editing?.id ?? 'new'} onSubmit={submit} className="space-y-4">
            <p className={panelLabel}>
              {editing ? `EDITING — ${editing.title.toUpperCase()}` : 'NEW EVENT'}
            </p>

            {/* Where it hangs is fixed once it exists — moving an event between
                projects is deleting and recreating it, which is what keeps the
                permission question one-dimensional on the server. */}
            {!editing && (
              <div className="grid-fluid gap-4 [--col-min:14rem]">
                <div>
                  <label htmlFor={`${id}-project`} className={labelClass}>
                    PROJECT
                  </label>
                  <select
                    id={`${id}-project`}
                    name="project"
                    className={selectClass}
                    disabled={busy}
                    defaultValue={officer ? CLUB_WIDE : (leads[0]?.project.id ?? '')}
                  >
                    {officer && (
                      <option value={CLUB_WIDE}>Club-wide — no project</option>
                    )}
                    {leads.map(({ project }) => (
                      <option key={project.id} value={project.id}>
                        {project.title}
                      </option>
                    ))}
                  </select>
                  {officer && leads.length === 0 && (
                    <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
                      You lead no projects, so this is the club&rsquo;s calendar.
                      A project&rsquo;s own events are made on its manage page.
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor={`${id}-type`} className={labelClass}>
                    TYPE
                  </label>
                  <select
                    id={`${id}-type`}
                    name="type"
                    className={selectClass}
                    disabled={busy}
                    defaultValue="MEETING"
                  >
                    {EVENT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div>
              <label htmlFor={`${id}-title`} className={labelClass}>
                TITLE
              </label>
              <input
                id={`${id}-title`}
                name="title"
                required
                maxLength={160}
                placeholder="Design review"
                defaultValue={editing?.title ?? ''}
                className={fieldClass}
                disabled={busy}
              />
            </div>

            {editing && (
              <div>
                <label htmlFor={`${id}-type-edit`} className={labelClass}>
                  TYPE
                </label>
                <select
                  id={`${id}-type-edit`}
                  name="type"
                  className={selectClass}
                  disabled={busy}
                  defaultValue={editing.type}
                >
                  {EVENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label htmlFor={`${id}-date`} className={labelClass}>
                  DATE
                </label>
                <input
                  id={`${id}-date`}
                  name="date"
                  type="date"
                  required
                  defaultValue={editing ? toDateInput(editing.startsAt) : ''}
                  className={`${fieldClass} w-44`}
                  disabled={busy}
                  onChange={(change) => {
                    setWhen(change.target.value)
                  }}
                />
              </div>
              <div>
                <label htmlFor={`${id}-start`} className={labelClass}>
                  FROM
                </label>
                <input
                  id={`${id}-start`}
                  name="start"
                  type="time"
                  defaultValue={editing ? toTimeInput(editing.startsAt) : ''}
                  className={`${fieldClass} w-36`}
                  disabled={busy}
                />
              </div>
              <div>
                <label htmlFor={`${id}-end`} className={labelClass}>
                  TO
                </label>
                <input
                  id={`${id}-end`}
                  name="end"
                  type="time"
                  defaultValue={
                    editing?.endsAt ? toTimeInput(editing.endsAt) : ''
                  }
                  className={`${fieldClass} w-36`}
                  disabled={busy}
                />
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                name="allDay"
                defaultChecked={editing?.allDay ?? false}
                disabled={busy}
                className="checkbox checkbox-sm border-rule"
              />
              <span className="text-dim text-[13px]">
                All day — ignore the times above
              </span>
            </label>

            <div className="grid-fluid gap-4 [--col-min:14rem]">
              <div>
                <label htmlFor={`${id}-location`} className={labelClass}>
                  WHERE
                </label>
                <input
                  id={`${id}-location`}
                  name="location"
                  maxLength={160}
                  placeholder="ENG2 Lab"
                  defaultValue={editing?.location ?? ''}
                  className={fieldClass}
                  disabled={busy}
                />
              </div>
              <div>
                <label htmlFor={`${id}-registration`} className={labelClass}>
                  SIGN-UP LINK
                </label>
                <input
                  id={`${id}-registration`}
                  name="registrationUrl"
                  type="url"
                  maxLength={500}
                  placeholder="https://…"
                  defaultValue={editing?.registrationUrl ?? ''}
                  className={fieldClass}
                  disabled={busy}
                />
              </div>
            </div>

            <div>
              <label htmlFor={`${id}-description`} className={labelClass}>
                DETAIL
              </label>
              <textarea
                id={`${id}-description`}
                name="description"
                rows={3}
                maxLength={5000}
                defaultValue={editing?.description ?? ''}
                className={`${fieldClass} h-auto py-2 leading-[1.6]`}
                disabled={busy}
              />
            </div>

            {/* The public calendar is officers'. A lead's events are real and
                reach every member of their project; they simply do not go on
                the front page. The server refuses this field from anyone else,
                so its absence here is layout rather than the rule. */}
            {officer && (
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  name="published"
                  defaultChecked={editing?.published ?? false}
                  disabled={busy}
                  className="checkbox checkbox-sm border-rule mt-0.5"
                />
                <span className="text-dim text-[13px] leading-[1.5] text-pretty">
                  Show on the public calendar
                  <span className="text-faint block text-[12px]">
                    Off keeps it to members&rsquo; dashboards.
                  </span>
                </span>
              </label>
            )}

            {/* Advisory, not a refusal. The halt is about the weekly meetings
                the site generates; a competition that genuinely falls in finals
                week is the club's business, not the site's, and refusing it
                would be the page overruling the person who knows. */}
            {finalsWarning && (
              <p className="text-warning text-[13px] leading-[1.5] text-pretty">
                {finalsWarning}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className={primaryButton} disabled={busy}>
                {busy ? 'SAVING…' : editing ? 'SAVE CHANGES' : 'CREATE EVENT'}
              </button>

              {editing && (
                <button
                  type="button"
                  className={smallButton}
                  disabled={busy}
                  onClick={() => {
                    setEditing(null)
                    setWhen('')
                  }}
                >
                  STOP EDITING
                </button>
              )}
            </div>
          </form>

          <p role="status" className="mt-4 min-h-4 text-[13px]">
            {message && (
              <span
                className={
                  message.tone === 'error' ? 'text-error' : 'text-success'
                }
              >
                {message.text}
              </span>
            )}
          </p>
        </FormPanel>
      </div>

      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.title}"?`}
          confirmLabel="DELETE IT"
          busy={busy}
          onConfirm={() => {
            remove(deleting)
          }}
          onDismiss={() => {
            setDeleting(null)
          }}
        >
          <p>
            It comes off every calendar it is on, including the public one if it
            was there. Nothing else changes.
          </p>
        </ConfirmDialog>
      )}
    </>
  )
}
