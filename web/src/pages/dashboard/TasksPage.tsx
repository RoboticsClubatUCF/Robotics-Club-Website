import { useCallback, useEffect, useId, useState } from 'react'
import { Link, useOutletContext } from 'react-router'
import type {
  ApiMyProject,
  ApiOfficerMember,
  ApiProject,
  ApiProjectTeamView,
  ApiTask,
  ApiUser,
  TaskStatus,
} from '../../lib/api/api'
import { deleteJson, getJson, patchJson, postJson } from '../../lib/api/api'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { ConfirmDialog } from '../../components/shared/ConfirmDialog'
import { FilterChips } from '../../components/shared/FilterChips'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  fieldClass,
  labelClass,
} from '../../components/shared/formChrome'
import { MemberSearch } from '../../components/shared/MemberSearch'
import { hits } from '../../lib/equipment/catalogue'
import { STATUS_TONE } from '../../lib/format/formats'
import { toDateInput, toTimeInput } from '../../lib/events/events'
import { useSectionStatus } from '../../lib/useSectionStatus'
import {
  TASK_LABEL,
  TASK_STATUSES,
  dueInstant,
  dueLabel,
  isOverdue,
  isSettled,
  whereLabel,
} from '../../lib/tasks'
import { isOfficer } from '../../lib/auth/session'

/**
 * `/dashboard/tasks` — everything with somebody's name on it, in one list.
 *
 * **One page for everybody**, branching on what the reader may *do* rather than
 * on who they are, which is the overview's rule. A member gets their own work
 * and the controls to move it between labels; anybody who runs a project or
 * sits on the board gets a scope switch and the form that writes new tasks.
 * Two pages would have meant two lists of the same rows.
 *
 * It sits in `/ GENERAL` and is never dues-locked. The server does not gate
 * reading a task, and drawing a padlock on a door that is not locked is worse
 * than no padlock at all.
 *
 * Every refusal here is cosmetic. `requireTaskManager` and the assignee check
 * in `server/src/routes/projects/tasks.ts` are what actually refuse, and the
 * two must agree — `canManage` below is the mirror, and the shape of it is the
 * thing to keep in step if either moves.
 */

type Scope = 'mine' | 'managed' | 'all'
type StatusFilter = TaskStatus | 'ALL'

const SCOPES: readonly { value: Scope; label: string }[] = [
  { value: 'mine', label: 'ASSIGNED TO ME' },
  { value: 'managed', label: 'WORK I RUN' },
  { value: 'all', label: 'BOTH' },
]

/**
 * ALL first, then the labels in the enum's own order — which is the order rows
 * arrive in, so the chips read down the list the same way the list does.
 */
const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: 'ALL', label: 'ALL' },
  ...TASK_STATUSES.map((status) => ({
    value: status as StatusFilter,
    label: TASK_LABEL[status].text,
  })),
]

export function TasksPage() {
  const { user, projects } = useOutletContext<DashboardContext>()

  const officer = isOfficer(user.role)
  const mine = projects.status === 'ready' ? projects.data : []
  // Read off the membership rows, never off `user.role` — no club role says
  // anything about any project, which is the rule this codebase states most.
  const leads = mine.filter(({ rank }) => rank !== 'MEMBER')

  // Nothing until the memberships land. Drawing the member's version first and
  // then growing a create panel under a lead's cursor is worse than a moment
  // of skeleton, and an officer needs no memberships to be sure.
  if (!officer && projects.status !== 'ready') {
    return (
      <div aria-busy="true" className="border-rule bg-base-200 h-64 border" />
    )
  }

  return <Tasks user={user} officer={officer} leads={leads} />
}

