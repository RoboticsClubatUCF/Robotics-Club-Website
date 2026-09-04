import { Suspense, type ReactNode, useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { ApiError, getJson, postJson } from '../../lib/api/api'
import type {
  ApiDuesStatus,
  ApiMembership,
  ApiMyProject,
  ApiUser,
} from '../../lib/api/api'
import { accessLock, duesLocked, surveyPrompt } from '../../lib/dues/dues'
import { isOfficer, useSession } from '../../lib/auth/session'
import type { ApiState } from '../../lib/api/useApi'
import { Avatar } from '../shared/Avatar'
import { SurveyPromptDialog } from './SurveyPromptDialog'
import {
  FormEyebrow,
  FormHeading,
  FormPage,
  FormPanel,
} from '../shared/formChrome'

/**
 * The frame around every dashboard page: one session gate, one rail, one fetch of
 * "my projects" shared with everything inside.
 *
 * The gate lives here and nowhere else — child pages render assuming somebody is
 * signed in, because this has already redirected anyone who isn't. `state.from` on
 * that redirect is what brings a person back to the page they asked for.
 *
 * `/me/projects` is fetched once and passed down through outlet context rather than
 * per page: the rail needs it for the project links, the overview for the cards, and
 * `useApi` has no cache to make asking twice cheap.
 *
 * The `/ MANAGE` group is the officer desks plus EVENTS, which project leads reach
 * too — so the group is gated by the global role or by holding a lead's rank on any
 * membership, and its rows are gated individually. Cosmetics either way, since every
 * route re-checks on the server. Named for what those pages do rather than who may
 * open them: a group headed OFFICERS describes the reader, and the reader knows.
 *
 * Everything the dashboard offers is a route under `/dashboard`. Dues used to be the
 * exception and it was the wrong shape — clicking a rail link and losing the rail
 * makes a section feel like separate pages sharing a heading. `/dues` still resolves
 * as a redirect, because it's in Stripe return URLs and in people's history.
 */
export interface DashboardContext {
  user: ApiUser
  projects: ApiState<ApiMyProject[]>
  /** Call after anything that changes a membership — joining, leaving, team
      edits — so the rail and overview agree with what just happened. */
  reloadProjects: () => Promise<void>
  /**
   * Where this person stands on dues, fetched once for the whole section — the rail
   * needs it to lock, the overview to draw the panel, and asking twice would be two
   * reads of UCF's calendar per page.
   *
   * Anything but `ready` means "lock nothing": the server refuses a lapsed lead
   * whatever this says, so the worst a pending answer does is let somebody click
   * through to an honest 403. The alternative is flashing a padlock at a paid-up
   * member on every page load.
   */
  membership: ApiState<ApiMembership>
  /** Call after paying or claiming a free break, so the rail unlocks. */
  reloadMembership: () => Promise<void>
}

export function DashboardLayout() {
  const { session } = useSession()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (session.status === 'signed-out') {
      void navigate('/login', {
        replace: true,
        // The search string too, not just the path. The email-change confirmation
        // lands on `/dashboard/profile?emailToken=…`, and somebody following that
        // link from a phone is usually not signed in there. Dropping the query would
        // bring them back with the token gone and nothing to say why the confirmation
        // didn't happen.
        state: { from: `${location.pathname}${location.search}` },
      })
    }
  }, [session.status, navigate, location.pathname, location.search])

  if (session.status === 'loading') {
    return (
      <FormPage width="wide">
        <div aria-busy="true">
          <FormEyebrow>/ DASHBOARD</FormEyebrow>
          <FormHeading>Loading…</FormHeading>
          <div className="border-rule bg-base-200 h-40 border" />
        </div>
      </FormPage>
    )
  }

  if (session.status === 'error') {
    return (
      <FormPage width="wide">
        <FormEyebrow>/ DASHBOARD</FormEyebrow>
        <FormHeading>We can't reach the server.</FormHeading>
        <FormPanel tone="accent">
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            This page couldn't check who you are. Try again in a moment.
          </p>
        </FormPanel>
      </FormPage>
    )
  }

  // The redirect above is on its way.
  if (session.status !== 'signed-in') return null

  return <DashboardShell user={session.user} />
}

