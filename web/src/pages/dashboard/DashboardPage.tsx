import { useCallback, useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router'
import { DashboardCalendar } from '../../components/dashboard/DashboardCalendar'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { LabPanel } from '../../components/dashboard/LabPanel'
import { MembershipPanel } from '../../components/dues/MembershipPanel'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
} from '../../components/shared/formChrome'
import { getJson, postJson } from '../../lib/api/api'
import { LOCK_COPY, accessLock, coverGap } from '../../lib/dues/dues'
import type { ApiMyTask, ApiProject } from '../../lib/api/api'
import { duesLocked } from '../../lib/dues/dues'
import { meetingLine } from '../../lib/events/meetings'
import { whereLabel } from '../../lib/tasks'
import { useApi } from '../../lib/api/useApi'

/**
 * The dashboard overview: the one page everybody lands on, whatever their
 * standing.
 *
 * It reads as a stack of panels, and the panels do the role-splitting by
 * their own empty states rather than by branching on who is looking. A guest
 * has no projects, so MY PROJECTS shows them how to get one; a member has
 * some, so it shows those. Nothing here checks a role, because nothing here
 * needs to — the server already scoped every answer to the person asking.
 *
 * The session gate lives in `DashboardLayout`, which is the only reason this
 * component can read the outlet context without checking anybody signed in.
 */

export function DashboardPage() {
  const { user, projects, membership } = useOutletContext<DashboardContext>()
  // `accessLock` rather than `coverGap`, so the ADMIN exemption and the
  // "nothing until it is ready" rule are read from the same place the rail
  // reads them and cannot drift from it.
  const owed = accessLock(membership, user.role)

  const firstName = user.fullName.trim().split(/\s+/)[0]

  return (
    <>
      {/* `/ OVERVIEW`, not `/ DASHBOARD`. The rail already says which section
          this is; what the page has to say is which page of it you are on, and
          the two saying the same word read as one label printed twice. */}
      <FormEyebrow>/ OVERVIEW</FormEyebrow>
      <FormHeading>Hello, {firstName}.</FormHeading>

      {/* One grid for the whole page, rather than a status block and a prompt
          stacked full-width above a grid of panels. Every cell in here is the
          same kind of thing — something true about this person right now — and
          the two at the top only sat apart because the page was a column. As
          many columns as the screen has room for, so this fills a monitor
          instead of leaving its right half empty; the reading order down the
          markup is unchanged, so standing still comes first and whatever is
          owed comes second. */}
      <div className="grid-fluid mt-8 gap-5">
        <Membership state={membership} />

        {/* The survey outranks the dues prompt, and this is the one place the
            two could contradict each other. Telling somebody to pay while the
            survey is what is shut sends them to a page the gate refuses — so
            while it is owed, this panel is the survey's. */}
        {owed === 'survey' ? (
          <FormPanel tone="accent">
            <p className="mb-1.5 text-sm font-semibold">
              Fill in the member survey to unlock the rest of this.
            </p>
            <p className="text-dim text-sm leading-[1.7] text-pretty">
              Two minutes, asked once. It is how the club knows what size shirts
              to order and what it can safely feed people.{' '}
              <Link
                to="/dashboard/survey"
                className="text-primary underline underline-offset-2"
              >
                Fill it in
              </Link>
              .
            </p>
          </FormPanel>
        ) : (
          duesLocked(membership, user.role) && (
            <FormPanel tone="accent">
              <p className="mb-1.5 text-sm font-semibold">
                Pay your dues to unlock the rest of this.
              </p>
              <p className="text-dim text-sm leading-[1.7] text-pretty">
                3D printing, equipment and anything you run are locked until
                then. Your projects and rank are untouched.
              </p>
            </FormPanel>
          )
        )}

        {/* Ahead of the rest, because it is the only panel here that is
            different this evening from what it was this morning — and for an
            officer it is the one thing on the page that is a press rather than
            a link. */}
        <LabPanel user={user} membership={membership} />
        <MyProjects projects={projects} />
        <OpenProjects />
        <MyTasks />
        <SurveyPanel owed={owed === 'survey'} />
      </div>

      {/* The page ends on the calendar. It used to end on a link to the Discord
          and a sign-out button — one of them a way off the site and the other a
          once-a-term action, both sitting under the page people open daily.
          Signing out is on the profile page now; the Discord is in the footer,
          where every other outbound link on the site already lives. */}
      <div className="mt-10">
        <DashboardCalendar />
      </div>
    </>
  )
}

/**
 * Dues, from the layout's one read of them rather than a second of its own.
 *
 * It used to fetch here. The rail needs the same answer to know whether to lock
 * the management links, and `/dues/status` is the expensive endpoint on the site
 * — it reads UCF's academic calendar — so two reads per page load was one too
 * many. Three states still, like every other remote read here: a failure
 * degrades to a line and a link rather than blanking the page or, worse,
 * implying dues are paid when nobody knows.
 */
