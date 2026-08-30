import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  measureClass,
} from '../../components/shared/formChrome'
import { LeaveProjectButton } from '../../components/shared/LeaveProjectButton'
import { getJson, postJson } from '../../lib/api/api'
import type { ApiMyProject, ApiProjectTeamView, ApiTask } from '../../lib/api/api'
import { meetingLine } from '../../lib/events/meetings'
import { TASK_LABEL, isSettled } from '../../lib/tasks'
import { useApi } from '../../lib/api/useApi'

/**
 * One project, as a member of it: who is on it, in which teams, and when it
 * meets. The management controls live on the sibling `/manage` page — this one
 * is for the ordinary member whose questions are "who do I ask" and "when do
 * we meet".
 */
export function ProjectDashboardPage() {
  const { slug = '' } = useParams()
  const { projects } = useOutletContext<DashboardContext>()

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
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            We couldn't load your projects just now. Try again in a moment.
          </p>
        </FormPanel>
      </div>
    )
  }

  const mine = projects.data.find((m) => m.project.slug === slug)

  if (!mine) {
    return (
      <>
        <FormEyebrow>/ PROJECT</FormEyebrow>
        <FormHeading>You're not on this project.</FormHeading>
        <div className={measureClass}>
          <FormPanel>
            <p className="text-dim text-sm leading-[1.7] text-pretty">
              Its public page has the join button, if it is taking people.{' '}
              <Link
                to={`/projects/${slug}`}
                className="text-primary underline underline-offset-2"
              >
                Open the project page
              </Link>
              .
            </p>
          </FormPanel>
        </div>
      </>
    )
  }

  return <ProjectHome membership={mine} />
}

function ProjectHome({ membership }: { membership: ApiMyProject }) {
  const { project, rank, title, team } = membership

  const standing = [
    rank === 'PROJECT_LEAD' ? 'Project lead' : rank === 'TEAM_LEAD' ? 'Team lead' : null,
    title,
    team?.name,
  ]
    .filter(Boolean)
    .join(' · ')

  const meets = meetingLine(project)

  return (
    <>
      <FormEyebrow>/ PROJECT</FormEyebrow>
      <FormHeading>{project.title}</FormHeading>

      {(standing || meets) && (
        <p className="text-faint mb-6 font-mono text-[11px] font-medium tracking-[0.14em]">
          {[standing, meets].filter(Boolean).join('  ·  ').toUpperCase()}
        </p>
      )}

      {project.summary && (
        <p className="text-dim mb-8 text-sm leading-[1.7] text-pretty">
          {project.summary}
        </p>
      )}

      {/* Who is on it beside what is left to do, where there is room. They are
          the two questions this page answers and they are asked together —
          "who is picking that up" needs both halves on screen at once, and
          stacked the second one starts below the fold on a project with three
          teams. */}
      <div className="grid-fluid items-start gap-5 [--col-min:26rem]">
        <Roster projectId={project.id} />
        <TaskBoard projectId={project.id} />
      </div>

      <div className="mt-9 flex flex-wrap items-center gap-4">
        <Link
          to={`/projects/${project.slug}`}
          className="text-faint hover:text-primary font-mono text-[11px] font-medium tracking-[0.14em] transition-colors duration-200"
        >
          PUBLIC PAGE ›
        </Link>
        <LeaveButton membership={membership} />
      </div>
    </>
  )
}

/** The roster, grouped the way the project actually works: by team. */
function Roster({ projectId }: { projectId: string }) {
  const state = useApi<ApiProjectTeamView>(`/projects/${projectId}/team`)

  if (state.status === 'loading') {
    return (
      <div aria-busy="true" className="border-rule bg-base-200 h-40 border" />
    )
  }

  if (state.status === 'error') {
    return (
      <FormPanel>
        <p className="text-dim text-sm leading-[1.7]">
          We couldn't load the roster just now.
        </p>
      </FormPanel>
    )
  }

  const { teams, members } = state.data
  const unseated = members.filter((m) => m.teamId === null)

  return (
    <div className="space-y-5">
      {teams.map((team) => (
        <TeamBlock
          key={team.id}
          name={team.name}
          description={team.description}
          members={members.filter((m) => m.teamId === team.id)}
        />
      ))}

      {unseated.length > 0 && (
        <TeamBlock
          name={teams.length > 0 ? 'Not on a team yet' : 'Everyone'}
          description={null}
          members={unseated}
        />
      )}
    </div>
  )
}

