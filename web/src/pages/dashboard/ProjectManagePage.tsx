import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router'
import { ConfirmDialog } from '../../components/shared/ConfirmDialog'
import { DiscordRoleHelp } from '../../components/shared/DiscordRoleHelp'
import { EventCalendarCheckbox } from '../../components/shared/EventCalendarCheckbox'
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
  putJson,
} from '../../lib/api/api'
import type {
  ApiManagedProject,
  ApiMeEvent,
  ApiTermDates,
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
  eventInstants,
  isGeneratedMeeting,
  listedWhen,
  toDateInput,
  toEndDateInput,
  toTimeInput,
} from '../../lib/events/events'
import {
  formatCivilDate,
  formatMeetingRange,
  hasSchedule,
  meetingLine,
  meetingNote,
} from '../../lib/events/meetings'
import { draftBody, draftOf, draftProblem } from '../../lib/events/meetingDraft'
import { campusDateOf } from '../../lib/events/calendarLinks'
import { MeetingScheduleFields } from '../../components/projects/MeetingScheduleFields'
import { TASK_LABEL, isSettled } from '../../lib/tasks'
import type { ApiState } from '../../lib/api/useApi'
import { useApi } from '../../lib/api/useApi'
import { isOfficer } from '../../lib/auth/session'

/**
 * The lead's side of a project: members, teams, the meeting schedule and its meetings.
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

      {/* Eight sections, none of which reads on from the one above — a lead comes here to do one
          of them. Stacked, that meant scrolling past four panels to reach the fifth while the
          right half of the screen stayed empty. `items-start` keeps the short ones short: DISCORD
          ROLE is four lines and has no business being as tall as the roster. */}
      <div className="grid-fluid items-start gap-5 [--col-min:30rem]">
        {rank === 'PROJECT_LEAD' ? (
          <>
            <MembersSection teams={teams} members={members} projectId={projectId} projectSlug={project.slug} reload={load} />
            <TeamsSection teams={teams} members={members} projectId={projectId} reload={load} />
            <EventsSection projectId={projectId} teams={teams} rank={rank} myTeamId={myTeamId} />
            <TasksSection projectId={projectId} teams={teams} members={members} rank={rank} myTeamId={myTeamId} canCreate={canCreateTasks} />
            <MeetingSection project={project} reload={load} officer={officer} />
            {hasSchedule(project) && (
              <UpcomingMeetingsSection
                /* Keyed on the saved schedule, so saving a new one refetches the list. */
                key={JSON.stringify(draftBody(draftOf(project)))}
                projectId={projectId}
              />
            )}
            <DiscordRoleSection project={project} reload={load} />
            <DangerSection projectId={projectId} title={project.title} reloadProjects={reloadProjects} />
          </>
        ) : (
          <>
            <TeamLeadSection
              projectId={projectId}
              projectSlug={project.slug}
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

  return { message, setMessage, busy, run }
}

// ----------------------------------------------------------------- members

function MembersSection({
  teams,
  members,
  projectId,
  projectSlug,
  reload,
}: {
  teams: ApiProjectTeamView['teams']
  members: ApiProjectTeamMember[]
  projectId: string
  projectSlug: string
  reload: () => Promise<void>
}) {
  const { message, busy, run } = useSectionStatus()
  const [pendingOnly, setPendingOnly] = useState(false)
  const pending = members.filter((member) => !member.publiclyListed)
  const shown = pendingOnly ? pending : members

  const list = (member: ApiProjectTeamMember, publiclyListed: boolean) =>
    run(async () => {
      await patchJson(`/projects/${projectId}/members/${member.userId}/visibility`, {
        publiclyListed,
      })
      refreshPublicRoster(projectSlug)
      await reload()
    })

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
      <p className="mb-4 font-mono text-[10px] font-medium tracking-[0.16em] text-faint">
        MEMBERS
      </p>
      <p className="mb-3 text-[13px] leading-[1.6] text-dim">
        Anyone can join and get the Discord role. Approve public listing when they should
        appear on the website. Hiding a name keeps their membership and Discord role.
      </p>
      <label className="mb-3 flex cursor-pointer items-center gap-2 text-[12px] text-faint">
        <input
          type="checkbox"
          className="checkbox checkbox-xs"
          checked={pendingOnly}
          onChange={(event) => setPendingOnly(event.target.checked)}
        />
        Awaiting public listing only ({pending.length})
      </label>

      {shown.length === 0 ? (
        <p className="text-sm leading-[1.7] text-dim">
          {pendingOnly
            ? 'No members are awaiting public listing.'
            : 'Nobody has joined yet.'}
        </p>
      ) : (
        <ul className="divide-y divide-rule">
          {shown.map((member) => (
            <li
              key={member.userId}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 py-4"
            >
              <MemberSummary member={member} />

              <ListingControl
                member={member}
                busy={busy}
                onChange={(value) => void list(member, value)}
              />

              {member.rank === 'PROJECT_LEAD' ? (
                <p className="col-span-full text-[12px] text-faint">
                  Appointed by officers
                </p>
              ) : (
                <div className="col-span-full flex flex-wrap items-center gap-3">
                  <select
                    aria-label={`Team for ${member.fullName}`}
                    className={`${selectClass} min-w-0 flex-1 basis-40`}
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
                      onClick={() => void patch(member.userId, { rank: 'TEAM_LEAD' })}
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
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <p role="status" className="mt-2 min-h-4 text-[12px] text-error">
        {message}
      </p>
    </FormPanel>
  )
}

// ------------------------------------------------------------------- teams

/** Replace the browser's public detail cache after granting or withdrawing listing.
 * A refresh failure does not undo the saved decision; the private roster still reloads. */
function refreshPublicRoster(slug: string) {
  void getJson(`/projects/${slug}`, undefined, true).catch((error: unknown) => {
    console.error('Could not refresh the public roster', error)
  })
}

function MemberSummary({ member }: { member: ApiProjectTeamMember }) {
  return (
    <div className="min-w-0 flex-1 basis-40">
      <p className="truncate text-sm font-medium">{member.fullName}</p>
      <p className="flex flex-wrap items-center gap-x-2 text-faint">
        <span className="font-mono text-[10px] font-medium tracking-[0.14em] uppercase">
          {member.rank === 'PROJECT_LEAD'
            ? 'Project lead'
            : member.rank === 'TEAM_LEAD'
              ? 'Team lead'
              : (member.title ?? 'Member')}
        </span>
        <span aria-hidden="true" className="text-[11px]">
          |
        </span>
        <span className={`text-[11px] ${member.publiclyListed ? '' : 'text-primary'}`}>
          {member.publiclyListed ? 'Listed on website' : 'Awaiting public listing'}
        </span>
      </p>
    </div>
  )
}

function ListingControl({
  member,
  busy,
  onChange,
}: {
  member: ApiProjectTeamMember
  busy: boolean
  onChange: (publiclyListed: boolean) => void
}) {
  return (
    <button
      type="button"
      disabled={busy}
      className={smallButton}
      aria-label={`${member.publiclyListed ? 'Hide' : 'Approve'} ${member.fullName} ${member.publiclyListed ? 'on' : 'for'} public website`}
      onClick={() => onChange(!member.publiclyListed)}
    >
      {member.publiclyListed ? 'HIDE FROM WEBSITE' : 'APPROVE PUBLIC LISTING'}
    </button>
  )
}

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
  const { message, setMessage, busy, run } = useSectionStatus()
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

  const canPublish = rank === 'PROJECT_LEAD' ||
    (myTeamId !== null && (!editing || editing.teamId === myTeamId))

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

    const instants = eventInstants({
      date,
      start,
      endDate: text('endDate'),
      end: text('end'),
      allDay: false,
    })
    if ('error' in instants) {
      setMessage(instants.error)
      return
    }

    // Disabled selects are omitted by FormData. A team lead's pinned team
    // must come from their membership rather than the disabled picker.
    const teamValue = rank === 'TEAM_LEAD' ? myTeamId : text('team')

    const body = {
      title: text('title'),
      type: text('type') as EventType,
      location: text('location') || null,
      ...instants,
      ...(canPublish ? { published: data.get('published') === 'on' } : {}),
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
          Nothing scheduled yet. Check “Show on the main calendar” to make an event public.
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
                  {listedWhen(event)}
                  {' · '}
                  {teamName(event.teamId).toUpperCase()}
                  {' · '}
                  {event.published ? 'MAIN CALENDAR' : 'PROJECT ONLY'}
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
                      setMessage('')
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
      <form
        key={editing?.id ?? 'new'}
        onSubmit={submit}
        // A refusal is about what was typed, so it goes once the typing changes.
        onChange={() => {
          if (message) setMessage('')
        }}
        className="space-y-3"
      >
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

        {/* Grouped as start and end, so a wrapping row breaks between the two before it
            breaks inside either. Widths sit on the wrappers, since `fieldClass`'s `w-full`
            wins on the input itself. */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <label htmlFor={`${formId}-date`} className={labelClass}>
                START DATE
              </label>
              <input
                id={`${formId}-date`}
                name="date"
                type="date"
                required
                defaultValue={editing ? toDateInput(editing.startsAt) : ''}
                className={`${fieldClass} h-8`}
                disabled={busy}
              />
            </div>
            <div className="w-32">
              <label htmlFor={`${formId}-start`} className={labelClass}>
                START TIME
              </label>
              <input
                id={`${formId}-start`}
                name="start"
                type="time"
                required
                defaultValue={editing ? toTimeInput(editing.startsAt) : ''}
                className={`${fieldClass} h-8`}
                disabled={busy}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <label htmlFor={`${formId}-end-date`} className={labelClass}>
                END DATE
              </label>
              <input
                id={`${formId}-end-date`}
                name="endDate"
                type="date"
                defaultValue={editing ? toEndDateInput(editing) : ''}
                aria-describedby={`${formId}-end-date-hint`}
                className={`${fieldClass} h-8`}
                disabled={busy}
              />
            </div>
            <div className="w-32">
              <label htmlFor={`${formId}-end`} className={labelClass}>
                END TIME
              </label>
              <input
                id={`${formId}-end`}
                name="end"
                type="time"
                defaultValue={editing?.endsAt ? toTimeInput(editing.endsAt) : ''}
                className={`${fieldClass} h-8`}
                disabled={busy}
              />
            </div>
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
        <p
          id={`${formId}-end-date-hint`}
          className="text-faint text-[12px] leading-[1.5]"
        >
          Leave the end date empty for a one-day event.
        </p>

        {canPublish && (
          <EventCalendarCheckbox published={editing?.published} disabled={busy} />
        )}

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
                setMessage('')
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
  const [draft, setDraft] = useState(() => draftOf(project))
  const [fault, setFault] = useState('')
  const [removing, setRemoving] = useState(false)
  // The project's own term, not today's, so a lead planning next semester's dates sees
  // next semester. The picker works without it, and the server checks regardless.
  const term = useApi<ApiTermDates>(
    `/terms/${String(project.termYear)}/${project.termSeason}`,
  )

  const write = (body: Record<string, unknown>) =>
    run(async () => {
      const updated = await patchJson<ApiManagedProject>(
        `/projects/${project.id}`,
        body,
      )
      // What the server kept, which is tidier than what was typed: sorted, deduplicated,
      // and with the other patterns' fields emptied.
      setDraft(draftOf(updated))
      await reload()
      setSaved(true)
    })

  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const problem = draftProblem(draft)
    setFault(problem ?? '')
    setSaved(false)
    if (problem) return

    void write(draftBody(draft))
  }

  const line = meetingLine(project)
  const note = meetingNote(project)
  const scheduled = hasSchedule(project)

  return (
    <FormPanel>
      <p className="text-faint mb-1 font-mono text-[10px] font-medium tracking-[0.16em]">
        MEETING SCHEDULE
      </p>
      <p className="text-dim mb-4 text-[13px] leading-[1.6] text-pretty">
        Every member&rsquo;s calendar carries this, to the end of the semester.
      </p>

      <form onSubmit={save} className="space-y-4">
        <MeetingScheduleFields
          draft={draft}
          disabled={busy}
          term={term.status === 'ready' ? term.data : null}
          onChange={(next) => {
            setDraft(next)
            setFault('')
          }}
        />

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <button
            type="submit"
            disabled={busy}
            className="btn btn-primary btn-cta px-5 py-2.5 text-[12px] font-semibold disabled:opacity-60"
          >
            {busy ? 'SAVING…' : 'SAVE'}
          </button>
          {scheduled && (
            <button
              type="button"
              disabled={busy}
              className={`${dangerButton} ${focusRing} inline-flex min-h-11 items-center wide:min-h-0`}
              onClick={() => {
                setRemoving(true)
              }}
            >
              REMOVE SCHEDULE
            </button>
          )}
        </div>

        {/* Beside SAVE, whichever side refused: the form's own check or the server's,
            which is the only one that knows the term. At the foot of the panel it was
            off screen on a phone. */}
        <p role="status" className="min-h-4 text-[13px]">
          {fault || message ? (
            <span className="text-error">{fault || message}</span>
          ) : saved ? (
            <span className="text-success">Saved.</span>
          ) : (
            ''
          )}
        </p>
      </form>

      {removing && (
        <ConfirmDialog
          title="Remove the meeting schedule?"
          confirmLabel="REMOVE IT"
          busy={busy}
          onConfirm={() => {
            setSaved(false)
            // Closed either way, so a refusal lands in the status line beside SAVE
            // rather than behind the dialog.
            void write({ meetingRepeat: null }).then(() => {
              setRemoving(false)
            })
          }}
          onDismiss={() => {
            setRemoving(false)
          }}
        >
          <p>
            Every meeting comes off every calendar, and the place and note go with
            them.
          </p>
        </ConfirmDialog>
      )}

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

      {/* What the schedule actually produces, read back from the saved row rather than the form,
          and the bound nobody expects: the meetings stop at the end of the term. */}
      {line && (
        <div className="border-rule mt-4 border-t pt-3">
          <p className="text-faint text-[12px] leading-[1.5] text-pretty">
            {line}.
            {project.meetingRepeat !== 'DATES' &&
              ' It runs to the end of this project’s semester and skips finals week.'}
          </p>
          {/* Quoted rather than restated, so a lead can see the note as a
              member will read it. */}
          {note && (
            <p className="text-dim mt-1.5 text-[12px] leading-[1.5] text-pretty">
              {note}
            </p>
          )}
        </div>
      )}
    </FormPanel>
  )
}

/** How many of the term's meetings show before the list needs asking. */
const MEETING_ROWS = 6

/** The gold ring the rulebook asks of every hand-rolled control. */
const focusRing =
  'focus-visible:outline-primary focus-visible:outline-2 focus-visible:outline-offset-2'

/**
 * The rest of the term's meetings, one by one, so a lead can call one off without touching the
 * schedule: homecoming, a closed building, half the team away at a competition.
 *
 * A cancelled meeting stays on every calendar, marked, with the reason, and RESTORE puts it
 * back. Remounted by the caller whenever the saved schedule changes, which is what refetches it.
 *
 * The row button reads CALL OFF rather than CANCEL, so it can't be mistaken for dismissing the
 * form it opens. It stays mounted while that form is open, which is what focus goes back to.
 */
function UpcomingMeetingsSection({ projectId }: { projectId: string }) {
  const { message, busy, run } = useSectionStatus()
  const [meetings, setMeetings] = useState<ApiState<ApiMeEvent[]>>({
    status: 'loading',
  })
  const [expanded, setExpanded] = useState(false)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [done, setDone] = useState('')
  const id = useId()
  /** Each row's action button, by occurrence id, so focus can follow a row through a reload. */
  const actions = useRef(new Map<string, HTMLButtonElement>())
  const focusNext = useRef<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await getJson<ApiMeEvent[]>(`/projects/${projectId}/meetings`)
      setMeetings({ status: 'ready', data })
    } catch (error) {
      console.error(error)
      setMeetings({
        status: 'error',
        code: error instanceof ApiError ? error.status : 0,
      })
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  // After a cancel or a restore the row's button changes (CALL OFF for RESTORE), so the one
  // that had focus is gone. Put focus on its replacement once the list has redrawn.
  useEffect(() => {
    if (!focusNext.current) return
    actions.current.get(focusNext.current)?.focus()
    focusNext.current = null
  }, [meetings])

  /**
   * The campus date, which is what a cancellation is keyed on, rather than the reader's own
   * day: a lead away from Florida would otherwise see one date and cancel another.
   */
  const day = (event: ApiMeEvent) =>
    formatCivilDate(campusDateOf(event.startsAt), {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })

  const close = (event: ApiMeEvent) => {
    setCancelling(null)
    actions.current.get(event.id)?.focus()
  }

  const cancel = (event: ApiMeEvent) =>
    run(async () => {
      setDone('')
      await putJson(
        `/projects/${projectId}/meetings/${campusDateOf(event.startsAt)}/cancel`,
        { reason: reason.trim() || null },
      )
      setCancelling(null)
      setReason('')
      focusNext.current = event.id
      await load()
      setDone(`Cancelled ${day(event)}.`)
    })

  const restore = (event: ApiMeEvent) =>
    run(async () => {
      setDone('')
      await deleteJson(
        `/projects/${projectId}/meetings/${campusDateOf(event.startsAt)}/cancel`,
      )
      focusNext.current = event.id
      await load()
      setDone(`${day(event)} is back on.`)
    })

  const all = meetings.status === 'ready' ? meetings.data : []
  const shown = expanded ? all : all.slice(0, MEETING_ROWS)

  return (
    <FormPanel>
      <p className="text-faint mb-1 font-mono text-[10px] font-medium tracking-[0.16em]">
        UPCOMING MEETINGS
      </p>
      <p className="text-dim mb-3 text-[13px] leading-[1.6] text-pretty">
        Call off one meeting without changing the schedule. It stays on the
        calendar, marked cancelled.
      </p>

      {meetings.status === 'loading' && (
        <div aria-busy="true" className="space-y-2">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="bg-base-300 h-9 animate-pulse rounded-[2px]" />
          ))}
        </div>
      )}

      {meetings.status === 'error' && (
        <p className="text-faint text-[13px]">
          Couldn&rsquo;t load the meetings just now.
        </p>
      )}

      {meetings.status === 'ready' && all.length === 0 && (
        <p className="text-faint text-[13px]">No meetings left this semester.</p>
      )}

      {shown.length > 0 && (
        <ul>
          {shown.map((event) => {
            const open = cancelling === event.id
            const when = `${day(event)} · ${
              event.meeting
                ? formatMeetingRange(event.meeting.startTime, event.meeting.endTime)
                : ''
            }`
            const keep = (node: HTMLButtonElement | null) => {
              if (node) actions.current.set(event.id, node)
              else actions.current.delete(event.id)
            }

            return (
              <li key={event.id} className="border-rule border-t py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <div className="min-w-0">
                    <p
                      className={`text-[13px] ${
                        event.cancelled ? 'text-faint line-through' : ''
                      }`}
                    >
                      {when}
                    </p>
                    {event.cancelled && (
                      <p className="text-dim text-[12px] leading-[1.5]">
                        <span className="text-error font-mono text-[10px] font-medium tracking-[0.14em]">
                          CANCELLED
                        </span>
                        {event.cancelled.reason && ` · ${event.cancelled.reason}`}
                      </p>
                    )}
                  </div>

                  {event.cancelled ? (
                    <button
                      ref={keep}
                      type="button"
                      disabled={busy}
                      className={`${smallButton} ${focusRing} min-h-11 wide:min-h-0`}
                      aria-label={`Restore ${day(event)}`}
                      onClick={() => void restore(event)}
                    >
                      RESTORE
                    </button>
                  ) : (
                    <button
                      ref={keep}
                      type="button"
                      disabled={busy}
                      aria-expanded={open}
                      className={`${open ? smallButton : dangerButton} ${focusRing} min-h-11 wide:min-h-0`}
                      aria-label={`Call off ${day(event)}`}
                      onClick={() => {
                        if (open) {
                          close(event)
                          return
                        }
                        // Opening a second row drops the first one's reason, so say
                        // nothing was typed rather than carry it to another date.
                        setCancelling(event.id)
                        setReason('')
                      }}
                    >
                      CALL OFF
                    </button>
                  )}
                </div>

                {open && (
                  <form
                    className="mt-2 flex flex-wrap items-end gap-2"
                    onSubmit={(submit) => {
                      submit.preventDefault()
                      void cancel(event)
                    }}
                    onKeyDown={(key) => {
                      if (key.key === 'Escape') close(event)
                    }}
                  >
                    <div className="min-w-44 flex-1">
                      <label htmlFor={`${id}-reason`} className={labelClass}>
                        REASON (OPTIONAL)
                      </label>
                      <input
                        id={`${id}-reason`}
                        autoFocus
                        maxLength={200}
                        value={reason}
                        disabled={busy}
                        placeholder="Homecoming"
                        onChange={(change) => {
                          setReason(change.target.value)
                        }}
                        className={fieldClass}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={busy}
                      className="btn btn-outline border-error/40 text-error hover:border-error hover:bg-error/10 hover:text-error h-auto min-h-11 cursor-pointer px-4 py-2 text-[11px] font-semibold tracking-[0.04em] disabled:opacity-50 wide:min-h-10"
                    >
                      CANCEL MEETING
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className={`${smallButton} ${focusRing} min-h-11 px-2 wide:min-h-10`}
                      onClick={() => {
                        close(event)
                      }}
                    >
                      KEEP IT
                    </button>
                  </form>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {all.length > MEETING_ROWS && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded(!expanded)
          }}
          className={`text-primary ${focusRing} mt-2 inline-flex min-h-11 cursor-pointer items-center font-mono text-[10px] font-medium tracking-[0.14em] wide:min-h-0`}
        >
          {/* The underline is on the words, so a phone-sized hit area doesn't push it
              a thumb's width away from them. */}
          <span className="border-primary/40 hover:border-primary border-b pb-0.5 transition-colors duration-200">
            {expanded ? 'SHOW FEWER' : `SHOW ALL ${String(all.length)}`}
          </span>
        </button>
      )}

      <p role="status" className="mt-2 min-h-4 text-[12px]">
        {message ? (
          <span className="text-error">{message}</span>
        ) : done ? (
          <span className="text-success">{done}</span>
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
  projectId,
  projectSlug,
  teamId,
  teams,
  members,
  reload,
}: {
  projectId: string
  projectSlug: string
  teamId: string | null
  teams: ApiProjectTeamView['teams']
  members: ApiProjectTeamMember[]
  reload: () => Promise<void>
}) {
  const { message, busy, run } = useSectionStatus()

  if (!teamId) {
    return (
      <FormPanel>
        <p className="text-sm leading-[1.7] text-pretty text-dim">
          You hold the team-lead rank but no team.
        </p>
      </FormPanel>
    )
  }

  const team = teams.find((t) => t.id === teamId)
  const onTeam = members.filter((m) => m.teamId === teamId)
  const available = members.filter((m) => m.teamId === null && m.rank === 'MEMBER')

  const move = (userId: string, direction: 'add' | 'remove') =>
    run(async () => {
      if (direction === 'add') {
        await postJson(`/teams/${teamId}/members/${userId}`, {})
      } else {
        await deleteJson(`/teams/${teamId}/members/${userId}`)
      }
      await reload()
    })

  const list = (member: ApiProjectTeamMember, publiclyListed: boolean) =>
    run(async () => {
      await patchJson(`/projects/${projectId}/members/${member.userId}/visibility`, {
        publiclyListed,
      })
      refreshPublicRoster(projectSlug)
      await reload()
    })

  return (
    <>
      <FormPanel>
        <p className="mb-4 font-mono text-[10px] font-medium tracking-[0.16em] text-faint uppercase">
          {team ? `YOUR TEAM — ${team.name}` : 'YOUR TEAM'}
        </p>
        <p className="mb-3 text-[13px] leading-[1.6] text-dim">
          Approve public website listing for members of your team. Joining and the Discord
          role stay open to everyone. Add an unassigned member to your team first.
        </p>

        {onTeam.length === 0 ? (
          <p className="text-sm leading-[1.7] text-dim">Nobody here yet.</p>
        ) : (
          <ul className="divide-y divide-rule">
            {onTeam.map((member) => (
              <li
                key={member.userId}
                className="flex flex-wrap items-center justify-between gap-4 py-2.5"
              >
                <MemberSummary member={member} />
                {member.rank === 'MEMBER' && (
                  <>
                    <ListingControl
                      member={member}
                      busy={busy}
                      onChange={(value) => void list(member, value)}
                    />
                    <button
                      type="button"
                      disabled={busy}
                      className={dangerButton}
                      onClick={() => void move(member.userId, 'remove')}
                    >
                      REMOVE
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <p role="status" className="mt-2 min-h-4 text-[12px] text-error">
          {message}
        </p>
      </FormPanel>

      <FormPanel>
        <p className="mb-4 font-mono text-[10px] font-medium tracking-[0.16em] text-faint">
          NOT ON A TEAM YET
        </p>

        {available.length === 0 ? (
          <p className="text-sm leading-[1.7] text-pretty text-dim">
            Everyone on the project is already seated.
          </p>
        ) : (
          <ul className="divide-y divide-rule">
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

        <p role="status" className="mt-2 min-h-4 text-[12px] text-error">
          {message}
        </p>
      </FormPanel>
    </>
  )
}