function Membership({ state }: { state: DashboardContext['membership'] }) {

  if (state.status === 'loading') {
    return (
      <div aria-busy="true" className="border-rule bg-base-200 h-36 border" />
    )
  }

  if (state.status === 'error') {
    return (
      <FormPanel>
        <p className="text-dim text-sm leading-[1.7] text-pretty">
          We couldn't load your dues just now.{' '}
          <Link to="/dashboard/dues" className="text-primary underline underline-offset-2">
            Open the dues page
          </Link>{' '}
          to try again.
        </p>
      </FormPanel>
    )
  }

  const membership = state.data
  const gap = coverGap(membership)

  // One element, not a fragment: this is a cell of the page's grid now, and a
  // fragment would spill the button into a cell of its own halfway across the
  // row from the panel it belongs to.
  return (
    <div>
      <MembershipPanel membership={membership} />

      {/* Shown whatever the status, so somebody reading this inside a free
          window can settle the term ahead now rather than being told to come
          back when it costs something.

          The label follows `coverGap`, not `duesRequired`, and that distinction
          is the bug this replaced. `duesRequired` is false during a free window
          — nothing is owed — so this said VIEW DUES & PAYMENTS to somebody with
          no access at all, when what they needed was one free press. */}
      <div className="mt-5">
        <Link
          to="/dashboard/dues"
          className="btn btn-primary btn-cta px-7 py-[15px] text-[13px] font-semibold"
        >
          {gap ? LOCK_COPY[gap].cta : 'VIEW DUES & PAYMENTS'}
        </Link>
      </div>
    </div>
  )
}

/**
 * The projects I am on *this term*: name, standing, and when they meet.
 *
 * Only the current ones, because the point of the panel is what somebody is
 * working on — a member three years in would otherwise scroll past a history to
 * find this Thursday's meeting. The rest are one link away.
 */