function TeamBlock({
  name,
  description,
  members,
}: {
  name: string
  description: string | null
  members: ApiProjectTeamView['members']
}) {
  return (
    <FormPanel>
      <p className="text-faint mb-1 font-mono text-[10px] font-medium tracking-[0.16em] uppercase">
        {name}
      </p>
      {description && (
        <p className="text-dim mb-3 text-[13px] leading-[1.5] text-pretty">
          {description}
        </p>
      )}

      {members.length === 0 ? (
        <p className="text-faint mt-3 text-[13px]">Nobody here yet.</p>
      ) : (
        <ul className="divide-rule mt-3 divide-y">
          {members.map((member) => (
            <li
              key={member.userId}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2"
            >
              <span className="text-sm font-medium">{member.fullName}</span>
              <span className="text-faint font-mono text-[10px] font-medium tracking-[0.14em] uppercase">
                {[
                  member.rank === 'PROJECT_LEAD'
                    ? 'Project lead'
                    : member.rank === 'TEAM_LEAD'
                      ? 'Team lead'
                      : null,
                  member.title,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </FormPanel>
  )
}

/**
 * The whole project's checklist, as a member sees it: everything visible, the
 * tick reachable only on tasks with your name on them. Leads do their
 * assigning on the manage page — this view is for knowing what is owed.
 */
function TaskBoard({ projectId }: { projectId: string }) {
  const { user } = useOutletContext<DashboardContext>()
  const [tasks, setTasks] = useState<ApiTask[] | null | 'loading'>('loading')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setTasks(await getJson<ApiTask[]>(`/projects/${projectId}/tasks`))
    } catch (error) {
      console.error(error)
      setTasks(null)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  if (tasks === 'loading') {
    return <div aria-busy="true" className="border-rule bg-base-200 h-24 border" />
  }

  if (tasks === null) {
    return (
      <FormPanel>
        <p className="text-dim text-sm leading-[1.7]">
          We couldn't load the tasks just now.
        </p>
      </FormPanel>
    )
  }

  const flip = (task: ApiTask) => {
    setBusy(true)
    postJson(`/tasks/${task.id}/status`, {
      // The tick is a shortcut for the common move, so it reads the *settled*
      // question rather than testing for OPEN: ticking something IN_PROGRESS
      // means done, and un-ticking anything settled reopens it. Testing
      // `=== 'OPEN'` would have quietly demoted started work back to untouched.
      // The other three labels are set on `/dashboard/tasks`.
      status: isSettled(task.status) ? 'OPEN' : 'DONE',
    })
      .then(load)
      .catch((error: unknown) => {
        console.error(error)
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <FormPanel>
      <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]">
        TASKS
      </p>

      {tasks.length === 0 ? (
        <p className="text-dim text-sm leading-[1.7]">Nothing on the board.</p>
      ) : (
        <ul className="divide-rule divide-y">
          {tasks.map((task) => {
            const mine = task.assignees.some((a) => a.userId === user.id)
            return (
              <li key={task.id} className="flex items-start gap-3 py-2.5">
                {mine ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      flip(task)
                    }}
                    aria-label={
                      isSettled(task.status)
                        ? `Reopen "${task.title}"`
                        : `Mark "${task.title}" done`
                    }
                    className={`border-rule hover:border-primary mt-0.5 flex size-4 shrink-0 cursor-pointer items-center justify-center border text-[10px] leading-none transition-colors duration-200 disabled:opacity-50 ${
                      isSettled(task.status) ? 'text-primary' : 'text-transparent'
                    }`}
                  >
                    ✓
                  </button>
                ) : (
                  <span
                    aria-hidden
                    className={`border-rule mt-0.5 flex size-4 shrink-0 items-center justify-center border text-[10px] leading-none ${
                      isSettled(task.status) ? 'text-faint' : 'text-transparent'
                    }`}
                  >
                    ✓
                  </span>
                )}
                <div className={`min-w-0 ${isSettled(task.status) ? 'opacity-50' : ''}`}>
                  <p className={`text-sm leading-snug font-medium ${isSettled(task.status) ? 'line-through' : ''}`}>
                    {task.title}
                  </p>
                  <p className="text-faint mt-0.5 font-mono text-[10px] font-medium tracking-[0.12em] uppercase">
                    {[
                      // OPEN is the default and says nothing worth a word; the
                      // other four are the reason this line exists at all.
                      task.status === 'OPEN' ? null : TASK_LABEL[task.status].text,
                      task.assignees.map((a) => a.fullName).join(', ') || 'Unassigned',
                      task.dueAt
                        ? `Due ${new Date(task.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {task.details && (
                    <p className="text-dim mt-1 text-[13px] leading-[1.5] text-pretty">
                      {task.details}
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </FormPanel>
  )
}

/**
 * Leaving, with the warning the shared button draws.
 *
 * The rank and the count of other lead seats both come out of `/me/projects`,
 * which this page already has — the dialog needs no route of its own. The
 * membership standing comes from the layout, which fetched it once.
 */
function LeaveButton({ membership }: { membership: ApiMyProject }) {
  const { reloadProjects } = useOutletContext<DashboardContext>()
  const navigate = useNavigate()

  return (
    <LeaveProjectButton
      projectId={membership.project.id}
      projectTitle={membership.project.title}
      rank={membership.rank}
      teamName={membership.team?.name ?? null}
      onLeft={async () => {
        // Only the project list. Leaving used to be able to change `user.role`
        // — the rail reads that — and the standing had to be re-read with it;
        // nothing about a project writes that column now, so this is one call.
        await reloadProjects()
        void navigate('/dashboard')
      }}
    />
  )
}
