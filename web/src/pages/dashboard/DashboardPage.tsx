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
import { LOCK_COPY, coverGap, surveyPrompt } from '../../lib/dues/dues'
import type { ApiMyTask, ApiProject } from '../../lib/api/api'
import { duesLocked } from '../../lib/dues/dues'
import { meetingLine, meetingNote } from '../../lib/events/meetings'
import { whereLabel } from '../../lib/tasks'
import { useApi } from '../../lib/api/useApi'

/**
 * The dashboard overview: the one page everybody lands on, whatever their standing.
 *
 * It reads as a stack of panels, and the panels do the role-splitting by their own empty
 * states rather than by branching on who is looking. A guest has no projects, so MY
 * PROJECTS shows them how to get one. Nothing here checks a role, because the server
 * already scoped every answer to the person asking.
 *
 * The session gate lives in `DashboardLayout`, which is the only reason this can read
 * the outlet context without checking anybody signed in.
 */

export function DashboardPage() {
  const { user, projects, membership } = useOutletContext<DashboardContext>()
  // The survey locks nothing, so it isn't one of `accessLock`'s reasons and is read
  // straight off the membership. Two facts rather than one, because the panel below has
  // three states: answered, still being asked for, and unanswered by somebody who said
  // stop.
  const surveyPending =
    membership.status === 'ready' && membership.data.surveyPending
  const askingForSurvey = surveyPrompt(membership)

  const firstName = user.fullName.trim().split(/\s+/)[0]

  return (
    <>
      {/* `/ OVERVIEW`, not `/ DASHBOARD`. The rail already says which section this is;
          what the page has to say is which page of it you're on, and the two saying the
          same word read as one label printed twice. */}
      <FormEyebrow>/ OVERVIEW</FormEyebrow>
      <FormHeading>Hello, {firstName}.</FormHeading>

      {/* One grid for the whole page, rather than a status block and a prompt stacked
          full-width above a grid of panels. Every cell in here is the same kind of thing
          — something true about this person right now — and the two at the top only sat
          apart because the page was a column. As many columns as the screen has room
          for; the reading order down the markup is unchanged. */}
      <div className="grid-fluid mt-8 gap-5">
        <Membership state={membership} />

        {/* One prompt here, and it's about money. The survey used to take this slot
            whenever it was owed, because it outranked dues on the server and telling
            somebody to pay would have sent them to a page the gate then refused. It shuts
            nothing now. */}
        {duesLocked(membership, user.role) && (
          <FormPanel tone="accent">
            <p className="mb-1.5 text-sm font-semibold">
              Pay your dues to unlock the rest of this.
            </p>
            <p className="text-dim text-sm leading-[1.7] text-pretty">
              3D printing, equipment and anything you run are locked until then.
              Your projects and rank are untouched.
            </p>
          </FormPanel>
        )}

        {/* Ahead of the rest, because it's the only panel here that's different this
            evening from what it was this morning — and for an officer it's the one thing
            on the page that's a press rather than a link. */}
        <LabPanel user={user} membership={membership} />
        <MyProjects projects={projects} />
        <OpenProjects />
        <MyTasks />
        <SurveyPanel pending={surveyPending} asking={askingForSurvey} />
      </div>

      {/* The page ends on the calendar. It used to end on a link to the Discord and a
          sign-out button — one a way off the site and the other a once-a-term action,
          both under the page people open daily. Signing out is on the profile page now;
          the Discord is in the footer with every other outbound link. */}
      <div className="mt-10">
        <DashboardCalendar />
      </div>
    </>
  )
}

