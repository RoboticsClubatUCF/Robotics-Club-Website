import { useCallback, useEffect, useId, useState } from 'react'
import { useOutletContext } from 'react-router'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { DuesLocked } from '../../components/dashboard/DuesLocked'
import { GoogleCalendarPanel } from '../../components/dashboard/GoogleCalendarPanel'
import { ConfirmDialog } from '../../components/shared/ConfirmDialog'
import { EventCalendarCheckbox } from '../../components/shared/EventCalendarCheckbox'
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
  eventInstants,
  isGeneratedMeeting,
  listedWhen,
  toDateInput,
  toEndDateInput,
  toTimeInput,
} from '../../lib/events/events'
import { useApi } from '../../lib/api/useApi'
import { isOfficer } from '../../lib/auth/session'

/**
 * The events desk: everything on the calendar that this person may change.
 *
 * Not an officer desk, and that's the point. Every other page under `/ MANAGE` is board
 * business, so they live under `/dashboard/officer/…` and refuse anybody else. This one is
 * open to project leads as well, because scheduling a design review isn't a decision about
 * the club — it's a decision about a build, and the person running it knows when it is.
 * `requireEventManager` has always granted exactly that. Hence `/dashboard/events`: putting
 * `officer` in a URL that leads open would be a lie in the address bar.
 *
 * What separates the two audiences isn't what they may do but what they may reach. A lead
 * sees their own projects in the picker; an officer additionally gets Club-wide. Both can
 * opt events they lead into the main calendar. The server re-checks the event's scope.
 *
 * The project meetings that fill the calendars are deliberately not editable here. They
 * aren't rows — `server/src/projects/meetings.ts` generates them from three columns — so an
 * EDIT button on one would PATCH an id that doesn't exist.
 */
