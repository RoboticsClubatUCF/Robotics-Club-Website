import { useCallback, useEffect, useId, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router'
import { DuesLocked } from '../components/dashboard/DuesLocked'
import { duesLocked } from '../lib/dues'
import type { DashboardContext } from '../components/dashboard/DashboardLayout'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  fieldClass,
  labelClass,
} from '../components/shared/formChrome'
import {
  ApiError,
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from '../lib/api'
import type {
  ApiMeEvent,
  ApiProjectDetail,
  ApiProjectTeamMember,
  ApiProjectTeamView,
  ApiTask,
  EventType,
  ProjectMemberRank,
} from '../lib/api'
import { WEEKDAY_NAMES } from '../lib/meetings'
import type { ApiState } from '../lib/useApi'
import { useApi } from '../lib/useApi'

/**
 * The lead's side of a project: members, teams, and the meeting schedule.
 *
 * Which controls appear follows the caller's rank on *this* project — a team
 * lead gets exactly their own team's roster, a project lead gets everything —
 * but appearance is all it is. Every button lands on a server route that
 * re-checks the same rank, so hiding here is layout, not security.
 *
 * Officers see the project-lead view of any project. They resolve the slug
 * through the public detail route because nothing guarantees they are on the
 * project's member list at all.
 */

const smallButton =
  'text-faint hover:text-primary cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50'

const dangerButton =
  'text-faint hover:text-error cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50'

const selectClass = 'select border-rule bg-base-200 h-8 min-h-0 text-[12px]'

function explain(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return "We couldn't reach the server. Try again in a moment."
    if (error.status === 429) return 'Too many changes at once — give it a minute.'
    if (error.detail) return error.detail
  }
  return 'That change did not go through. Try again in a moment.'
}

export function ProjectManagePage() {
  const { slug = '' } = useParams()
  const { user, projects, membership } = useOutletContext<DashboardContext>()
  const officer = user.role === 'ADMIN' || user.role === 'OFFICER'

  // Ahead of the rank check: somebody who lost their tools to a lapsed payment
  // has *not* lost their rank, and telling them this page belongs to the leads
  // would be false as well as alarming.
  if (duesLocked(membership, user.role)) {
    return <DuesLocked eyebrow="/ PROJECT · MANAGE" />
  }

  if (projects.status === 'loading') {
    return (
      <div aria-busy="true">
        <div className="bg-base-300 h-3 w-24 animate-pulse rounded-[2px]" />
        <div className="bg-base-300 mt-6 h-9 w-72 max-w-full animate-pulse rounded-[2px]" />
      </div>
    )
  }

  if (projects.status === 'error') {
    return (
      <FormPanel tone="accent">
        <p className="text-dim text-sm leading-[1.7]">
          We couldn't load your projects just now. Try again in a moment.
        </p>
      </FormPanel>
    )
  }

  const mine = projects.data.find((m) => m.project.slug === slug)
  const rank: ProjectMemberRank | null = officer
    ? 'PROJECT_LEAD'
    : (mine?.rank ?? null)

  if (!rank || rank === 'MEMBER') {
    return (
      <>
        <FormEyebrow>/ PROJECT · MANAGE</FormEyebrow>
        <FormHeading>This page belongs to the leads.</FormHeading>
        <FormPanel>
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            Managing a project is for its project lead and team leads. If that
            should be you, ask your project lead — or an officer — to set your
            rank.
          </p>
        </FormPanel>
      </>
    )
  }

  if (mine) {
    return (
      <Manage
        projectId={mine.project.id}
        rank={rank}
        myTeamId={mine.team?.id ?? null}
      />
    )
  }

  // An officer with no membership row: find the id the long way round.
  return <ResolveBySlug slug={slug} />
}

function ResolveBySlug({ slug }: { slug: string }) {
  const detail = useApi<ApiProjectDetail>(`/projects/${slug}`)

  if (detail.status === 'loading') {
    return <div aria-busy="true" className="border-rule bg-base-200 h-40 border" />
  }

  if (detail.status === 'error') {
    return (
      <FormPanel tone="accent">
        <p className="text-dim text-sm leading-[1.7]">
          {detail.code === 404
            ? 'There is no project at this address.'
            : "We couldn't load the project just now."}
        </p>
      </FormPanel>
    )
  }

  return <Manage projectId={detail.data.id} rank="PROJECT_LEAD" myTeamId={null} />
}