function MyProjects({ projects }: { projects: DashboardContext['projects'] }) {
  const mine = projects.status === 'ready' ? projects.data : []
  const thisTerm = mine.filter(({ current }) => current)
  const before = mine.length - thisTerm.length

  return (
    <FormPanel>
      <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]">
        MY PROJECTS
      </p>

      {projects.status === 'loading' && (
        <div aria-busy="true" className="space-y-2.5">
          <div className="bg-base-300 h-4 w-2/3 animate-pulse rounded-[2px]" />
          <div className="bg-base-300 h-3 w-1/2 animate-pulse rounded-[2px]" />
        </div>
      )}

      {projects.status === 'error' && (
        <p className="text-dim text-sm leading-[1.7]">
          We couldn't load your projects just now. Try again in a moment.
        </p>
      )}

      {projects.status === 'ready' &&
        (thisTerm.length === 0 ? (
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            {/* Two different situations and two different sentences. Somebody
                who has never joined needs to be told where to; somebody between
                terms needs to know the list is right rather than broken. */}
            {before === 0
              ? "You're not on a project yet. Join one from the list beside this."
              : "You're not on a project this semester. Projects run a term at a time."}
          </p>
        ) : (
          <ul className="space-y-4">
            {thisTerm.map(({ project, rank, title, team }) => {
              const meets = meetingLine(project)
              const standing = [
                rank === 'PROJECT_LEAD'
                  ? 'Project lead'
                  : rank === 'TEAM_LEAD'
                    ? 'Team lead'
                    : null,
                title,
                team?.name,
              ]
                .filter(Boolean)
                .join(' · ')

              return (
                <li key={project.id}>
                  <Link
                    to={`/dashboard/projects/${project.slug}`}
                    className="hover:text-primary text-sm font-semibold transition-colors duration-200"
                  >
                    {project.title}
                  </Link>
                  {standing && (
                    <p className="text-faint mt-0.5 font-mono text-[10px] font-medium tracking-[0.14em] uppercase">
                      {standing}
                    </p>
                  )}
                  {meets && (
                    <p className="text-dim mt-1 text-[13px] leading-[1.5]">
                      {meets}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        ))}

      {/* Only when there is something behind it, and outside the branch above
          so it shows whether or not this term is empty. */}
      {projects.status === 'ready' && before > 0 && (
        <Link
          to="/dashboard/projects/past"
          className="text-faint hover:text-primary mt-5 inline-block font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200"
        >
          PAST PROJECTS ({before})
        </Link>
      )}
    </FormPanel>
  )
}

/**
 * My open assignments, tickable in place. Hand-rolled fetch rather than
 * `useApi` because ticking has to refresh the list — the same reason the dues
 * page rolls its own.
 */
function MyTasks() {
  const [tasks, setTasks] = useState<ApiMyTask[] | null | 'loading'>('loading')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setTasks(await getJson<ApiMyTask[]>('/me/tasks'))
    } catch (error) {
      console.error(error)
      setTasks(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const tick = (task: ApiMyTask) => {
    setBusy(true)
    postJson(`/tasks/${task.id}/status`, { status: 'DONE' })
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
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <p className="text-faint font-mono text-[10px] font-medium tracking-[0.16em]">
          MY TASKS
        </p>
        {/* The card is the five nearest deadlines; the page is the rest of it,
            plus the labels, the search and — for a lead — the form. */}
        <Link
          to="/dashboard/tasks"
          className="text-faint hover:text-primary font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200"
        >
          ALL TASKS
        </Link>
      </div>

      {tasks === 'loading' && (
        <div aria-busy="true" className="space-y-2.5">
          <div className="bg-base-300 h-4 w-2/3 animate-pulse rounded-[2px]" />
          <div className="bg-base-300 h-3 w-1/2 animate-pulse rounded-[2px]" />
        </div>
      )}

      {tasks === null && (
        <p className="text-dim text-sm leading-[1.7]">
          We couldn't load your tasks just now.
        </p>
      )}

      {Array.isArray(tasks) &&
        (tasks.length === 0 ? (
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            Nothing on your list.
          </p>
        ) : (
          <ul className="space-y-3">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-start gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    tick(task)
                  }}
                  aria-label={`Mark "${task.title}" done`}
                  className="border-rule hover:border-primary hover:text-primary mt-0.5 flex size-4 shrink-0 cursor-pointer items-center justify-center border text-[10px] leading-none text-transparent transition-colors duration-200 disabled:opacity-50"
                >
                  ✓
                </button>
                <div className="min-w-0">
                  <p className="text-sm leading-snug font-medium">{task.title}</p>
                  <p className="text-faint mt-0.5 font-mono text-[10px] font-medium tracking-[0.12em] uppercase">
                    {[
                      whereLabel(task),
                      task.team?.name,
                      task.dueAt
                        ? `Due ${new Date(task.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ))}
    </FormPanel>
  )
}

/**
 * Every project currently running, whoever is looking — this is the guest's
 * window into what the club is doing, and the member's way to a second
 * project. Joining happens on the project's own page, behind the dues check.
 */
function OpenProjects() {
  // This term's only. Offering somebody a place on last spring's build is an
  // invitation to join a project that finished, and the server computes which
  // term that is — the browser has no way to know and no business guessing.
  const state = useApi<ApiProject[]>(
    '/projects?status=IN_PROGRESS&term=current&limit=100',
  )

  return (
    <FormPanel>
      <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]">
        OPEN PROJECTS
      </p>

      {state.status === 'loading' && (
        <div aria-busy="true" className="space-y-2.5">
          <div className="bg-base-300 h-4 w-2/3 animate-pulse rounded-[2px]" />
          <div className="bg-base-300 h-3 w-1/2 animate-pulse rounded-[2px]" />
        </div>
      )}

      {state.status === 'error' && (
        <p className="text-dim text-sm leading-[1.7]">
          We couldn't load the project list just now.
        </p>
      )}

      {state.status === 'ready' &&
        (state.data.length === 0 ? (
          <p className="text-dim text-sm leading-[1.7]">
            Nothing is in progress right now.
          </p>
        ) : (
          <ul className="space-y-3">
            {state.data.map((project) => (
              <li key={project.id}>
                <Link
                  to={`/projects/${project.slug}`}
                  className="hover:text-primary text-sm font-semibold transition-colors duration-200"
                >
                  {project.title}
                </Link>
                {project.summary && (
                  <p className="text-dim mt-0.5 text-[13px] leading-[1.5] text-pretty">
                    {project.summary}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ))}
    </FormPanel>
  )
}

/**
 * The survey's own panel on the overview.
 *
 * It replaced an honest `Not built yet.` placeholder, and it keeps that panel's
 * job of being the one place on the dashboard that says where the survey lives
 * — which matters more now the rail row disappears once it is answered. Somebody
 * correcting a shirt size a year later has this and nothing else to follow.
 */
function SurveyPanel({ owed }: { owed: boolean }) {
  return (
    <FormPanel tone={owed ? 'accent' : 'plain'}>
      <p className="text-faint mb-3 font-mono text-[10px] font-medium tracking-[0.16em]">
        MEMBER SURVEY
      </p>

      {owed ? (
        <>
          <p className="text-dim text-[13px] leading-[1.6] text-pretty">
            Not filled in yet. It is two minutes and it is asked once.
          </p>
          <Link
            to="/dashboard/survey"
            className="text-primary mt-3 inline-block font-mono text-[11px] font-medium tracking-[0.1em] underline underline-offset-2"
          >
            FILL IT IN
          </Link>
        </>
      ) : (
        <>
          <p className="text-dim text-[13px] leading-[1.6] text-pretty">
            Answered, and you will not be asked again. Shirt sizes and
            graduation years move, so change yours whenever they do.
          </p>
          <Link
            to="/dashboard/survey"
            className="text-primary mt-3 inline-block font-mono text-[11px] font-medium tracking-[0.1em] underline underline-offset-2"
          >
            UPDATE MY ANSWERS
          </Link>
        </>
      )}
    </FormPanel>
  )
}