/**
 * Dues, from the layout's one read of them rather than a second of its own.
 *
 * It used to fetch here. The rail needs the same answer to know whether to lock the
 * management links, and `/dues/status` is the expensive endpoint on the site — it reads
 * UCF's academic calendar — so two reads per page load was one too many. A failure
 * degrades to a line and a link rather than implying dues are paid when nobody knows.
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

  // One element, not a fragment: this is a cell of the page's grid now, and a fragment
  // would spill the button into a cell of its own halfway across the row from the panel
  // it belongs to.
  return (
    <div>
      <MembershipPanel membership={membership} />

      {/* Shown whatever the status, so somebody reading this inside a free window can
          settle the term ahead now rather than being told to come back.

          The label follows `coverGap`, not `duesRequired`, and that distinction is the
          bug this replaced: `duesRequired` is false during a free window, so this said
          VIEW DUES & PAYMENTS to somebody with no access at all. */}
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
 * The projects I'm on this term: name, standing, and when they meet.
 *
 * Only the current ones, because the point of the panel is what somebody is working on —
 * a member three years in would otherwise scroll past a history to find this Thursday's
 * meeting. The rest are one link away.
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
            {/* Two different situations and two different sentences. Somebody who has
                never joined needs to be told where to; somebody between terms needs to
                know the list is right rather than broken. */}
            {before === 0
              ? "You're not on a project yet. Join one from the list beside this."
              : "You're not on a project this semester. Projects run a term at a time."}
          </p>
        ) : (
          <ul className="space-y-4">
            {thisTerm.map(({ project, rank, title, team }) => {
              const meets = meetingLine(project)
              const note = meetingNote(project)
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
                  {/* The lead's own words under the times, in the tier below them: the
                      schedule is the fact, this is the aside. */}
                  {note && (
                    <p className="text-faint mt-0.5 text-[13px] leading-[1.5] text-pretty">
                      {note}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        ))}

      {/* Only when there's something behind it, and outside the branch above so it shows
          whether or not this term is empty. */}
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
 * My open assignments, tickable in place. Hand-rolled fetch rather than `useApi` because
 * ticking has to refresh the list — the same reason the dues page rolls its own.
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
        {/* The card is the five nearest deadlines; the page is the rest of it, plus the
            labels, the search and — for a lead — the form. */}
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
 * Every project currently running, whoever is looking — the guest's window into what the
 * club is doing, and the member's way to a second project. Joining happens on the
 * project's own page, behind the dues check.
 */
function OpenProjects() {
  // This term's only. Offering somebody a place on last spring's build is an invitation
  // to join a project that finished, and the server computes which term that is — the
  // browser has no way to know and no business guessing.
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
 * This is the standing offer, and it's what lets the prompt carry a *don't ask me
 * again*. Nothing makes anybody fill the survey in and the dialog can be switched off
 * for good, so the club's last chance at a shirt size is a panel that's always here, on
 * the page everybody lands on. It's also the way back for somebody correcting an answer
 * a year later, which the rail's row can't be.
 *
 * Three states, two props. `asking` is a strictly narrower `pending`: somebody who ticked
 * the box is pending and not asked, and telling them they haven't filled it in yet, in
 * accent, is the exact nag they turned off.
 */
function SurveyPanel({
  pending,
  asking,
}: {
  pending: boolean
  asking: boolean
}) {
  return (
    // Accent only while the club is still asking. A dismissal takes the colour off it as
    // well as taking the prompt down — the offer stays, the pull doesn't.
    <FormPanel tone={asking ? 'accent' : 'plain'}>
      <p className="text-faint mb-3 font-mono text-[10px] font-medium tracking-[0.16em]">
        MEMBER SURVEY
      </p>

      <p className="text-dim text-[13px] leading-[1.6] text-pretty">
        {!pending
          ? 'Answered. Shirt sizes and graduation years move, so change yours whenever they do.'
          : asking
            ? 'Not filled in yet. Two minutes, asked once, and nothing waits on it.'
            : 'Not filled in yet, and we will not ask again. It is still here whenever you want it.'}
      </p>

      <Link
        to="/dashboard/survey"
        className="text-primary mt-3 inline-block font-mono text-[11px] font-medium tracking-[0.1em] underline underline-offset-2"
      >
        {pending ? 'FILL IT IN' : 'UPDATE MY ANSWERS'}
      </Link>
    </FormPanel>
  )
}