function Manage({
  projectId,
  rank,
  myTeamId,
}: {
  projectId: string
  rank: 'PROJECT_LEAD' | 'TEAM_LEAD'
  myTeamId: string | null
}) {
  const { reloadProjects } = useOutletContext<DashboardContext>()
  const [view, setView] = useState<ApiState<ApiProjectTeamView>>({
    status: 'loading',
  })

  const load = useCallback(async () => {
    try {
      const data = await getJson<ApiProjectTeamView>(`/projects/${projectId}/team`)
      setView({ status: 'ready', data })
    } catch (error) {
      console.error(error)
      setView({
        status: 'error',
        code: error instanceof ApiError ? error.status : 0,
      })
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  if (view.status === 'loading') {
    return <div aria-busy="true" className="border-rule bg-base-200 h-64 border" />
  }

  if (view.status === 'error') {
    return (
      <FormPanel tone="accent">
        <p className="text-dim text-sm leading-[1.7]">
          {view.code === 403
            ? 'The server does not agree you can manage this project.'
            : "We couldn't load the project just now. Try again in a moment."}
        </p>
      </FormPanel>
    )
  }

  const { project, teams, members } = view.data

  return (
    <>
      <FormEyebrow>/ PROJECT · MANAGE</FormEyebrow>
      <FormHeading>{project.title}</FormHeading>

      <div className="space-y-5">
        {rank === 'PROJECT_LEAD' ? (
          <>
            <MembersSection teams={teams} members={members} projectId={projectId} reload={load} />
            <TeamsSection teams={teams} members={members} projectId={projectId} reload={load} />
            <EventsSection projectId={projectId} teams={teams} rank={rank} myTeamId={myTeamId} />
            <TasksSection projectId={projectId} teams={teams} members={members} rank={rank} myTeamId={myTeamId} />
            <MeetingSection project={project} reload={load} />
            <DangerSection projectId={projectId} title={project.title} reloadProjects={reloadProjects} />
          </>
        ) : (
          <>
            <TeamLeadSection
              teamId={myTeamId}
              teams={teams}
              members={members}
              reload={load}
            />
            <EventsSection projectId={projectId} teams={teams} rank={rank} myTeamId={myTeamId} />
            <TasksSection projectId={projectId} teams={teams} members={members} rank={rank} myTeamId={myTeamId} />
          </>
        )}
      </div>
    </>
  )
}

/** One always-rendered status line per section, `role="status"` like every
    form on the site, so a refusal reads out where the click happened. */
function useSectionStatus() {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setMessage('')
    try {
      await action()
    } catch (error) {
      setMessage(explain(error))
    } finally {
      setBusy(false)
    }
  }

  return { message, busy, run }
}

// ----------------------------------------------------------------- members

function MembersSection({
  teams,
  members,
  projectId,
  reload,
}: {
  teams: ApiProjectTeamView['teams']
  members: ApiProjectTeamMember[]
  projectId: string
  reload: () => Promise<void>
}) {
  const { message, busy, run } = useSectionStatus()

  const patch = (userId: string, body: Record<string, unknown>) =>
    run(async () => {
      await patchJson(`/projects/${projectId}/members/${userId}`, body)
      await reload()
    })

  const remove = (userId: string, name: string) =>
    run(async () => {
      if (!window.confirm(`Take ${name} off the project?`)) return
      await deleteJson(`/projects/${projectId}/members/${userId}`)
      await reload()
    })

  return (
    <FormPanel>
      <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]">
        MEMBERS
      </p>

      {members.length === 0 ? (
        <p className="text-dim text-sm leading-[1.7]">
          Nobody has joined yet. Members join from the public project page.
        </p>
      ) : (
        <ul className="divide-rule divide-y">
          {members.map((member) => (
            <li
              key={member.userId}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
            >
              <div className="min-w-0 flex-1 basis-40">
                <p className="truncate text-sm font-medium">{member.fullName}</p>
                <p className="text-faint font-mono text-[10px] font-medium tracking-[0.14em] uppercase">
                  {member.rank === 'PROJECT_LEAD'
                    ? 'Project lead'
                    : member.rank === 'TEAM_LEAD'
                      ? 'Team lead'
                      : (member.title ?? 'Member')}
                </p>
              </div>

              {member.rank === 'PROJECT_LEAD' ? (
                <p className="text-faint text-[12px]">Appointed by officers</p>
              ) : (
                <>
                  <select
                    aria-label={`Team for ${member.fullName}`}
                    className={selectClass}
                    disabled={busy}
                    value={member.teamId ?? ''}
                    onChange={(event) =>
                      void patch(member.userId, {
                        teamId: event.target.value || null,
                        // Losing the team means losing the team-lead rank —
                        // the server would refuse the dangling rank anyway.
                        ...(event.target.value === '' && member.rank === 'TEAM_LEAD'
                          ? { rank: 'MEMBER' }
                          : {}),
                      })
                    }
                  >
                    <option value="">No team</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>

                  {member.rank === 'TEAM_LEAD' ? (
                    <button
                      type="button"
                      disabled={busy}
                      className={smallButton}
                      onClick={() => void patch(member.userId, { rank: 'MEMBER' })}
                    >
                      DEMOTE
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy || member.teamId === null}
                      title={
                        member.teamId === null
                          ? 'Pick a team first — a team lead needs a team.'
                          : undefined
                      }
                      className={smallButton}
                      onClick={() =>
                        void patch(member.userId, { rank: 'TEAM_LEAD' })
                      }
                    >
                      MAKE TEAM LEAD
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={busy}
                    className={dangerButton}
                    onClick={() => void remove(member.userId, member.fullName)}
                  >
                    REMOVE
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <p role="status" className="text-error mt-2 min-h-4 text-[12px]">
        {message}
      </p>
    </FormPanel>
  )
}

// ------------------------------------------------------------------- teams

function TeamsSection({
  teams,
  members,
  projectId,
  reload,
}: {
  teams: ApiProjectTeamView['teams']
  members: ApiProjectTeamMember[]
  projectId: string
  reload: () => Promise<void>
}) {
  const { message, busy, run } = useSectionStatus()
  const nameId = useId()

  const create = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const name = new FormData(form).get('name')
    if (typeof name !== 'string' || !name.trim()) return

    void run(async () => {
      await postJson(`/projects/${projectId}/teams`, { name: name.trim() })
      form.reset()
      await reload()
    })
  }

  const removeTeam = (teamId: string, name: string) =>
    run(async () => {
      if (
        !window.confirm(
          `Delete the ${name} team? Its members stay on the project.`,
        )
      )
        return
      await deleteJson(`/teams/${teamId}`)
      await reload()
    })

  return (
    <FormPanel>
      <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]">
        TEAMS
      </p>

      {teams.length > 0 && (
        <ul className="divide-rule mb-4 divide-y">
          {teams.map((team) => {
            const count = members.filter((m) => m.teamId === team.id).length
            return (
              <li
                key={team.id}
                className="flex items-center justify-between gap-4 py-2.5"
              >
                <span className="text-sm font-medium">
                  {team.name}
                  <span className="text-faint ml-2 font-mono text-[10px]">
                    {count} {count === 1 ? 'MEMBER' : 'MEMBERS'}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  className={dangerButton}
                  onClick={() => void removeTeam(team.id, team.name)}
                >
                  DELETE
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <form onSubmit={create} className="flex items-end gap-3">
        <div className="flex-1">
          <label htmlFor={nameId} className={labelClass}>
            NEW TEAM
          </label>
          <input
            id={nameId}
            name="name"
            required
            maxLength={60}
            placeholder="Chassis"
            className={fieldClass}
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="btn btn-primary btn-cta px-5 py-2.5 text-[12px] font-semibold disabled:opacity-60"
        >
          CREATE
        </button>
      </form>

      <p role="status" className="text-error mt-2 min-h-4 text-[12px]">
        {message}
      </p>
    </FormPanel>
  )
}

// ------------------------------------------------------------------ events

const EVENT_TYPES: EventType[] = [
  'MEETING',
  'WORKSHOP',
  'SOCIAL',
  'COMPETITION',
  'OUTREACH',
  'FUNDRAISER',
]

/** ISO out of the API, `yyyy-mm-dd` / `HH:MM` into the form — local time both
    ways, because that is the zone the person typing is thinking in. */
const toDateInput = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const toTimeInput = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Upcoming events of this project, and the form that makes more of them.
 *
 * A team lead's form is pinned to their own team and their list only carries
 * controls on events they could actually touch; the project lead gets the
 * whole board. The server re-checks every one of these distinctions.
 */
function EventsSection({
  projectId,
  teams,
  rank,
  myTeamId,
}: {
  projectId: string
  teams: ApiProjectTeamView['teams']
  rank: 'PROJECT_LEAD' | 'TEAM_LEAD'
  myTeamId: string | null
}) {
  const { user } = useOutletContext<DashboardContext>()
  const { message, busy, run } = useSectionStatus()
  const [events, setEvents] = useState<ApiMeEvent[] | null>(null)
  const [editing, setEditing] = useState<ApiMeEvent | null>(null)
  const formId = useId()

  const load = useCallback(async () => {
    const all = await getJson<ApiMeEvent[]>(
      `/me/events?from=${encodeURIComponent(new Date().toISOString())}&limit=200`,
    )
    setEvents(all.filter((event) => event.projectId === projectId))
  }, [projectId])

  useEffect(() => {
    load().catch((error: unknown) => {
      console.error(error)
      setEvents(null)
    })
  }, [load])

  const canTouch = (event: ApiMeEvent) =>
    rank === 'PROJECT_LEAD' ||
    event.createdById === user.id ||
    (event.teamId !== null && event.teamId === myTeamId)

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const text = (name: string) => {
      const raw = data.get(name)
      return typeof raw === 'string' ? raw.trim() : ''
    }

    const date = text('date')
    const start = text('start')
    if (!text('title') || !date || !start) return

    const end = text('end')
    const teamValue = text('team')

    const body = {
      title: text('title'),
      type: text('type') as EventType,
      location: text('location') || null,
      // Built in local time and shipped as an instant — "6:30 in the lab" is
      // campus time, and the calendar converts back on the way in.
      startsAt: new Date(`${date}T${start}`).toISOString(),
      endsAt: end ? new Date(`${date}T${end}`).toISOString() : null,
    }

    void run(async () => {
      if (editing) {
        await patchJson(`/events/${editing.id}`, body)
        setEditing(null)
      } else {
        await postJson('/events', {
          ...body,
          projectId,
          teamId: teamValue || null,
        })
      }
      form.reset()
      await load()
    })
  }

  const remove = (event: ApiMeEvent) =>
    run(async () => {
      if (!window.confirm(`Delete "${event.title}"?`)) return
      await deleteJson(`/events/${event.id}`)
      if (editing?.id === event.id) setEditing(null)
      await load()
    })

  const teamName = (id: string | null) =>
    id === null ? 'Whole project' : (teams.find((t) => t.id === id)?.name ?? 'Team')

  return (
    <FormPanel>
      <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]">
        EVENTS
      </p>

      {events === null ? (
        <p className="text-dim mb-4 text-sm leading-[1.7]">
          We couldn't load this project's events just now.
        </p>
      ) : events.length === 0 ? (
        <p className="text-dim mb-4 text-sm leading-[1.7]">
          Nothing scheduled yet. Events made here land on every member's
          dashboard calendar — and nowhere public.
        </p>
      ) : (
        <ul className="divide-rule mb-5 divide-y">
          {events.map((event) => (
            <li
              key={event.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5"
            >
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate text-sm font-medium">{event.title}</p>
                <p className="text-faint font-mono text-[10px] font-medium tracking-[0.1em]">
                  {new Date(event.startsAt).toLocaleString(undefined, {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                  {' · '}
                  {teamName(event.teamId).toUpperCase()}
                </p>
              </div>
              {canTouch(event) && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    className={smallButton}
                    onClick={() => {
                      setEditing(event)
                    }}
                  >
                    EDIT
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className={dangerButton}
                    onClick={() => void remove(event)}
                  >
                    DELETE
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* `key` swaps the form wholesale between "new" and "editing", which is
          what lets uncontrolled inputs pick up the event's values as defaults. */}
      <form key={editing?.id ?? 'new'} onSubmit={submit} className="space-y-3">
        <p className={labelClass}>
          {editing ? `EDITING — ${editing.title.toUpperCase()}` : 'NEW EVENT'}
        </p>

        <div className="grid gap-3 wide:grid-cols-2">
          <input
            aria-label="Event title"
            name="title"
            required
            maxLength={160}
            placeholder="Design review"
            defaultValue={editing?.title ?? ''}
            className={fieldClass}
            disabled={busy}
          />
          <div className="flex gap-3">
            <select
              aria-label="Event type"
              name="type"
              className={selectClass}
              defaultValue={editing?.type ?? 'MEETING'}
              disabled={busy}
            >
              {EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            {/* Where an event hangs is fixed once it exists — the permission
                question stays one-dimensional that way. */}
            {!editing && (
              <select
                aria-label="Event team"
                name="team"
                className={selectClass}
                defaultValue={rank === 'TEAM_LEAD' ? (myTeamId ?? '') : ''}
                disabled={busy || rank === 'TEAM_LEAD'}
              >
                {rank === 'PROJECT_LEAD' && <option value="">Whole project</option>}
                {teams
                  .filter((t) => rank === 'PROJECT_LEAD' || t.id === myTeamId)
                  .map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
              </select>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor={`${formId}-date`} className={labelClass}>
              DATE
            </label>
            <input
              id={`${formId}-date`}
              name="date"
              type="date"
              required
              defaultValue={editing ? toDateInput(editing.startsAt) : ''}
              className={`${fieldClass} h-8 w-40`}
              disabled={busy}
            />
          </div>
          <div>
            <label htmlFor={`${formId}-start`} className={labelClass}>
              STARTS
            </label>
            <input
              id={`${formId}-start`}
              name="start"
              type="time"
              required
              defaultValue={editing ? toTimeInput(editing.startsAt) : ''}
              className={`${fieldClass} h-8 w-28`}
              disabled={busy}
            />
          </div>
          <div>
            <label htmlFor={`${formId}-end`} className={labelClass}>
              ENDS
            </label>
            <input
              id={`${formId}-end`}
              name="end"
              type="time"
              defaultValue={editing?.endsAt ? toTimeInput(editing.endsAt) : ''}
              className={`${fieldClass} h-8 w-28`}
              disabled={busy}
            />
          </div>
          <div className="min-w-36 flex-1">
            <label htmlFor={`${formId}-location`} className={labelClass}>
              PLACE
            </label>
            <input
              id={`${formId}-location`}
              name="location"
              maxLength={160}
              defaultValue={editing?.location ?? ''}
              placeholder="ENG2 Lab"
              className={`${fieldClass} h-8`}
              disabled={busy}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="btn btn-primary btn-cta px-5 py-2.5 text-[12px] font-semibold disabled:opacity-60"
          >
            {editing ? 'SAVE' : 'CREATE EVENT'}
          </button>
          {editing && (
            <button
              type="button"
              disabled={busy}
              className={smallButton}
              onClick={() => {
                setEditing(null)
              }}
            >
              CANCEL
            </button>
          )}
        </div>
      </form>

      <p role="status" className="text-error mt-2 min-h-4 text-[12px]">
        {message}
      </p>
    </FormPanel>
  )
}

// ------------------------------------------------------------------- tasks

/**
 * The project's checklist, and the form that grows it. Same scoping story as
 * events: a team lead's tasks land on their own team, and the rows they can
 * touch are exactly the ones on it. Assignment is checkboxes over the roster —
 * a task routinely belongs to two people, and the server holds everyone
 * assigned to actually being on the project.
 */
function TasksSection({
  projectId,
  teams,
  members,
  rank,
  myTeamId,
}: {
  projectId: string
  teams: ApiProjectTeamView['teams']
  members: ApiProjectTeamMember[]
  rank: 'PROJECT_LEAD' | 'TEAM_LEAD'
  myTeamId: string | null
}) {
  const { message, busy, run } = useSectionStatus()
  const [tasks, setTasks] = useState<ApiTask[] | null>(null)
  const [editing, setEditing] = useState<ApiTask | null>(null)
  const formId = useId()

  const load = useCallback(async () => {
    setTasks(await getJson<ApiTask[]>(`/projects/${projectId}/tasks`))
  }, [projectId])

  useEffect(() => {
    load().catch((error: unknown) => {
      console.error(error)
      setTasks(null)
    })
  }, [load])

  const canTouch = (task: ApiTask) =>
    rank === 'PROJECT_LEAD' || (task.teamId !== null && task.teamId === myTeamId)

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)

    const title = data.get('title')
    if (typeof title !== 'string' || !title.trim()) return

    const details = data.get('details')
    const due = data.get('due')
    const teamValue = data.get('team')

    const body = {
      title: title.trim(),
      details:
        typeof details === 'string' && details.trim() ? details.trim() : null,
      dueAt:
        typeof due === 'string' && due
          ? new Date(`${due}T23:59`).toISOString()
          : null,
      assigneeIds: data.getAll('assignee').filter(
        (value): value is string => typeof value === 'string',
      ),
    }

    void run(async () => {
      if (editing) {
        await patchJson(`/tasks/${editing.id}`, body)
        setEditing(null)
      } else {
        await postJson(`/projects/${projectId}/tasks`, {
          ...body,
          teamId:
            rank === 'TEAM_LEAD'
              ? myTeamId
              : typeof teamValue === 'string' && teamValue
                ? teamValue
                : null,
        })
      }
      form.reset()
      await load()
    })
  }

  const remove = (task: ApiTask) =>
    run(async () => {
      if (!window.confirm(`Delete "${task.title}"?`)) return
      await deleteJson(`/tasks/${task.id}`)
      if (editing?.id === task.id) setEditing(null)
      await load()
    })

  const flip = (task: ApiTask) =>
    run(async () => {
      await postJson(`/tasks/${task.id}/status`, {
        status: task.status === 'OPEN' ? 'DONE' : 'OPEN',
      })
      await load()
    })

  return (
    <FormPanel>
      <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]">
        TASKS
      </p>

      {tasks === null ? (
        <p className="text-dim mb-4 text-sm leading-[1.7]">
          We couldn't load the tasks just now.
        </p>
      ) : tasks.length === 0 ? (
        <p className="text-dim mb-4 text-sm leading-[1.7]">
          Nothing on the board yet.
        </p>
      ) : (
        <ul className="divide-rule mb-5 divide-y">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5"
            >
              <div className={`min-w-0 flex-1 basis-48 ${task.status === 'DONE' ? 'opacity-50' : ''}`}>
                <p className={`truncate text-sm font-medium ${task.status === 'DONE' ? 'line-through' : ''}`}>
                  {task.title}
                </p>
                <p className="text-faint font-mono text-[10px] font-medium tracking-[0.1em] uppercase">
                  {[
                    task.teamId
                      ? (teams.find((t) => t.id === task.teamId)?.name ?? 'Team')
                      : 'Whole project',
                    task.assignees.map((a) => a.fullName).join(', ') || 'Unassigned',
                    task.dueAt
                      ? `Due ${new Date(task.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                      : null,
                    task.status === 'DONE' && task.completedByName
                      ? `Done — ${task.completedByName}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              {canTouch(task) && (
                <>
                  <button type="button" disabled={busy} className={smallButton} onClick={() => void flip(task)}>
                    {task.status === 'OPEN' ? 'MARK DONE' : 'REOPEN'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className={smallButton}
                    onClick={() => {
                      setEditing(task)
                    }}
                  >
                    EDIT
                  </button>
                  <button type="button" disabled={busy} className={dangerButton} onClick={() => void remove(task)}>
                    DELETE
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <form key={editing?.id ?? 'new'} onSubmit={submit} className="space-y-3">
        <p className={labelClass}>
          {editing ? `EDITING — ${editing.title.toUpperCase()}` : 'NEW TASK'}
        </p>

        <div className="grid gap-3 wide:grid-cols-2">
          <input
            aria-label="Task title"
            name="title"
            required
            maxLength={200}
            placeholder="CAD the chassis"
            defaultValue={editing?.title ?? ''}
            className={fieldClass}
            disabled={busy}
          />
          <div className="flex gap-3">
            <div>
              <label htmlFor={`${formId}-due`} className="sr-only">
                Due date
              </label>
              <input
                id={`${formId}-due`}
                name="due"
                type="date"
                aria-label="Due date"
                defaultValue={editing?.dueAt ? toDateInput(editing.dueAt) : ''}
                className={`${fieldClass} h-8 w-40`}
                disabled={busy}
              />
            </div>
            {!editing && rank === 'PROJECT_LEAD' && (
              <select
                aria-label="Task team"
                name="team"
                className={selectClass}
                defaultValue=""
                disabled={busy}
              >
                <option value="">Whole project</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <textarea
          aria-label="Task details"
          name="details"
          maxLength={5000}
          rows={2}
          placeholder="Details, links, where to start (optional)"
          defaultValue={editing?.details ?? ''}
          className="textarea border-rule bg-base-200 w-full text-sm"
          disabled={busy}
        />

        <fieldset>
          <legend className={labelClass}>ASSIGN TO</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            {members.map((member) => (
              <label
                key={member.userId}
                className="flex cursor-pointer items-center gap-2 text-[13px]"
              >
                <input
                  type="checkbox"
                  name="assignee"
                  value={member.userId}
                  defaultChecked={
                    editing?.assignees.some((a) => a.userId === member.userId) ?? false
                  }
                  disabled={busy}
                  className="checkbox checkbox-xs rounded-[2px]"
                />
                {member.fullName}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="btn btn-primary btn-cta px-5 py-2.5 text-[12px] font-semibold disabled:opacity-60"
          >
            {editing ? 'SAVE' : 'CREATE TASK'}
          </button>
          {editing && (
            <button
              type="button"
              disabled={busy}
              className={smallButton}
              onClick={() => {
                setEditing(null)
              }}
            >
              CANCEL
            </button>
          )}
        </div>
      </form>

      <p role="status" className="text-error mt-2 min-h-4 text-[12px]">
        {message}
      </p>
    </FormPanel>
  )
}

// ----------------------------------------------------------------- meeting

function MeetingSection({
  project,
  reload,
}: {
  project: ApiProjectTeamView['project']
  reload: () => Promise<void>
}) {
  const { message, busy, run } = useSectionStatus()
  const [saved, setSaved] = useState(false)
  const id = useId()

  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const weekday = data.get('weekday')
    const time = data.get('time')
    const location = data.get('location')

    setSaved(false)
    void run(async () => {
      await patchJson(`/projects/${project.id}`, {
        meetingWeekday: weekday === '' ? null : Number(weekday),
        meetingTime: time === '' ? null : time,
        meetingLocation:
          typeof location === 'string' && location.trim()
            ? location.trim()
            : null,
      })
      await reload()
      setSaved(true)
    })
  }

  return (
    <FormPanel>
      <p className="text-faint mb-1 font-mono text-[10px] font-medium tracking-[0.16em]">
        WEEKLY MEETING
      </p>
      <p className="text-dim mb-4 text-[13px] leading-[1.6] text-pretty">
        Shows on every member's dashboard and lands on their calendar, week
        after week. Leave the day blank to take it off.
      </p>

      <form onSubmit={save} className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={`${id}-day`} className={labelClass}>
            DAY
          </label>
          <select
            id={`${id}-day`}
            name="weekday"
            className={selectClass}
            defaultValue={project.meetingWeekday ?? ''}
            disabled={busy}
          >
            <option value="">Not set</option>
            {WEEKDAY_NAMES.map((day, index) => (
              <option key={day} value={index}>
                {day}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${id}-time`} className={labelClass}>
            TIME
          </label>
          <input
            id={`${id}-time`}
            name="time"
            type="time"
            defaultValue={project.meetingTime ?? ''}
            className={`${fieldClass} h-8 w-32`}
            disabled={busy}
          />
        </div>

        <div className="min-w-40 flex-1">
          <label htmlFor={`${id}-location`} className={labelClass}>
            PLACE
          </label>
          <input
            id={`${id}-location`}
            name="location"
            maxLength={160}
            defaultValue={project.meetingLocation ?? ''}
            placeholder="ENG2 Lab"
            className={`${fieldClass} h-8`}
            disabled={busy}
          />
        </div>

        <button
          type="submit"
          disabled={busy}
          className="btn btn-primary btn-cta px-5 py-2.5 text-[12px] font-semibold disabled:opacity-60"
        >
          SAVE
        </button>
      </form>

      <p role="status" className="mt-2 min-h-4 text-[12px]">
        {message ? (
          <span className="text-error">{message}</span>
        ) : saved ? (
          <span className="text-success">Saved.</span>
        ) : (
          ''
        )}
      </p>
    </FormPanel>
  )
}

// ------------------------------------------------------------------ danger

function DangerSection({
  projectId,
  title,
  reloadProjects,
}: {
  projectId: string
  title: string
  reloadProjects: () => Promise<void>
}) {
  const { message, busy, run } = useSectionStatus()
  const navigate = useNavigate()

  const destroy = () =>
    run(async () => {
      // Typing the name, not just clicking OK: this deletes the project for
      // every member at once, and there is no undo to offer.
      const typed = window.prompt(
        `Deleting removes this project for everyone on it, permanently. Type "${title}" to confirm.`,
      )
      if (typed !== title) return
      await deleteJson(`/projects/${projectId}`)
      await reloadProjects()
      void navigate('/dashboard')
    })

  return (
    <FormPanel>
      <p className="text-faint mb-3 font-mono text-[10px] font-medium tracking-[0.16em]">
        DANGER
      </p>
      <button
        type="button"
        disabled={busy}
        className={dangerButton}
        onClick={() => void destroy()}
      >
        DELETE THIS PROJECT
      </button>
      <p role="status" className="text-error mt-2 min-h-4 text-[12px]">
        {message}
      </p>
    </FormPanel>
  )
}

// -------------------------------------------------------------- team leads

/**
 * The whole page, as a team lead sees it: their team's roster, and the pool
 * of unseated members they may pull from. The narrowness is the point — the
 * server refuses everything outside exactly this.
 */
function TeamLeadSection({
  teamId,
  teams,
  members,
  reload,
}: {
  teamId: string | null
  teams: ApiProjectTeamView['teams']
  members: ApiProjectTeamMember[]
  reload: () => Promise<void>
}) {
  const { message, busy, run } = useSectionStatus()

  if (!teamId) {
    return (
      <FormPanel>
        <p className="text-dim text-sm leading-[1.7] text-pretty">
          You hold the team-lead rank but no team — ask your project lead to
          seat you on one.
        </p>
      </FormPanel>
    )
  }

  const team = teams.find((t) => t.id === teamId)
  const onTeam = members.filter((m) => m.teamId === teamId)
  const available = members.filter(
    (m) => m.teamId === null && m.rank === 'MEMBER',
  )

  const move = (userId: string, direction: 'add' | 'remove') =>
    run(async () => {
      if (direction === 'add') {
        await postJson(`/teams/${teamId}/members/${userId}`, {})
      } else {
        await deleteJson(`/teams/${teamId}/members/${userId}`)
      }
      await reload()
    })

  return (
    <>
      <FormPanel>
        <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em] uppercase">
          {team ? `YOUR TEAM — ${team.name}` : 'YOUR TEAM'}
        </p>

        {onTeam.length === 0 ? (
          <p className="text-dim text-sm leading-[1.7]">Nobody here yet.</p>
        ) : (
          <ul className="divide-rule divide-y">
            {onTeam.map((member) => (
              <li
                key={member.userId}
                className="flex items-center justify-between gap-4 py-2.5"
              >
                <span className="text-sm font-medium">{member.fullName}</span>
                {member.rank === 'MEMBER' ? (
                  <button
                    type="button"
                    disabled={busy}
                    className={dangerButton}
                    onClick={() => void move(member.userId, 'remove')}
                  >
                    REMOVE
                  </button>
                ) : (
                  <span className="text-faint font-mono text-[10px] tracking-[0.14em]">
                    {member.rank === 'PROJECT_LEAD' ? 'PROJECT LEAD' : 'TEAM LEAD'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </FormPanel>

      <FormPanel>
        <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]">
          NOT ON A TEAM YET
        </p>

        {available.length === 0 ? (
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            Everyone on the project is already seated. The project lead can
            move people between teams.
          </p>
        ) : (
          <ul className="divide-rule divide-y">
            {available.map((member) => (
              <li
                key={member.userId}
                className="flex items-center justify-between gap-4 py-2.5"
              >
                <span className="text-sm font-medium">{member.fullName}</span>
                <button
                  type="button"
                  disabled={busy}
                  className={smallButton}
                  onClick={() => void move(member.userId, 'add')}
                >
                  ADD TO TEAM
                </button>
              </li>
            ))}
          </ul>
        )}

        <p role="status" className="text-error mt-2 min-h-4 text-[12px]">
          {message}
        </p>
      </FormPanel>
    </>
  )
}