/**
 * Split from the gate so the `/me/projects` request only fires for somebody signed
 * in — mounted earlier it would 401 into the console of every visitor on their way
 * to the login page.
 *
 * The fetch is hand-rolled rather than `useApi` for the reason the dues page's is:
 * children mutate memberships, and a hook with no refetch would leave the rail
 * describing the world as it was before the click.
 *
 * No `px-page` on the outer element, and that's the whole layout decision. The rail
 * is flush to the left edge with its own surface and one hairline down its right
 * side, so it reads as fixed furniture rather than a column of links that happens to
 * be first. The gutter moves onto the content column.
 */
function DashboardShell({ user }: { user: ApiUser }) {
  const location = useLocation()
  /**
   * Put away for the rest of this page session.
   *
   * The permanent answer is a column on the user — the checkbox writes
   * `surveyPromptDismissedAt` — and this only keeps the dialog down between that
   * write and the refetch that confirms it. It also stands alone for somebody who
   * closed the prompt without ticking the box, where asking again next reload is the
   * right side to err on: nothing is locked either way.
   */
  const [promptClosed, setPromptClosed] = useState(false)

  const [projects, setProjects] = useState<ApiState<ApiMyProject[]>>({
    status: 'loading',
  })
  const [membership, setMembership] = useState<ApiState<ApiMembership>>({
    status: 'loading',
  })

  const reloadMembership = useCallback(async () => {
    try {
      const status = await getJson<ApiDuesStatus>('/dues/status')
      setMembership({ status: 'ready', data: status.membership })
    } catch (error) {
      console.error(error)
      setMembership({
        status: 'error',
        code: error instanceof ApiError ? error.status : 0,
      })
    }
  }, [])

  const reloadProjects = useCallback(async () => {
    try {
      const data = await getJson<ApiMyProject[]>('/me/projects')
      setProjects({ status: 'ready', data })
    } catch (error) {
      console.error(error)
      setProjects({
        status: 'error',
        code: error instanceof ApiError ? error.status : 0,
      })
    }
  }, [])

  useEffect(() => {
    void reloadProjects()
    void reloadMembership()
  }, [reloadProjects, reloadMembership])

  /**
   * Closing the prompt, and the checkbox on it.
   *
   * The write is fired and not waited on; the dialog is already down by then. A
   * failed dismissal costs the member one more prompt on their next visit, which is
   * the cheapest way for this to go wrong and the reason nothing reports an error.
   */
  const closeSurveyPrompt = useCallback(
    (dontAsk: boolean) => {
      setPromptClosed(true)

      if (!dontAsk) return

      void postJson('/survey/dismiss', {})
        .then(reloadMembership)
        .catch((error: unknown) => {
          console.error(error)
        })
    },
    [reloadMembership],
  )

  /**
   * The survey prompt, and the two pages it stays off.
   *
   * `/dashboard/survey` for the obvious reason, and `/dashboard/profile` because
   * that's where signing out lives — a prompt covering the way out of an account is
   * the one version of this that could strand somebody.
   *
   * It's the whole of what asks now, which is why it's only ever mounted here. The
   * survey used to be a gate, so a member met it as a wall of padlocks; it's a
   * question asked once, because a club that can't make anybody answer had better
   * not annoy the people who would.
   */
  const asking = surveyPrompt(membership)
  const promptable =
    !location.pathname.startsWith('/dashboard/survey') &&
    !location.pathname.startsWith('/dashboard/profile')

  return (
    <div className="wide:grid wide:grid-cols-[15rem_1fr]">
      <DashboardNav user={user} projects={projects} membership={membership} />

      {asking && promptable && !promptClosed && (
        <SurveyPromptDialog onClose={closeSurveyPrompt} />
      )}

      <div className="px-page min-w-0 py-9 wide:py-12">
        {/* Still left-aligned rather than centred in the remaining space: the rail is
            the left edge of the layout, and content that drifted away would put the
            canyon between the two.

            62rem was a reading measure applied to a whole section, which was the wrong
            thing to measure — on anything wider than a laptop it left a third of the
            screen empty while the pages inside stacked into one narrow column. The
            measure belongs to the panels; this only has to stop the widest monitors
            drawing a 2000px row of controls. */}
        <div className="min-w-0 max-w-[112rem]">
          {/* Every page under here is fetched on first use — see the note at the top
              of `App.tsx`. The boundary is inside the layout on purpose: the rail is
              what somebody navigates with, so it stays on screen while the next page
              arrives rather than the whole dashboard blinking out and back.

              The fallback reserves height and says nothing. It's on screen for a few
              hundred milliseconds once per session, and the pages behind it draw their
              own skeletons — a second spinner would be two loading states for one
              navigation. `aria-busy` rather than `role="status"`: nothing to announce. */}
          <Suspense fallback={<div aria-busy="true" className="min-h-[60vh]" />}>
            <Outlet
              context={
                {
                  user,
                  projects,
                  reloadProjects,
                  membership,
                  reloadMembership,
                } satisfies DashboardContext
              }
            />
          </Suspense>
        </div>
      </div>
    </div>
  )
}