function Tasks({
  user,
  officer,
  leads,
}: {
  user: ApiUser
  officer: boolean
  leads: ApiMyProject[]
}) {
  const id = useId()
  const { message, busy, run } = useSectionStatus()

  const [scope, setScope] = useState<Scope>('mine')
  const [status, setStatus] = useState<StatusFilter>('ALL')
  const [query, setQuery] = useState('')
  const [tasks, setTasks] = useState<ApiTask[] | null | 'loading'>('loading')
  const [editing, setEditing] = useState<ApiTask | null>(null)
  const [pending, setPending] = useState<ApiTask | null>(null)

  const canWrite = officer || leads.length > 0

  /**
   * Where a *new* task may go, which is not the same list as what somebody
   * runs.
   *
   * A project belongs to a term and a build that ran three semesters is three
   * rows, so the server refuses a new task on any project but this semester's.
   * `leads` stays the wider list on purpose — last spring's board is still
   * theirs to tick, edit and tidy — and only the create form narrows.
   * `current` is computed server-side against `currentTerm()`, so this picker
   * and that refusal are reading one answer.
   */
  const writable = leads.filter(({ current }) => current)

  /**
   * Every label in one request, narrowed in the browser.
   *
   * The equipment page's call rather than the print queue's, and for its
   * reason: this is one person's work rather than a club-wide queue, so the
   * list is short enough to send whole — and a status chip that refetched
   * would put a network round trip behind a filter that is pure arithmetic.
   * Only `scope` changes which *rows* exist, so only `scope` reloads.
   */
  const load = useCallback(async () => {
    try {
      setTasks(
        await getJson<ApiTask[]>(`/me/tasks?scope=${scope}&status=all&limit=200`),
      )
    } catch (error) {
      console.error(error)
      setTasks(null)
    }
  }, [scope])

  useEffect(() => {
    void load()
  }, [load])

  const assignedToMe = (task: ApiTask) =>
    task.assignees.some((who) => who.userId === user.id)

  /**
   * The mirror of `requireTaskManager`. Officers everywhere; a project lead
   * anywhere in their project; a team lead on their own team and nowhere else;
   * and a task with no project is the officers', because there is no
   * membership row to read a rank off.
   */
  const canManage = (task: ApiTask) => {
    if (officer) return true
    if (task.projectId === null) return false

    return leads.some(
      ({ project, rank, team }) =>
        project.id === task.projectId &&
        (rank === 'PROJECT_LEAD' ||
          (task.teamId !== null && team?.id === task.teamId)),
    )
  }

  const rows = Array.isArray(tasks)
    ? tasks.filter(
        (task) =>
          (status === 'ALL' || task.status === status) &&
          hits(
            [
              task.title,
              task.details,
              task.project?.title,
              task.team?.name,
              ...task.assignees.map((who) => who.fullName),
            ],
            query,
          ),
      )
    : []

  const move = (task: ApiTask, next: TaskStatus) =>
    run(async () => {
      await postJson(`/tasks/${task.id}/status`, { status: next })
      await load()
    })

  const flipCalendar = (task: ApiTask, onCalendar: boolean) =>
    run(async () => {
      await postJson(`/tasks/${task.id}/calendar`, { onCalendar })
      await load()
    })

  const remove = (task: ApiTask) =>
    run(async () => {
      await deleteJson(`/tasks/${task.id}`)
      if (editing?.id === task.id) setEditing(null)
      setPending(null)
      await load()
    })

  return (
    <>
      <FormEyebrow>/ TASKS</FormEyebrow>
      <FormHeading>
        {canWrite ? 'What is owed, and who owes it.' : 'What you have been asked to do.'}
      </FormHeading>

      <div className="mb-4 space-y-3">
        <FilterChips
          label="LABEL"
          options={STATUS_FILTERS}
          value={status}
          onChange={setStatus}
          disabled={busy}
        />

        {/* Only for somebody with a second list to look at. A member has one
            scope and a switch offering it back to them says nothing. */}
        {canWrite && (
          <FilterChips
            label="SHOW"
            options={SCOPES}
            value={scope}
            onChange={setScope}
            disabled={busy}
          />
        )}
      </div>

      {/* Capped, unlike the list under it. `fieldClass` is `w-full`, and a
          search box the width of a monitor looks like the page's main event
          rather than the thing you narrow it with. */}
      <div className="mb-5 max-w-[46rem]">
        <label htmlFor={`${id}-search`} className="sr-only">
          Search tasks
        </label>
        <input
          id={`${id}-search`}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
          }}
          placeholder="Search — title, details, project, team, who it is for"
          className={fieldClass}
        />
        <p className="text-faint mt-1 text-[12px] leading-[1.5]">
          {status === 'ALL'
            ? 'Searches every label — open, in progress, delayed, done and cancelled.'
            : `Searches ${TASK_LABEL[status].text.toLowerCase()} tasks only.`}
        </p>
      </div>

      <FormPanel>
        {tasks === 'loading' && (
          <div aria-busy="true" className="space-y-2.5">
            <div className="bg-base-300 h-4 w-2/3 animate-pulse rounded-[2px]" />
            <div className="bg-base-300 h-3 w-1/2 animate-pulse rounded-[2px]" />
          </div>
        )}

        {tasks === null && (
          <p className="text-dim text-sm leading-[1.7]">
            We couldn&apos;t load your tasks just now.
          </p>
        )}

        {Array.isArray(tasks) &&
          (rows.length === 0 ? (
            <p className="text-dim text-sm leading-[1.7]">
              {query.trim() !== '' || status !== 'ALL'
                ? 'Nothing matches what you are looking for.'
                : scope === 'managed'
                  ? 'Nothing on the boards you run.'
                  : 'Nothing on your list. Enjoy it.'}
            </p>
          ) : (
            <ul className="grid-fluid items-start gap-4 [--col-min:28rem]">
              {rows.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  busy={busy}
                  mine={assignedToMe(task)}
                  manage={canManage(task)}
                  onMove={move}
                  onCalendar={flipCalendar}
                  onEdit={setEditing}
                  onDelete={setPending}
                />
              ))}
            </ul>
          ))}
      </FormPanel>

      <p role="status" className="text-error mt-3 min-h-4 text-[12px]">
        {message}
      </p>

      {canWrite && (
        <div className="mt-6">
          <TaskForm
            officer={officer}
            leads={writable}
            editing={editing}
            onCancel={() => {
              setEditing(null)
            }}
            onSaved={async () => {
              setEditing(null)
              await load()
            }}
          />
        </div>
      )}

      {pending && (
        <ConfirmDialog
          title="Delete this task?"
          confirmLabel="DELETE IT"
          onConfirm={() => void remove(pending)}
          onDismiss={() => {
            setPending(null)
          }}
        >
          <p className="text-dim text-sm leading-[1.7]">
            <span className="text-base-content font-medium">
              {pending.title}
            </span>{' '}
            goes for good, along with the record that anybody was asked to do
            it. If the work is simply not happening, CANCELLED says that and
            keeps the history.
          </p>
        </ConfirmDialog>
      )}
    </>
  )
}