export function EventsManagePage() {
  const { user, membership, projects } = useOutletContext<DashboardContext>()

  // Dues before authority, the same order every other desk uses: a lapsed lead is a lead,
  // and the sentence they need is about a payment.
  if (duesLocked(membership, user.role)) {
    return <DuesLocked eyebrow="/ MANAGE · EVENTS" />
  }

  const officer = isOfficer(user.role)
  const mine = projects.status === 'ready' ? projects.data : []
  // Read off the membership rows rather than `user.role`, which says nothing about any
  // project — the rule this codebase states most often.
  const leads = mine.filter(({ rank }) => rank !== 'MEMBER')

  // Nothing until the memberships land, rather than a refusal that would flash at a lead on
  // every page load. The same reasoning the rail's locks use.
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
  const [until, setUntil] = useState('')
  const [saves, setSaves] = useState(0)

  /**
   * This term, for the one warning this page gives.
   *
   * `useApi` rather than a loader: nothing here writes it, so the hook's lack of a refetch
   * costs nothing. The year is today's because the warning is about something being
   * scheduled now.
   */
  const terms = useApi<ApiSemesterTerm[]>(
    `/officer/semesters/${String(new Date().getFullYear())}`,
  )

  /**
   * Its own loader rather than `useApi`, which has no refetch: every write on this page
   * changes the list it's written into.
   *
   * Read from `/me/events`, which already answers with everything an officer may see and
   * everything a lead's projects carry. A dedicated officer route would be a fourth way to
   * ask the same question.
   */
  const reload = useCallback(async () => {
    setEvents(null)
    try {
      const all = await getJson<ApiMeEvent[]>(
        `/me/events?from=${encodeURIComponent(new Date().toISOString())}&limit=200`,
      )
      // Generated meetings have no row behind them — see the header.
      const rows = all.filter((event) => !isGeneratedMeeting(event))
      setEvents(rows)
      // An import or a disconnect can change the event being edited, its lock included.
      setEditing((current) =>
        current ? (rows.find((row) => row.id === current.id) ?? current) : null,
      )
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
   * The same matrix `requireEventManager` applies, so the buttons match what the server will
   * allow: officers everywhere, creators on their own, and a lead on anything hanging off a
   * project they lead.
   */
  const leadsEvent = (event: ApiMeEvent) =>
    leads.some(({ project, rank, team }) => {
      if (project.id !== event.projectId) return false
      return rank === 'PROJECT_LEAD' || (event.teamId !== null && team?.id === event.teamId)
    })

  const canTouch = (event: ApiMeEvent) =>
    officer || event.createdById === user.id || leadsEvent(event)
  const canPublish = !editing || officer || leadsEvent(editing)
  // Google owns these fields on an imported event; the server refuses changes to them.
  const locked = Boolean(editing?.googleId)
  // DaisyUI's disabled input looks like an empty enabled one, so a locked field says so itself.
  const lockedClass = (base: string) =>
    locked
      ? `${base} disabled:border-dashed disabled:bg-transparent disabled:text-dim`
      : base

  const mineToEdit = (events ?? []).filter(canTouch)

  /** Finals week, when any day the event covers falls in one. */
  const finalsWarning = (() => {
    if (locked || !when || terms.status !== 'ready') return null

    const from = new Date(`${when}T12:00`).getTime()
    const to = until > when ? new Date(`${until}T12:00`).getTime() : from
    const term = terms.data.find(
      (row) =>
        row.finalsStartAt !== null &&
        row.finalsEndAt !== null &&
        to >= new Date(row.finalsStartAt).getTime() &&
        from <= new Date(row.finalsEndAt).getTime(),
    )
    if (!term) return null

    return `${to > from ? 'Those dates run into' : 'That date is in'} finals week. Projects are on halt — their weekly meetings stop — but this event will still be created.`
  })()

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    // Narrowed rather than coerced: `FormData.get` can hand back a `File`, and `String()` on
    // one is the literal text '[object File]' going into the row.
    const text = (name: string) => {
      const raw = data.get(name)
      return typeof raw === 'string' ? raw.trim() : ''
    }

    if (editing && locked) {
      const body = {
        type: text('type') as EventType,
        registrationUrl: text('registrationUrl') || null,
        ...(canPublish ? { published: data.get('published') === 'on' } : {}),
      }
      run(async () => {
        await patchJson(`/events/${editing.id}`, body)
        setEditing(null)
        setSaves((count) => count + 1)
        setWhen('')
        setUntil('')
        setMessage({ tone: 'success', text: 'Saved.' })
        await reload()
      })
      return
    }

    const allDay = data.get('allDay') === 'on'
    const instants = eventInstants({
      date: text('date'),
      start: text('start'),
      endDate: text('endDate'),
      end: text('end'),
      allDay,
    })
    if ('error' in instants) {
      setMessage({ tone: 'error', text: instants.error })
      return
    }

    const body = {
      title: text('title'),
      description: text('description') || null,
      type: text('type') as EventType,
      location: text('location') || null,
      registrationUrl: text('registrationUrl') || null,
      ...instants,
      allDay,
      ...(canPublish ? { published: data.get('published') === 'on' } : {}),
    }

    run(async () => {
      if (editing) {
        await patchJson(`/events/${editing.id}`, body)
        setEditing(null)
      } else {
        const project = text('project')
        // A team lead's membership is the scope. There is no team picker on
        // this desk, so omitting this would attempt a project-wide event.
        const selected = leads.find((row) => row.project.id === project)
        const team = !officer && selected?.rank === 'TEAM_LEAD' ? selected.team?.id : null
        await postJson('/events', {
          ...body,
          // Absent, not null: an omitted `projectId` is what the route reads as club
          // business, and only an officer gets that option in the picker.
          ...(project === CLUB_WIDE ? {} : { projectId: project }),
          ...(team ? { teamId: team } : {}),
        })
      }
      // A fresh form rather than `form.reset()`, which clears the fields behind React's back:
      // typing the same date again then fires no onChange and `when` stays empty.
      setSaves((count) => count + 1)
      setWhen('')
      setUntil('')
      setMessage({ tone: 'success', text: 'Saved.' })
      await reload()
    })
  }

  const remove = (event: ApiMeEvent) =>
    run(async () => {
      await deleteJson(`/events/${event.id}`)
      if (editing?.id === event.id) {
        setEditing(null)
        setWhen('')
        setUntil('')
      }
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

      {/* The calendar on one side and the form on the other, wherever there's room for both.
          Editing is what makes it worth the split: EDIT fills this form from a row in that
          list, and stacked they're far enough apart that pressing it looks like nothing
          happened. `items-start` keeps the form at the top of its column. */}
      <div className="grid-fluid items-start gap-5 [--col-min:30rem]">
        {(events === null || failed || mineToEdit.length > 0) && (
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
                        {listedWhen(event)}
                        {' · '}
                        {whereItHangs(event)}
                        {/* On this line rather than beside the title, which truncates on a phone. */}
                        {event.googleId && ' · GOOGLE'}
                      </p>
                    </div>

                    {/* One group, so a row wraps EDIT and DELETE together and EDIT lines up
                        whether or not DELETE is there. */}
                    <div className="flex gap-4">
                      <button
                        type="button"
                        disabled={busy}
                        className={smallButton}
                        onClick={() => {
                          setEditing(event)
                          setMessage(null)
                          setWhen(toDateInput(event.startsAt))
                          setUntil(toEndDateInput(event))
                        }}
                      >
                        EDIT
                      </button>
                      {/* The next sync would bring it back; it's deleted in Google. */}
                      {event.googleId ? (
                        <span aria-hidden="true" className={`${dangerButton} invisible`}>
                          DELETE
                        </span>
                      ) : (
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
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </FormPanel>

        )}
        <FormPanel>
          {/* `key` swaps the form wholesale between "new" and "editing", which is what lets
              the uncontrolled inputs pick up an event's values as their defaults. */}
          <form
            key={editing?.id ?? `new-${String(saves)}`}
            onSubmit={submit}
            // A refusal is about what was typed, so it goes once the typing changes.
            onChange={() => {
              if (message?.tone === 'error') setMessage(null)
            }}
            className="space-y-4"
            aria-describedby={locked ? `${id}-locked` : undefined}
          >
            <p className={panelLabel}>
              {editing ? `EDITING — ${editing.title.toUpperCase()}` : 'NEW EVENT'}
            </p>

            {locked && (
              <p id={`${id}-locked`} className="text-dim text-[13px] leading-[1.5] text-pretty">
                From Google Calendar. Change the title, time, place and detail there.
              </p>
            )}

            {/* Where it hangs is fixed once it exists — moving an event between projects is
                deleting and recreating it, which keeps the permission question
                one-dimensional on the server. */}
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
                    {leads.map(({ project, rank, team }) => (
                      <option key={project.id} value={project.id}>
                        {project.title}{!officer && rank === 'TEAM_LEAD' && team ? ` — ${team.name}` : ''}
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
                className={lockedClass(fieldClass)}
                disabled={busy || locked}
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

            {/* Start and end on rows of their own, so the order holds on a phone where each
                field takes a line. Widths go on the wrappers because `fieldClass` carries
                `w-full`, which beat them on the inputs and clipped the time behind its clock
                icon. */}
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-4">
                <div className="w-44">
                  <label htmlFor={`${id}-date`} className={labelClass}>
                    START DATE
                  </label>
                  <input
                    id={`${id}-date`}
                    name="date"
                    type="date"
                    required
                    defaultValue={editing ? toDateInput(editing.startsAt) : ''}
                    className={lockedClass(fieldClass)}
                    disabled={busy || locked}
                    onChange={(change) => {
                      setWhen(change.target.value)
                    }}
                  />
                </div>
                <div className="w-36">
                  <label htmlFor={`${id}-start`} className={labelClass}>
                    START TIME
                  </label>
                  <input
                    id={`${id}-start`}
                    name="start"
                    type="time"
                    defaultValue={editing ? toTimeInput(editing.startsAt) : ''}
                    className={lockedClass(fieldClass)}
                    disabled={busy || locked}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-4">
                <div className="w-44">
                  <label htmlFor={`${id}-end-date`} className={labelClass}>
                    END DATE
                  </label>
                  <input
                    id={`${id}-end-date`}
                    name="endDate"
                    type="date"
                    defaultValue={editing ? toEndDateInput(editing) : ''}
                    aria-describedby={locked ? undefined : `${id}-end-date-hint`}
                    className={lockedClass(fieldClass)}
                    disabled={busy || locked}
                    onChange={(change) => {
                      setUntil(change.target.value)
                    }}
                  />
                </div>
                <div className="w-36">
                  <label htmlFor={`${id}-end`} className={labelClass}>
                    END TIME
                  </label>
                  <input
                    id={`${id}-end`}
                    name="end"
                    type="time"
                    defaultValue={
                      editing?.endsAt ? toTimeInput(editing.endsAt) : ''
                    }
                    className={lockedClass(fieldClass)}
                    disabled={busy || locked}
                  />
                </div>
              </div>

              {!locked && (
                <p
                  id={`${id}-end-date-hint`}
                  className="text-faint text-[12px] leading-[1.5]"
                >
                  Leave the end date empty for a one-day event.
                </p>
              )}
            </div>

            <label
              className={`flex items-center gap-2.5 ${locked ? '' : 'cursor-pointer'}`}
            >
              <input
                type="checkbox"
                name="allDay"
                defaultChecked={editing?.allDay ?? false}
                disabled={busy || locked}
                className="checkbox checkbox-sm border-rule"
              />
              <span className={`${locked ? 'text-faint' : 'text-dim'} text-[13px]`}>
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
                  className={lockedClass(fieldClass)}
                  disabled={busy || locked}
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
                className={lockedClass(`${fieldClass} h-auto py-2 leading-[1.6]`)}
                disabled={busy || locked}
              />
            </div>

            {canPublish && (
              <EventCalendarCheckbox published={editing?.published} disabled={busy} />
            )}

            {/* Advisory, not a refusal. The halt is about the weekly meetings the site
                generates; a competition that genuinely falls in finals week is the club's
                business, and refusing it would be the page overruling the person who knows. */}
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
                    setMessage(null)
                    setWhen('')
                    setUntil('')
                  }}
                >
                  STOP EDITING
                </button>
              )}
            </div>
          </form>

          {message && (
            <p role="status" className="mt-4 text-[13px]">
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
          )}
        </FormPanel>

        {officer && <GoogleCalendarPanel onImported={reload} />}
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