const groupLabelClass =
  'text-faint mb-2 px-5 font-mono text-[10px] font-medium tracking-[0.16em]'

/**
 * A rail row. The gold bar down the left edge marks the current page — colour alone
 * was doing that job before, and on a list of gold-on-hover links "which one am I on"
 * came down to noticing a shade.
 */
const linkClass = ({ isActive }: { isActive: boolean }) =>
  `block border-l-2 py-[7px] pr-4 pl-[18px] font-mono text-[11px] leading-snug font-medium tracking-[0.1em] transition-colors duration-200 ${
    isActive
      ? 'border-primary bg-primary/10 text-primary'
      : 'border-transparent text-dim hover:bg-base-content/5 hover:text-base-content'
  }`

/**
 * The rail: a full-height options menu at `wide:`, a collapsible band above the
 * content on phones.
 *
 * The collapse is React state and a `hidden` class rather than a `<details>`, matching
 * `SiteNav`: the same list has to be permanently open at `wide:`, and a `<details>`
 * can't be forced open from CSS.
 *
 * Groups appear only when they have something in them — an empty MY PROJECTS heading
 * would just be the sad version of the overview's empty state.
 */
function DashboardNav({
  user,
  projects,
  membership,
}: {
  user: ApiUser
  projects: ApiState<ApiMyProject[]>
  membership: ApiState<ApiMembership>
}) {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const mine = projects.status === 'ready' ? projects.data : []
  // Split rather than filtered at the source: the context carries every membership
  // because a past project's pages still have to resolve, and the rail is the one
  // place that only wants the ones running now.
  const thisTerm = mine.filter(({ current }) => current)
  const before = mine.filter(({ current }) => !current)
  // The `/ MANAGE` group is officers only, every row but one. It briefly had a fourth
  // audience: somebody carrying a `PROJECT_LEAD` roster label could start a project of
  // their own. That label isn't a role any more, and the delegation went with it.
  const officer = isOfficer(user.role)
  // EVENTS is the exception, and it's a different kind of claim. The old delegation
  // read a global label and let it stand for project authority, which is the bug class
  // this codebase keeps warning about. This reads the membership rows: somebody who
  // leads a project or a team may schedule things on it, the same permission
  // `requireEventManager` grants on the server.
  const leadsSomething = mine.some(({ rank }) => rank !== 'MEMBER')
  const locked = duesLocked(membership, user.role)
  // The reason, for the one note at the bottom of the rail that has to name it. There
  // used to be a second, stricter lock here — printing and borrowing refused a guest
  // whatever their standing — and it's gone: access is the dues date now, so every
  // locked row is locked by the same condition.
  const why = accessLock(membership, user.role)
  // Not a lock reason, and it doesn't come from `accessLock` for that reason — an
  // unanswered survey shuts nothing. It only decides whether the rail still carries a
  // row offering the form.
  const asking = surveyPrompt(membership)

  // Following a link on a phone has to put the menu away, or the page you asked for
  // opens underneath the list you asked for it from.
  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  return (
    <aside className="border-rule bg-base-200 border-b wide:min-h-[calc(100dvh-var(--spacing-nav))] wide:border-r wide:border-b-0">
      {/* Sticky on the inner element, not the aside: the aside has to stretch to the
          height of the row for its surface to read as a rail, and a sticky box only
          ever occupies its own content. */}
      <div className="wide:sticky wide:top-nav wide:max-h-[calc(100dvh-var(--spacing-nav))] wide:overflow-y-auto">
        <ProfileLink user={user} />

        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open)
          }}
          className="text-faint hover:text-primary border-rule flex w-full cursor-pointer items-center justify-between border-b px-5 py-3.5 font-mono text-[10px] font-medium tracking-[0.16em] transition-colors duration-200 wide:hidden"
        >
          MENU
          <span
            aria-hidden
            className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          >
            ›
          </span>
        </button>

        <nav
          aria-label="Dashboard"
          className={`${open ? 'block' : 'hidden'} pb-6 wide:block`}
        >
          <div className="pt-5">
            <p className={groupLabelClass}>/ GENERAL</p>
            <NavLink to="/dashboard" end className={linkClass}>
              OVERVIEW
            </NavLink>
            {/* Never locked, and it sits in `/ GENERAL` rather than `/ MANAGE` even
                though leads write tasks from it: it's a page about work somebody is
                already doing, and the server doesn't gate reading it. A row a lapsed
                member could open anyway is not a row to draw a padlock on. */}
            <NavLink to="/dashboard/tasks" className={linkClass}>
              TASKS
            </NavLink>
            {/* Only while the survey is still being asked for, and it goes the moment
                somebody says stop — the same predicate the prompt reads, so one
                checkbox turns both off. A permanent row for something you do once is
                dead weight in a list somebody opens every day. */}
            {asking && (
              <NavLink to="/dashboard/survey" className={linkClass}>
                MEMBER SURVEY
              </NavLink>
            )}
            {/* Never locked, and back to being the one row here that cannot be. It's
                the page every other lock links to, so shutting it strands the person
                it's telling to pay — which is what the survey gate did to it. */}
            <NavLink to="/dashboard/dues" className={linkClass}>
              DUES &amp; PAYMENTS
            </NavLink>
            {/* Locked by the same condition as everything else below: the club's line
                is that an uncovered account gets this page and its own projects, and
                both of these are the club spending money on somebody. */}
            {locked ? (
              <>
                <LockedRow>3D PRINTING</LockedRow>
                <LockedRow>EQUIPMENT</LockedRow>
              </>
            ) : (
              <>
                <NavLink to="/dashboard/print" className={linkClass}>
                  3D PRINTING
                </NavLink>
                <NavLink to="/dashboard/equipment" className={linkClass}>
                  EQUIPMENT
                </NavLink>
              </>
            )}
          </div>

          {mine.length > 0 && (
            <div className="border-rule mt-5 border-t pt-5">
              <p className={groupLabelClass}>/ MY PROJECTS</p>
              {thisTerm.map(({ project, rank }) => (
                <div key={project.id}>
                  <NavLink
                    to={`/dashboard/projects/${project.slug}`}
                    end
                    className={linkClass}
                  >
                    {project.title.toUpperCase()}
                  </NavLink>
                  {rank !== 'MEMBER' &&
                    (locked ? (
                      <LockedRow className="pl-9 text-[10px]">MANAGE</LockedRow>
                    ) : (
                      <NavLink
                        to={`/dashboard/projects/${project.slug}/manage`}
                        // Indented by padding rather than by characters: an
                        // accessible name is what a screen reader announces and
                        // what the tests query on, and neither wants two spaces
                        // in front of it.
                        className={({ isActive }) =>
                          `${linkClass({ isActive })} pl-9 text-[10px]`
                        }
                      >
                        MANAGE
                      </NavLink>
                    ))}
                </div>
              ))}

              {/* Somebody with projects, none of them this term. Said here rather than
                  left as a heading with nothing under it — a group that appears empty
                  reads as a list that failed to load. */}
              {thisTerm.length === 0 && (
                <p className="text-faint px-5 pb-1 text-[12px] leading-[1.5] text-pretty">
                  Nothing this semester yet.
                </p>
              )}

              {/* Last, under everything current, because it's where the rail stops
                  being about what you are doing now. */}
              {before.length > 0 && (
                <NavLink to="/dashboard/projects/past" className={linkClass}>
                  PAST PROJECTS
                </NavLink>
              )}
            </div>
          )}

          {(officer || leadsSomething) && (
            <div className="border-rule mt-5 border-t pt-5">
              <p className={groupLabelClass}>/ MANAGE</p>
              {locked ? (
                <>
                  {officer && (
                    <>
                      <LockedRow>ROLES</LockedRow>
                      <LockedRow>OFFICERS</LockedRow>
                      <LockedRow>SEMESTERS</LockedRow>
                      <LockedRow>SURVEY</LockedRow>
                      <LockedRow>FRONT PAGE</LockedRow>
                      <LockedRow>SPONSORS</LockedRow>
                      <LockedRow>PROJECTS</LockedRow>
                    </>
                  )}
                  <LockedRow>EVENTS</LockedRow>
                  {officer && (
                    <>
                      <LockedRow>PRINT QUEUE</LockedRow>
                      <LockedRow>EQUIPMENT</LockedRow>
                    </>
                  )}
                </>
              ) : (
                <>
                  {officer && (
                    <>
                      {/* First, because it is the desk about people and the
                          other three are about things. */}
                      <NavLink to="/dashboard/officer/roles" className={linkClass}>
                        ROLES
                      </NavLink>
                      {/* Second, directly under ROLES, because it's the same subject
                          over a longer span: that desk hands out today's chairs, this
                          one is the record of who has held them. */}
                      <NavLink
                        to="/dashboard/officer/officers"
                        className={linkClass}
                      >
                        OFFICERS
                      </NavLink>
                      {/* Next to ROLES rather than beside the queues, because both are
                          the club setting its own rules rather than working through a
                          list of things. */}
                      <NavLink to="/dashboard/officer/semesters" className={linkClass}>
                        SEMESTERS
                      </NavLink>
                      {/* Still on the club-rules side of the group: it is what
                          the members answered, not a queue anybody works. */}
                      <NavLink to="/dashboard/officer/survey" className={linkClass}>
                        SURVEY
                      </NavLink>
                      {/* Still on the club-rules side rather than beside PROJECTS,
                          which is the row it's most easily confused with: this is what
                          the club says about itself on the front page. It also keeps
                          PROJECTS and EVENTS next to each other, which the note below
                          that pair depends on. */}
                      <NavLink
                        to="/dashboard/officer/front-page"
                        className={linkClass}
                      >
                        FRONT PAGE
                      </NavLink>
                      {/* Directly under FRONT PAGE because it's the same job on a
                          different page. One row rather than three even though it
                          writes three tables — an officer thinks "the sponsor page",
                          not "sponsors, then tiers, then in-kind". */}
                      <NavLink
                        to="/dashboard/officer/sponsors"
                        className={linkClass}
                      >
                        SPONSORS
                      </NavLink>
                      <NavLink to="/dashboard/officer/projects" className={linkClass}>
                        PROJECTS
                      </NavLink>
                    </>
                  )}
                  {/* After PROJECTS and before the queues, where the group turns from
                      what the club curates to what somebody works through. It's also
                      the only row here a non-officer sees, so it sits next to the other
                      row about projects rather than stranded at the bottom. */}
                  <NavLink to="/dashboard/events" className={linkClass}>
                    EVENTS
                  </NavLink>
                  {officer && (
                    <>
                      <NavLink to="/dashboard/officer/print" className={linkClass}>
                        PRINT QUEUE
                      </NavLink>
                      <NavLink
                        to="/dashboard/officer/equipment"
                        className={linkClass}
                      >
                        EQUIPMENT
                      </NavLink>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* Two of the three lock reasons get a note here and one doesn't. A lapsed
              member is told nothing: the padlocks say the state, the overview carries
              the prompt to pay, and every page behind a lock explains itself when
              opened.

              `claim` is the one that would otherwise read as a bug — the club is
              charging them nothing and the rail is still closed, so it has to say the
              fix is free and one press. */}
          {why === 'claim' && (
            <div className="border-rule mt-5 border-t px-5 pt-5">
              <p className="text-faint text-[12px] leading-[1.5] text-pretty">
                Membership is free right now. One press opens all of this.
              </p>
              <Link
                to="/dashboard/dues"
                className="text-primary mt-2 inline-block font-mono text-[11px] font-medium tracking-[0.1em] underline underline-offset-2"
              >
                CLAIM MY MEMBERSHIP
              </Link>
            </div>
          )}

          {why === 'newcomer' && (
            <div className="border-rule mt-5 border-t px-5 pt-5">
              <p className="text-faint text-[12px] leading-[1.5] text-pretty">
                The printers and the club&rsquo;s tools are for members.
              </p>
              <Link
                to="/dashboard/dues"
                className="text-primary mt-2 inline-block font-mono text-[11px] font-medium tracking-[0.1em] underline underline-offset-2"
              >
                BECOME A MEMBER
              </Link>
            </div>
          )}
        </nav>
      </div>
    </aside>
  )
}

/**
 * A rail row that is not a link, because dues have lapsed.
 *
 * Still drawn, and drawn in place, rather than hidden. The tools haven't gone
 * anywhere — a lead is still a lead — and a menu that quietly loses three items reads
 * as something being broken rather than as something being owed.
 */
function LockedRow({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span
      aria-disabled="true"
      className={`text-faint flex items-center justify-between gap-2 border-l-2 border-transparent py-[7px] pr-4 pl-[18px] font-mono text-[11px] leading-snug font-medium tracking-[0.1em] ${className}`}
    >
      {/* The label in its own element, not a bare text node beside the badge:
          otherwise the row's only text content is "PRINT QUEUELOCKED", which is what a
          screen reader reads out and what a test would have to match. */}
      <span>{children}</span>
      <span className="text-faint/70 text-[9px] tracking-[0.14em]">LOCKED</span>
    </span>
  )
}

/**
 * Who you are, at the top of the rail, and the way to the profile page.
 *
 * Signing out lives behind this rather than at the bottom of the rail: it's a
 * once-a-term action sitting in a list of things people click daily, and the account
 * page is where somebody already goes looking for it.
 */
function ProfileLink({ user }: { user: ApiUser }) {
  return (
    <NavLink
      to="/dashboard/profile"
      className={({ isActive }) =>
        `border-rule flex items-center gap-3 border-b px-5 py-4 transition-colors duration-200 ${
          isActive ? 'bg-primary/10' : 'hover:bg-base-content/5'
        }`
      }
    >
      <Avatar
        fullName={user.fullName}
        photoUrl={user.photoUrl}
        framing={{
          focalX: user.photoFocalX,
          focalY: user.photoFocalY,
          zoom: user.photoZoom,
        }}
        tone="outline"
        className="size-9 text-[12px]"
      />
      <span className="min-w-0">
        <span className="block truncate text-[13px] leading-tight font-semibold">
          {user.fullName}
        </span>
        <span className="text-faint mt-[3px] block font-mono text-[9px] leading-none font-medium tracking-[0.16em]">
          {user.role.replace(/_/g, ' ')}
        </span>
      </span>
    </NavLink>
  )
}
