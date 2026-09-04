import { useCallback, useEffect, useId, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router'
import { ConfirmDialog } from '../../components/shared/ConfirmDialog'
import { DiscordRoleHelp } from '../../components/shared/DiscordRoleHelp'
import { DuesLocked } from '../../components/dashboard/DuesLocked'
import { duesLocked } from '../../lib/dues/dues'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  fieldClass,
  labelClass,
  measureClass,
} from '../../components/shared/formChrome'
import {
  ApiError,
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from '../../lib/api/api'
import type {
  ApiMeEvent,
  ApiProjectDetail,
  ApiProjectTeamMember,
  ApiProjectTeamView,
  ApiTask,
  ApiTeam,
  EventType,
  ProjectMemberRank,
} from '../../lib/api/api'
import {
  EVENT_TYPES,
  isGeneratedMeeting,
  toDateInput,
  toTimeInput,
} from '../../lib/events/events'
import { WEEKDAY_SHORT, meetingLine, meetingNote } from '../../lib/events/meetings'
import { TASK_LABEL, isSettled } from '../../lib/tasks'
import type { ApiState } from '../../lib/api/useApi'
import { useApi } from '../../lib/api/useApi'
import { isOfficer } from '../../lib/auth/session'

/**
 * The lead's side of a project: members, teams, and the meeting schedule.
 *
 * Which controls appear follows the caller's rank on this project — a team lead gets their own
 * team's roster, a project lead gets everything — but appearance is all it is. Every button
 * lands on a server route that re-checks the same rank.
 *
 * Officers see the project-lead view of any project. They resolve the slug through the public
 * detail route because nothing guarantees they're on the project's member list at all.
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
  const officer = isOfficer(user.role)

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
      <div className={measureClass}>
        <FormPanel tone="accent">
          <p className="text-dim text-sm leading-[1.7]">
            We couldn't load your projects just now. Try again in a moment.
          </p>
        </FormPanel>
      </div>
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
        <div className={measureClass}>
          <FormPanel>
            <p className="text-dim text-sm leading-[1.7] text-pretty">
              Managing a project is for its project lead and team leads.
            </p>
          </FormPanel>
        </div>
      </>
    )
  }

  if (mine) {
    return (
      <Manage
        projectId={mine.project.id}
        rank={rank}
        myTeamId={mine.team?.id ?? null}
        officer={officer}
      />
    )
  }

  // An officer with no membership row: find the id the long way round.
  return <ResolveBySlug slug={slug} />
}

/** Only ever reached by an officer with no membership row — see the call
    site — which is why `officer` below is a constant rather than a prop. */
function ResolveBySlug({ slug }: { slug: string }) {
  const detail = useApi<ApiProjectDetail>(`/projects/${slug}`)

  if (detail.status === 'loading') {
    return <div aria-busy="true" className="border-rule bg-base-200 h-40 border" />
  }

  if (detail.status === 'error') {
    return (
      <div className={measureClass}>
        <FormPanel tone="accent">
          <p className="text-dim text-sm leading-[1.7]">
            {detail.code === 404
              ? 'There is no project at this address.'
              : "We couldn't load the project just now."}
          </p>
        </FormPanel>
      </div>
    )
  }

  return (
    <Manage
      projectId={detail.data.id}
      rank="PROJECT_LEAD"
      myTeamId={null}
      officer
    />
  )
}

function Manage({
  projectId,
  rank,
  myTeamId,
  officer,
}: {
  projectId: string
  rank: 'PROJECT_LEAD' | 'TEAM_LEAD'
  myTeamId: string | null
  /** Whether to draw the one control on this page that is not a lead's: the
      switch that puts the project's meetings on the public calendar. */
  officer: boolean
}) {
  const { reloadProjects, membership } = useOutletContext<DashboardContext>()
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
      <div className={measureClass}>
        <FormPanel tone="accent">
          <p className="text-dim text-sm leading-[1.7]">
            {view.code === 403
              ? 'The server does not agree you can manage this project.'
              : "We couldn't load the project just now. Try again in a moment."}
          </p>
        </FormPanel>
      </div>
    )
  }

  const { project, teams, members } = view.data

  /**
   * Whether a new task may go on this project.
   *
   * The server refuses one on anything but this semester's build, so the form says so instead of
   * offering a button that 409s. The term comes off the membership context — the layout has
   * already read it for the rail — rather than `/me/projects`, because an officer managing a
   * project they're not on has no membership row to read `current` from.
   *
   * Defaults to allowed while the standing is still in flight, the same rule the dues padlocks
   * follow.
   */
  const term = membership.status === 'ready' ? membership.data.term : null
  const canCreateTasks =
    term === null ||
    (project.termYear === term.year && project.termSeason === term.season)

  return (
    <>
      <FormEyebrow>/ PROJECT · MANAGE</FormEyebrow>
      <FormHeading>{project.title}</FormHeading>

      {/* Seven sections, none of which reads on from the one above — a lead comes here to do one
          of them. Stacked, that meant scrolling past four panels to reach the fifth while the
          right half of the screen stayed empty. `items-start` keeps the short ones short: DISCORD
          ROLE is four lines and has no business being as tall as the roster. */}
      <div className="grid-fluid items-start gap-5 [--col-min:30rem]">
        {rank === 'PROJECT_LEAD' ? (
          <>
            <MembersSection teams={teams} members={members} projectId={projectId} reload={load} />
            <TeamsSection teams={teams} members={members} projectId={projectId} reload={load} />
            <EventsSection projectId={projectId} teams={teams} rank={rank} myTeamId={myTeamId} />
            <TasksSection projectId={projectId} teams={teams} members={members} rank={rank} myTeamId={myTeamId} canCreate={canCreateTasks} />
            <MeetingSection project={project} reload={load} officer={officer} />
            <DiscordRoleSection project={project} reload={load} />
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
            <TasksSection projectId={projectId} teams={teams} members={members} rank={rank} myTeamId={myTeamId} canCreate={canCreateTasks} />
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
          Nobody has joined yet.
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
  const [editing, setEditing] = useState<ApiTeam | null>(null)
  const nameId = useId()

  // Both forms carry the same two fields, so they read them the same way.
  // Narrowed rather than coerced, like every other form on this page:
  // `FormData.get` can hand back a `File`, and `String()` on one is the
  // literal text '[object File]'.
  const fields = (form: HTMLFormElement) => {
    const data = new FormData(form)
    const text = (name: string) => {
      const raw = data.get(name)
      return typeof raw === 'string' ? raw.trim() : ''
    }
    return { name: text('name'), description: text('description') }
  }

  const create = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const { name, description } = fields(form)
    if (!name) return

    void run(async () => {
      await postJson(`/projects/${projectId}/teams`, {
        name,
        description: description || null,
      })
      form.reset()
      await reload()
    })
  }

  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing) return
    const { name, description } = fields(event.currentTarget)
    if (!name) return

    void run(async () => {
      await patchJson(`/teams/${editing.id}`, {
        name,
        description: description || null,
      })
      setEditing(null)
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
      // The row being edited is the row that just went: leaving `editing` set
      // would reopen the form against a team that no longer exists.
      if (editing?.id === teamId) setEditing(null)
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

            // The row becomes the form rather than growing one underneath the list: a lead editing
            // "Chassis" is looking at the line that says Chassis, and putting the fields anywhere
            // else loses that thread. Mounting on press is also what lets the inputs stay
            // uncontrolled.
            if (editing?.id === team.id) {
              return (
                <li key={team.id} className="py-3">
                  <form onSubmit={save} className="space-y-2">
                    <input
                      aria-label={`Name for ${team.name}`}
                      name="name"
                      required
                      maxLength={60}
                      defaultValue={team.name}
                      className={fieldClass}
                      disabled={busy}
                    />
                    <input
                      aria-label={`Description for ${team.name}`}
                      name="description"
                      maxLength={500}
                      placeholder="What this team does (optional)"
                      defaultValue={team.description ?? ''}
                      className={fieldClass}
                      disabled={busy}
                    />
                    <div className="flex items-center gap-3">
                      <button type="submit" disabled={busy} className={smallButton}>
                        SAVE
                      </button>
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
                    </div>
                  </form>
                </li>
              )
            }

            return (
              <li
                key={team.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5"
              >
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-sm font-medium">
                    {team.name}
                    <span className="text-faint ml-2 font-mono text-[10px]">
                      {count} {count === 1 ? 'MEMBER' : 'MEMBERS'}
                    </span>
                  </p>
                  {team.description && (
                    <p className="text-faint truncate text-[12px]">
                      {team.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  className={smallButton}
                  onClick={() => {
                    setEditing(team)
                  }}
                >
                  EDIT
                </button>
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

      <form onSubmit={create} className="space-y-3">
        <div>
          <label htmlFor={nameId} className={labelClass}>
            NEW TEAM
          </label>
          <input
            id={nameId}
            name="name"
            required
            maxLength={60}
            placeholder="Name"
            className={fieldClass}
            disabled={busy}
          />
        </div>
        <input
          aria-label="New team description"
          name="description"
          maxLength={500}
          placeholder="Short Description"
          className={fieldClass}
          disabled={busy}
        />
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

/**
 * Upcoming events of this project, and the form that makes more of them.
 *
 * A team lead's form is pinned to their own team and their list only carries controls on events
 * they could touch; the project lead gets the whole board. The server re-checks every one of
 * these distinctions.
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
  const [deleting, setDeleting] = useState<ApiMeEvent | null>(null)
  const formId = useId()

  const load = useCallback(async () => {
    const all = await getJson<ApiMeEvent[]>(
      `/me/events?from=${encodeURIComponent(new Date().toISOString())}&limit=200`,
    )
    // Generated meetings are filtered out, not just this project's other rows.
    // `/me/events` now carries them, and they have no row behind them — an EDIT
    // button on one would PATCH an id that 404s. The schedule is edited on the
    // panel below.
    setEvents(
      all.filter(
        (event) => event.projectId === projectId && !isGeneratedMeeting(event),
      ),
    )
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

  // `ConfirmDialog`, not `window.confirm` — the house rule, and the reason is
  // that a native confirm cannot be styled, cannot be tested in jsdom and puts
  // the destructive button under the cursor by default.
  const remove = (event: ApiMeEvent) =>
    run(async () => {
      await deleteJson(`/events/${event.id}`)
      if (editing?.id === event.id) setEditing(null)
      setDeleting(null)
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
          Nothing scheduled yet. Events made here are not public.
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
                    onClick={() => {
                      setDeleting(event)
                    }}
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

      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.title}"?`}
          confirmLabel="DELETE IT"
          busy={busy}
          onConfirm={() => void remove(deleting)}
          onDismiss={() => {
            setDeleting(null)
          }}
        >
          <p>
            It comes off every calendar it is on. Nothing else about the project
            changes.
          </p>
        </ConfirmDialog>
      )}
    </FormPanel>
  )
}

// ------------------------------------------------------------------- tasks

/**
 * The project's checklist, and the form that grows it. Same scoping story as events: a team
 * lead's tasks land on their own team. Assignment is checkboxes over the roster — a task
 * routinely belongs to two people, and the server holds everyone assigned to actually being on
 * the project.
 */
function TasksSection({
  projectId,
  teams,
  members,
  rank,
  myTeamId,
  canCreate,
}: {
  projectId: string
  teams: ApiProjectTeamView['teams']
  members: ApiProjectTeamMember[]
  rank: 'PROJECT_LEAD' | 'TEAM_LEAD'
  myTeamId: string | null
  /** False on a build that is not this semester's — the server refuses a new
      task there, so the form says so rather than offering a 409. Editing and
      ticking what is already on the board are unaffected. */
  canCreate: boolean
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
        // Reads "is it settled" rather than "is it OPEN", so ticking something
        // already IN_PROGRESS finishes it instead of demoting it back to
        // untouched. The other three labels are set on `/dashboard/tasks`.
        status: isSettled(task.status) ? 'OPEN' : 'DONE',
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
              <div className={`min-w-0 flex-1 basis-48 ${isSettled(task.status) ? 'opacity-50' : ''}`}>
                <p className={`truncate text-sm font-medium ${isSettled(task.status) ? 'line-through' : ''}`}>
                  {task.title}
                </p>
                <p className="text-faint font-mono text-[10px] font-medium tracking-[0.1em] uppercase">
                  {[
                    // OPEN is the default and says nothing; the other four are
                    // why this is here.
                    task.status === 'OPEN' ? null : TASK_LABEL[task.status].text,
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
                    {isSettled(task.status) ? 'REOPEN' : 'MARK DONE'}
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

      {/* Closing out last term's board is normal; adding to it is not. The
          note replaces the form rather than disabling it, because a greyed-out
          form invites somebody to work out what they did wrong. */}
      {!canCreate && editing === null ? (
        <p className="text-dim text-sm leading-[1.7] text-pretty">
          This build is not running this semester, so it takes no new tasks.
          What is already on the board is still yours to tick off, edit and
          tidy up.
        </p>
      ) : (
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
      )}

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
  officer,
}: {
  project: ApiProjectTeamView['project']
  reload: () => Promise<void>
  officer: boolean
}) {
  const { message, busy, run } = useSectionStatus()
  const [saved, setSaved] = useState(false)
  const [days, setDays] = useState<number[]>(project.meetingWeekdays)
  const [fault, setFault] = useState('')
  const id = useId()

  const toggle = (day: number) => {
    setDays(
      days.includes(day)
        ? days.filter((each) => each !== day)
        : [...days, day].sort((a, b) => a - b),
    )
    setFault('')
  }

  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    // Narrowed rather than coerced, the same way `EventsSection` above does it:
    // `FormData.get` can hand back a `File`, and `String()` on one is the
    // literal text '[object File]'.
    const text = (name: string) => {
      const raw = data.get(name)
      return typeof raw === 'string' ? raw.trim() : ''
    }
    const from = text('from')
    const to = text('to')
    const location = text('location')
    const noteText = text('note')
    const clearing = days.length === 0

    // Checked here as well as on the server, because these are the two mistakes
    // somebody actually makes and a round trip to be told so is a round trip.
    // The server refuses both regardless — see `projectMeeting.ts`.
    if (!clearing && (!from || !to)) {
      setFault(
        'Pick a start and an end time, or clear the days to remove the schedule.',
      )
      return
    }
    if (!clearing && from >= to) {
      setFault('The meeting has to end after it starts.')
      return
    }

    setFault('')
    setSaved(false)
    void run(async () => {
      await patchJson(`/projects/${project.id}`, {
        meetingWeekdays: days,
        // Cleared together with the days. Half a schedule is a project that
        // reads as meeting somewhere and appears on no calendar.
        meetingStartTime: clearing ? null : from,
        meetingEndTime: clearing ? null : to,
        meetingLocation: clearing || !location ? null : location,
        // Goes with the schedule too. A note is about the meeting, and keeping
        // one on a project that has stopped meeting is a stale sentence
        // nobody would think to come back and delete.
        meetingDescription: clearing || !noteText ? null : noteText,
      })
      await reload()
      setSaved(true)
    })
  }

  const line = meetingLine(project)
  const note = meetingNote(project)

  return (
    <FormPanel>
      <p className="text-faint mb-1 font-mono text-[10px] font-medium tracking-[0.16em]">
        MEETING SCHEDULE
      </p>
      <p className="text-dim mb-4 text-[13px] leading-[1.6] text-pretty">
        Every member&rsquo;s calendar carries this, and it repeats to the end of
        the semester. Clear every day to take it off.
      </p>

      <form onSubmit={save} className="space-y-4">
        <fieldset>
          <legend className={labelClass}>DAYS</legend>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_SHORT.map((short, index) => {
              const on = days.includes(index)
              return (
                <label
                  key={short}
                  className={`focus-within:outline-primary flex min-h-11 cursor-pointer items-center border px-3 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 focus-within:outline-2 focus-within:outline-offset-2 wide:min-h-9 ${
                    on
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-rule text-dim hover:border-primary hover:text-primary'
                  }`}
                >
                  {/* Really a checkbox, visually hidden rather than absent: the
                      accessible name is what a screen reader reads and what the
                      tests query on, and `sr-only` keeps it focusable where
                      `hidden` would not. */}
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    disabled={busy}
                    onChange={() => {
                      toggle(index)
                    }}
                  />
                  {short}
                </label>
              )
            })}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor={`${id}-from`} className={labelClass}>
              FROM
            </label>
            <input
              id={`${id}-from`}
              name="from"
              type="time"
              defaultValue={project.meetingStartTime ?? ''}
              className={`${fieldClass} h-8 w-32`}
              disabled={busy}
            />
          </div>

          <div>
            <label htmlFor={`${id}-to`} className={labelClass}>
              TO
            </label>
            <input
              id={`${id}-to`}
              name="to"
              type="time"
              defaultValue={project.meetingEndTime ?? ''}
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
        </div>

        {/* The one part of a schedule the columns above can't hold, and the one that's genuinely
            optional. Left empty, the meeting reaches a member's calendar with no description at
            all, which is deliberate: the site used to write one here and it only ever repeated
            the title and the room. */}
        <div>
          <label htmlFor={`${id}-note`} className={labelClass}>
            NOTE (OPTIONAL)
          </label>
          <textarea
            id={`${id}-note`}
            name="note"
            maxLength={400}
            rows={2}
            defaultValue={project.meetingDescription ?? ''}
            placeholder="Anything the time and place don't say — bring a laptop, we skip home game days"
            className="textarea border-rule bg-base-200 w-full text-sm"
            disabled={busy}
          />
          <p className="text-faint mt-1 text-[12px] leading-[1.5] text-pretty">
            This is what members see on the meeting in their calendar. Leave it
            empty and nothing is said.
          </p>
        </div>

        {fault && <p className="text-error text-[13px]">{fault}</p>}

        <button
          type="submit"
          disabled={busy}
          className="btn btn-primary btn-cta px-5 py-2.5 text-[12px] font-semibold disabled:opacity-60"
        >
          {busy ? 'SAVING…' : 'SAVE'}
        </button>
      </form>

      {/* An officer's switch, not a lead's, and the server refuses it from anyone else — the same
          split as `published` on an event. Drawn only for officers rather than disabled for leads:
          a control somebody can't use is a question they'll ask. Outside the form and saving on
          its own, because pairing it with SAVE would mean a lead's unsaved edits were the price
          of flipping it. */}
      {officer && (
        <label className="border-rule mt-4 flex cursor-pointer items-start gap-2.5 border-t pt-4">
          <input
            type="checkbox"
            name="meetingsPublic"
            defaultChecked={project.meetingsPublic}
            disabled={busy}
            className="checkbox checkbox-sm border-rule mt-0.5"
            onChange={(change) => {
              const on = change.target.checked
              setSaved(false)
              void run(async () => {
                await patchJson(`/projects/${project.id}`, {
                  meetingsPublic: on,
                })
                await reload()
                setSaved(true)
              })
            }}
          />
          <span className="text-dim text-[13px] leading-[1.5] text-pretty">
            Show these meetings on the public calendar
            <span className="text-faint block text-[12px]">
              Officers only. Off keeps them to members&rsquo; dashboards.
            </span>
          </span>
        </label>
      )}

      {/* What the schedule actually produces, read back from the saved row rather than the form.
          A lead who has just typed 18:00 wants to see "6:00 - 10:00 PM" agree with them, and the
          bound is the part nobody expects: the meetings stop at the end of the term. */}
      {line && (
        <div className="border-rule mt-4 border-t pt-3">
          <p className="text-faint text-[12px] leading-[1.5] text-pretty">
            {line}. It repeats to the end of this project&rsquo;s semester, and
            skips finals week.
          </p>
          {/* Quoted rather than restated, so a lead can see the note as a
              member will read it. Absent when there is none, which is the
              state this whole field is optional for. */}
          {note && (
            <p className="text-dim mt-1.5 text-[12px] leading-[1.5] text-pretty">
              {note}
            </p>
          )}
        </div>
      )}

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

// ---------------------------------------------------------------- discord

/**
 * The crew's Discord role.
 *
 * Its own panel rather than a field on the meeting form, because it isn't a setting of the same
 * kind: everything else on this page describes the project, and this hands out and takes away
 * access to a channel. The copy says so, since a lead pasting a number into a box has no other
 * way to know that pressing SAVE is about to change what a dozen people can see.
 */
function DiscordRoleSection({
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
    const raw = new FormData(event.currentTarget).get('discordRoleId')
    const value = typeof raw === 'string' ? raw.trim() : ''

    setSaved(false)
    void run(async () => {
      await patchJson(`/projects/${project.id}`, {
        discordRoleId: value || null,
      })
      await reload()
      setSaved(true)
    })
  }

  return (
    <FormPanel>
      <p className="text-faint mb-1 font-mono text-[10px] font-medium tracking-[0.16em]">
        DISCORD ROLE
      </p>
      <p className="text-dim mb-2 text-[13px] leading-[1.6] text-pretty">
        Everyone on this project is given this Discord role, and loses it
        when they leave. Clearing it takes the role off all of them.
      </p>
      {/* The four steps that end in "Copy Role ID" used to be one sentence
          here, which was the last of them. */}
      <div className="mb-4">
        <DiscordRoleHelp />
      </div>

      <form onSubmit={save} className="flex flex-wrap items-end gap-3">
        <div className="min-w-52 flex-1">
          <label htmlFor={`${id}-role`} className={labelClass}>
            ROLE ID
          </label>
          <input
            id={`${id}-role`}
            name="discordRoleId"
            inputMode="numeric"
            pattern="\d{17,20}"
            title="A Discord role id is 17-20 digits"
            defaultValue={project.discordRoleId ?? ''}
            placeholder="Not set"
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

  /**
   * Drawn as the destructive panel it is, matching `DeleteAccountPanel` — the other place on the
   * site where somebody can delete something that doesn't come back. It used to be the word
   * DANGER in grey over a text-link button that only turned red on hover.
   */
  return (
    <div className="border-error/40 bg-error/5 border p-5">
      <p className="text-error mb-3 font-mono text-[10px] font-medium tracking-[0.16em]">
        DELETE THIS PROJECT
      </p>

      <p className="text-dim mb-3 text-[13px] leading-[1.7] text-pretty">
        This deletes {title} for <strong>everyone on it</strong>, not just for
        you, and it cannot be undone.
      </p>

      <p className="text-faint mb-2 text-[12px] leading-[1.6]">What goes with it:</p>

      {/* Named one by one rather than summarised, the same rule the account panel follows: a lead
          is entitled to delete all of this and isn't entitled to be surprised by it. Every line is
          something the delete route actually destroys — the two file sweeps in particular, which
          are bytes no other copy exists of. */}
      <ul className="text-faint mb-3 list-disc space-y-1 pl-5 text-[12px] leading-[1.6]">
        <li>its roster and its teams, and every task on them</li>
        <li>every event it has scheduled, on every calendar they appear on</li>
        <li>
          its gallery, its cover and every published document — the club keeps no
          other copy of those files
        </li>
        <li>its write-up, its resource links and its page on the public site</li>
      </ul>

      <p className="text-faint mb-4 text-[12px] leading-[1.6] text-pretty">
        Everyone on it loses the project&rsquo;s Discord role. If the build is
        simply over, set its status to <strong>COMPLETED</strong> or{' '}
        <strong>ARCHIVED</strong> instead — that keeps the page and takes it off
        this term&rsquo;s list.
      </p>

      <button
        type="button"
        disabled={busy}
        className="btn btn-outline border-error/40 text-error hover:border-error hover:bg-error/10 hover:text-error h-auto min-h-0 cursor-pointer px-5 py-2.5 text-[11px] font-semibold tracking-[0.04em] disabled:opacity-50"
        onClick={() => void destroy()}
      >
        DELETE THIS PROJECT
      </button>

      {/* Said before the press as well as during it. The prompt is the guard;
          this is what stops somebody meeting it by surprise. */}
      <p className="text-faint mt-2 text-[12px] leading-[1.6]">
        You will be asked to type the project&rsquo;s name to confirm.
      </p>

      <p role="status" className="text-error mt-2 min-h-4 text-[12px]">
        {message}
      </p>
    </div>
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
          You hold the team-lead rank but no team.
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
            Everyone on the project is already seated.
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