/**
 * One task.
 *
 * The strikethrough-and-fade treatment the project board already uses for
 * settled work, plus the label chip the print and equipment queues use — this
 * page is the third desk of that shape and copying the vocabulary is the point.
 */
function TaskRow({
  task,
  busy,
  mine,
  manage,
  onMove,
  onCalendar,
  onEdit,
  onDelete,
}: {
  task: ApiTask
  busy: boolean
  mine: boolean
  manage: boolean
  onMove: (task: ApiTask, next: TaskStatus) => Promise<void>
  onCalendar: (task: ApiTask, on: boolean) => Promise<void>
  onEdit: (task: ApiTask) => void
  onDelete: (task: ApiTask) => void
}) {
  const id = useId()
  const label = TASK_LABEL[task.status]
  const settled = isSettled(task.status)
  const overdue = isOverdue(task)
  const onMyCalendar =
    task.assignees.find((who) => who.onCalendar && mine) !== undefined

  return (
    <li className="border-rule border-t pt-3">
      <div className={settled ? 'opacity-50' : ''}>
        <div className="flex items-start justify-between gap-3">
          <p
            className={`min-w-0 flex-1 text-sm leading-snug font-medium ${settled ? 'line-through' : ''}`}
          >
            {task.title}
          </p>
          <span
            className={`${STATUS_TONE[label.tone]} shrink-0 font-mono text-[10px] font-medium tracking-[0.16em]`}
          >
            {label.text}
          </span>
        </div>

        <p className="text-faint mt-0.5 font-mono text-[10px] font-medium tracking-[0.12em] uppercase">
          {[
            whereLabel(task),
            task.team?.name ?? null,
            task.assignees.map((who) => who.fullName).join(', ') || 'Unassigned',
            task.dueAt === null ? null : `Due ${dueLabel(task.dueAt)}`,
            task.status === 'DONE' && task.completedByName !== null
              ? `Done — ${task.completedByName}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>

        {/* Its own line and its own colour, because it is the one fact on the
            row that changes what somebody does next. Folded into the meta line
            above it would be the fifth item in a grey run-on. */}
        {overdue && (
          <p className="text-error mt-1 font-mono text-[10px] font-medium tracking-[0.14em]">
            PAST ITS DEADLINE
          </p>
        )}

        {task.details !== null && task.details !== '' && (
          <p className="text-dim mt-2 max-w-[42rem] text-sm leading-[1.6] text-pretty">
            {task.details}
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {(mine || manage) && (
          <div className="flex items-center gap-2">
            <label
              htmlFor={`${id}-status`}
              className="text-faint font-mono text-[10px] font-medium tracking-[0.14em]"
            >
              LABEL
            </label>
            <select
              id={`${id}-status`}
              value={task.status}
              disabled={busy}
              onChange={(event) => {
                void onMove(task, event.target.value as TaskStatus)
              }}
              className="select border-rule bg-base-200 h-8 min-h-0 text-[12px]"
            >
              {TASK_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {TASK_LABEL[value].text}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Only on work that is mine and has a deadline to put anywhere. The
            wording says where it goes, because "add to calendar" beside an
            .ics button on every other list on this site would be two different
            promises spelled the same way. */}
        {mine && task.dueAt !== null && !isSettled(task.status) && (
          <label className="flex cursor-pointer items-center gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={onMyCalendar}
              disabled={busy}
              onChange={(event) => {
                void onCalendar(task, event.target.checked)
              }}
              className="checkbox checkbox-xs rounded-[2px]"
            />
            <span className="text-dim">Show on my calendar</span>
          </label>
        )}

        {manage && (
          <>
            <button
              type="button"
              disabled={busy}
              className="text-faint hover:text-primary ml-auto cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50"
              onClick={() => {
                onEdit(task)
              }}
            >
              EDIT
            </button>
            <button
              type="button"
              disabled={busy}
              className="text-faint hover:text-error cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50"
              onClick={() => {
                onDelete(task)
              }}
            >
              DELETE
            </button>
          </>
        )}
      </div>
    </li>
  )
}

/**
 * The form that writes one, and the form that edits one.
 *
 * A task **stays where it was written** — the server's `PATCH` omits both
 * `projectId` and `teamId`, exactly as the events desk does — so editing shows
 * where it lives as a fact rather than as a picker. Moving a task between
 * projects is not a thing the club does; recreating it is.
 *
 * **`leads` here is the current-term subset**, not everything the caller runs:
 * a new task may only go on a project running this semester, and the server
 * answers 409 for any other. Editing is unaffected and deliberately so, which
 * is why the early return below is guarded on there being nothing to *create*
 * against rather than on the list being empty.
 */
function TaskForm({
  officer,
  leads,
  editing,
  onCancel,
  onSaved,
}: {
  officer: boolean
  leads: ApiMyProject[]
  editing: ApiTask | null
  onCancel: () => void
  onSaved: () => Promise<void>
}) {
  const id = useId()
  const { message, busy, run } = useSectionStatus()

  // Fixed while editing: the row already knows where it lives.
  const [projectId, setProjectId] = useState('')
  const [roster, setRoster] = useState<ApiProjectTeamView | null>(null)
  const [all, setAll] = useState<ApiProject[]>([])
  const [picked, setPicked] = useState<ApiOfficerMember | null>(null)
  /**
   * Who a project-less task is for.
   *
   * Just a name and an id, rather than the `ApiOfficerMember` the picker hands
   * over: the extra columns on that type are what the *search* answers with —
   * a dues date and a club role — and keeping them here would mean inventing
   * both when this list is seeded from a task that already exists.
   */
  const [direct, setDirect] = useState<{ id: string; fullName: string }[]>([])

  const project = editing === null ? projectId : (editing.projectId ?? '')

  /**
   * An officer may write against a project they are not on, so their picker
   * cannot come from `/me/projects`. The public listing is the whole
   * current-term set and is already cached; a lead's picker needs no request
   * at all, since the rail's memberships are the answer.
   */
  useEffect(() => {
    if (!officer) return

    let alive = true
    getJson<ApiProject[]>('/projects?term=current&limit=100')
      .then((rows) => {
        if (alive) setAll(rows)
      })
      .catch((error: unknown) => {
        console.error(error)
      })

    return () => {
      alive = false
    }
  }, [officer])

  /** The roster is who may be assigned, and the teams are where it may land. */
  useEffect(() => {
    if (project === '') {
      setRoster(null)
      return
    }

    let alive = true
    getJson<ApiProjectTeamView>(`/projects/${project}/team`)
      .then((view) => {
        if (alive) setRoster(view)
      })
      .catch((error: unknown) => {
        console.error(error)
        if (alive) setRoster(null)
      })

    return () => {
      alive = false
    }
  }, [project])

  /** Seed the people box when an existing project-less task opens for editing. */
  useEffect(() => {
    setDirect(
      editing !== null && editing.projectId === null
        ? editing.assignees.map((who) => ({
            id: who.userId,
            fullName: who.fullName,
          }))
        : [],
    )
    setPicked(null)
  }, [editing])

  const myMembership = leads.find(({ project: row }) => row.id === project)
  const teamLeadOnly =
    !officer && myMembership !== undefined && myMembership.rank === 'TEAM_LEAD'

  const options = officer
    ? all.map((row) => ({ id: row.id, title: row.title }))
    : leads.map(({ project: row }) => ({ id: row.id, title: row.title }))

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)

    const title = data.get('title')
    if (typeof title !== 'string' || title.trim() === '') return

    const details = data.get('details')
    const date = data.get('due')
    const time = data.get('dueTime')
    const team = data.get('team')

    const assigneeIds =
      project === ''
        ? direct.map((who) => who.id)
        : data
            .getAll('assignee')
            .filter((value): value is string => typeof value === 'string')

    const body = {
      title: title.trim(),
      details:
        typeof details === 'string' && details.trim() !== ''
          ? details.trim()
          : null,
      dueAt: dueInstant(
        typeof date === 'string' ? date : '',
        typeof time === 'string' ? time : '',
      ),
      assigneeIds,
    }

    void run(async () => {
      if (editing !== null) {
        await patchJson(`/tasks/${editing.id}`, body)
      } else if (project === '') {
        await postJson('/tasks', body)
      } else {
        await postJson(`/projects/${project}/tasks`, {
          ...body,
          teamId:
            teamLeadOnly && myMembership.team !== null
              ? myMembership.team.id
              : typeof team === 'string' && team !== ''
                ? team
                : null,
        })
      }

      form.reset()
      setDirect([])
      setProjectId('')
      await onSaved()
    })
  }

  // Nothing of theirs is running this semester, so there is no project a new
  // task could go on. Said in words rather than drawn as an empty picker over
  // a button that would 409 — and it says what they *can* still do, because
  // last term's boards are right there in the list above.
  if (!officer && editing === null && leads.length === 0) {
    return (
      <FormPanel>
        <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]">
          NEW TASK
        </p>
        <p className="text-dim text-sm leading-[1.7] text-pretty">
          New tasks go on a project running this semester, and none of yours is
          this term. Last term&apos;s boards are still yours to tick off, edit
          and tidy up — they are in the list above.
        </p>
      </FormPanel>
    )
  }

  return (
    <FormPanel>
      <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]">
        {editing === null ? 'NEW TASK' : `EDITING — ${editing.title.toUpperCase()}`}
      </p>

      <form key={editing?.id ?? 'new'} onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 wide:grid-cols-2">
          <div>
            <label htmlFor={`${id}-project`} className={labelClass}>
              PROJECT
            </label>
            {editing === null ? (
              <select
                id={`${id}-project`}
                value={projectId}
                disabled={busy}
                onChange={(event) => {
                  setProjectId(event.target.value)
                }}
                className="select border-rule bg-base-200 w-full text-sm"
              >
                {/* Officers only. A lead's authority comes from a project, so
                    for them there is no such thing as a task without one — the
                    server says the same and says it first. */}
                {officer && <option value="">No project — the club&apos;s own work</option>}
                {!officer && <option value="">Pick a project</option>}
                {options.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.title}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-dim py-2 text-sm">
                {editing.project?.title ?? "The club's own work"}
                {editing.team !== null && ` · ${editing.team.name}`}
              </p>
            )}
          </div>

          <div>
            <label htmlFor={`${id}-title`} className={labelClass}>
              WHAT NEEDS DOING
            </label>
            <input
              id={`${id}-title`}
              name="title"
              required
              maxLength={200}
              placeholder="CAD the chassis"
              defaultValue={editing?.title ?? ''}
              className={fieldClass}
              disabled={busy}
            />
          </div>
        </div>

        <div className="grid gap-3 wide:grid-cols-2">
          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor={`${id}-due`} className={labelClass}>
                DUE
              </label>
              <input
                id={`${id}-due`}
                name="due"
                type="date"
                defaultValue={
                  editing?.dueAt != null ? toDateInput(editing.dueAt) : ''
                }
                className={fieldClass}
                disabled={busy}
              />
            </div>
            <div className="flex-1">
              <label htmlFor={`${id}-due-time`} className={labelClass}>
                BY (OPTIONAL)
              </label>
              <input
                id={`${id}-due-time`}
                name="dueTime"
                type="time"
                defaultValue={
                  editing?.dueAt != null ? toTimeInput(editing.dueAt) : ''
                }
                className={fieldClass}
                disabled={busy}
              />
              <p className="text-faint mt-1 text-[11px] leading-[1.5]">
                End of the day if you leave it blank.
              </p>
            </div>
          </div>

          {/* A team lead's tasks land on their own team whatever this said, so
              they are not asked. The server refuses any other answer. */}
          {editing === null && project !== '' && !teamLeadOnly && (
            <div>
              <label htmlFor={`${id}-team`} className={labelClass}>
                TEAM
              </label>
              <select
                id={`${id}-team`}
                name="team"
                defaultValue=""
                className="select border-rule bg-base-200 w-full text-sm"
                disabled={busy}
              >
                <option value="">Whole project</option>
                {(roster?.teams ?? []).map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div>
          <label htmlFor={`${id}-details`} className={labelClass}>
            DETAILS (OPTIONAL)
          </label>
          <textarea
            id={`${id}-details`}
            name="details"
            maxLength={5000}
            rows={2}
            placeholder="Links, where to start, what done looks like"
            defaultValue={editing?.details ?? ''}
            className="textarea border-rule bg-base-200 w-full text-sm"
            disabled={busy}
          />
        </div>

        {project === '' ? (
          <fieldset>
            <legend className={labelClass}>ASSIGN TO</legend>
            {/* No roster to tick through, so the club is the list. Officer-gated
                on the server, which is the same audience this branch is. */}
            <MemberSearch
              label="ADD SOMEBODY"
              picked={picked}
              disabled={busy}
              onPick={(member) => {
                setPicked(null)
                if (
                  member !== null &&
                  !direct.some((who) => who.id === member.id)
                ) {
                  setDirect([...direct, member])
                }
              }}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {direct.map((who) => (
                <button
                  key={who.id}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setDirect(direct.filter((one) => one.id !== who.id))
                  }}
                  className="border-rule text-dim hover:border-error hover:text-error cursor-pointer border px-2.5 py-1 text-[12px] transition-colors duration-200 disabled:opacity-50"
                >
                  {who.fullName} ✕
                </button>
              ))}
            </div>
            {direct.length === 0 && (
              <p className="text-faint mt-1 text-[11px] leading-[1.5]">
                A task with no project has to belong to somebody.
              </p>
            )}
          </fieldset>
        ) : (
          <fieldset>
            <legend className={labelClass}>ASSIGN TO</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
              {(roster?.members ?? []).map((member) => (
                <label
                  key={member.userId}
                  className="flex cursor-pointer items-center gap-2 text-[13px]"
                >
                  <input
                    type="checkbox"
                    name="assignee"
                    value={member.userId}
                    defaultChecked={
                      editing?.assignees.some(
                        (who) => who.userId === member.userId,
                      ) ?? false
                    }
                    disabled={busy}
                    className="checkbox checkbox-xs rounded-[2px]"
                  />
                  {member.fullName}
                </label>
              ))}
              {roster === null && (
                <p className="text-faint text-[12px]">
                  Pick a project and its members appear here.
                </p>
              )}
            </div>
          </fieldset>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy || (editing === null && !officer && project === '')}
            className="btn btn-primary btn-cta px-5 py-2.5 text-[12px] font-semibold disabled:opacity-60"
          >
            {editing === null ? 'CREATE TASK' : 'SAVE'}
          </button>
          {editing !== null && (
            <button
              type="button"
              disabled={busy}
              className="text-faint hover:text-primary cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50"
              onClick={onCancel}
            >
              CANCEL
            </button>
          )}
          <Link
            to="/dashboard"
            className="text-faint hover:text-primary ml-auto font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200"
          >
            BACK TO OVERVIEW
          </Link>
        </div>
      </form>

      <p role="status" className="text-error mt-2 min-h-4 text-[12px]">
        {message}
      </p>
    </FormPanel>
  )
}
