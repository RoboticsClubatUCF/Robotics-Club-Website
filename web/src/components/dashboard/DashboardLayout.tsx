import { Suspense, type ReactNode, useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { ApiError, getJson } from '../../lib/api/api'
import type {
  ApiDuesStatus,
  ApiMembership,
  ApiMyProject,
  ApiUser,
} from '../../lib/api/api'
import { accessLock, duesLocked } from '../../lib/dues/dues'
import { isOfficer, useSession } from '../../lib/auth/session'
import type { ApiState } from '../../lib/api/useApi'
import { Avatar } from '../shared/Avatar'
import { SurveyRequiredDialog } from './SurveyRequiredDialog'
import {
  FormEyebrow,
  FormHeading,
  FormPage,
  FormPanel,
} from '../shared/formChrome'

/**
 * The frame around every dashboard page: one session gate, one rail, one fetch
 * of "my projects" shared with everything inside.
 *
 * The gate lives here and nowhere else — child pages render on the assumption
 * that somebody is signed in, because this component has already redirected
 * anyone who is not. The `state.from` on that redirect is what brings a person
 * back to the page they asked for once they have signed in.
 *
 * `/me/projects` is fetched once and passed down through outlet context
 * rather than fetched per page: the rail needs it for the project links, the
 * overview needs it for the project cards, and `useApi` has no cache to make
 * asking twice cheap.
 *
 * The rail's `/ MANAGE` group is the officer desks plus EVENTS, which project
 * leads reach too — so the group is gated by the global role *or* by holding a
 * lead's rank on any membership, and its rows are gated individually. Cosmetics
 * only either way, since every route behind it re-checks on the server. It is
 * named for what those pages do rather than for who may open them: a group
 * headed OFFICERS describes the reader, and the reader already knows — which is
 * also why one row for a lead does not make it a different group. Project links
 * carry rank the same way — the per-project MANAGE link appears for leads, and
 * the server would refuse anyone else anyway.
 *
 * **Everything the dashboard offers is a route under `/dashboard`.** Dues used
 * to be the exception and it was the wrong shape — clicking a rail link and
 * losing the rail is the sort of thing that makes a section feel like a set of
 * separate pages that happen to share a heading. `/dues` still resolves, as a
 * redirect, because it is in Stripe return URLs and in people's history.
 */
export interface DashboardContext {
  user: ApiUser
  projects: ApiState<ApiMyProject[]>
  /** Call after anything that changes a membership — joining, leaving, team
      edits — so the rail and overview agree with what just happened. */
  reloadProjects: () => Promise<void>
  /**
   * Where this person stands on dues, fetched once for the whole section — the
   * rail needs it to lock, the overview needs it to draw the panel, and asking
   * twice would be two reads of UCF's calendar per page.
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
        // **The search string too, not just the path.** The email-change
        // confirmation lands on `/dashboard/profile?emailToken=…`, and somebody
        // following that link from a phone is usually not signed in there — so
        // it round-trips through this redirect. Dropping the query would bring
        // them back to the profile page with the token gone and nothing to say
        // why the confirmation did not happen. Same lesson as the `/dues`
        // redirect in `App.tsx`, which is commented for exactly this reason.
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
 * Split from the gate so the `/me/projects` request only ever fires for
 * somebody signed in — mounted earlier, it would 401 into the console of
 * every visitor on their way to the login page.
 *
 * The fetch is hand-rolled rather than `useApi` for the same reason the dues
 * page's is: children mutate memberships, and a hook with no refetch would
 * leave the rail describing the world as it was before the click.
 *
 * No `px-page` on the outer element, and that is the whole layout decision.
 * The rail is flush to the left edge of the viewport with its own surface and
 * one hairline down its right side, so it reads as a fixed piece of furniture
 * rather than as a column of links that happens to be first. The gutter moves
 * onto the content column, which is the only thing that still wants one.
 */
function DashboardShell({ user }: { user: ApiUser }) {
  const location = useLocation()
  /**
   * Dismissed for the rest of this page session, and deliberately not
   * persisted. Nothing is bypassed by it — the rail stays locked and every
   * route still refuses — so the worst a reload can do is ask again, which is
   * the right side to err on for a prompt somebody has to act on eventually.
   */
  const [surveyPrompted, setSurveyPrompted] = useState(false)
  const dismissSurveyPrompt = useCallback(() => {
    setSurveyPrompted(true)
  }, [])

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
   * The survey prompt, and the two pages it stays off.
   *
   * `/dashboard/survey` for the obvious reason, and `/dashboard/profile`
   * because that is where signing out lives — a prompt covering the way out of
   * an account is the one version of this that could genuinely strand somebody.
   * Reading the reason from `accessLock` rather than from the membership
   * directly is what keeps the `ADMIN` exemption and the "nothing until it is
   * `ready`" rule in one place instead of two.
   */
  const owesSurvey = accessLock(membership, user.role) === 'survey'
  const promptable =
    !location.pathname.startsWith('/dashboard/survey') &&
    !location.pathname.startsWith('/dashboard/profile')

  return (
    <div className="wide:grid wide:grid-cols-[15rem_1fr]">
      <DashboardNav user={user} projects={projects} membership={membership} />

      {owesSurvey && promptable && !surveyPrompted && (
        <SurveyRequiredDialog onLater={dismissSurveyPrompt} />
      )}

      <div className="px-page min-w-0 py-9 wide:py-12">
        {/* Still left-aligned rather than centred in the remaining space: the
            rail is the left edge of the layout, and content that drifted away
            from it would put the canyon *between* the two, which reads as a
            layout that has come apart.

            The cap is what changed. 62rem was a reading measure applied to a
            whole section, and it was the wrong thing to measure: on anything
            wider than a laptop it left a third of the screen empty while the
            pages inside it stacked into one narrow column. The measure belongs
            to the panels — every page in here lays out with `grid-fluid`, so a
            column stays a readable width however much room there is — and this
            only has to stop the widest monitors drawing a 2000px row of
            controls. */}
        <div className="min-w-0 max-w-[112rem]">
          {/* Every page under here is fetched on first use — see the note at
              the top of `App.tsx`. The boundary is *inside* the layout on
              purpose: the rail is what somebody navigates with, so it stays
              on screen while the next page arrives rather than the whole
              dashboard blinking out and back.

              The fallback reserves height and says nothing. It is on screen
              for a few hundred milliseconds once per session, and the pages
              behind it draw their own skeletons for the data they then fetch —
              a second spinner in front of those would be two loading states
              for one navigation. `aria-busy` rather than `role="status"`,
              matching `LabStatus`: there is no message to announce. */}
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
 * A rail row. The gold bar down the left edge is what marks the current page —
 * colour alone was doing that job before, and on a list of gold-on-hover links
 * "which one am I on" came down to noticing a shade.
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
 * The collapse is React state and a `hidden` class rather than a `<details>`,
 * matching `SiteNav`: the same list has to be permanently open at `wide:`, and
 * a `<details>` cannot be forced open from CSS.
 *
 * Groups appear only when they have something in them — an empty MY PROJECTS
 * heading would just be the sad version of the overview's empty state.
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
  // Split rather than filtered at the source: the context carries every
  // membership because a *past* project's pages still have to resolve, and the
  // rail is the one place that only wants the ones running now.
  const thisTerm = mine.filter(({ current }) => current)
  const before = mine.filter(({ current }) => !current)
  // The `/ MANAGE` group is officers only, every row of it but one. It briefly
  // had a fourth audience: somebody carrying a `PROJECT_LEAD` roster label could
  // start one project of their own. That label is not a role any more — leading
  // a project is a fact about a membership row — and the delegation went with it.
  const officer = isOfficer(user.role)
  // **EVENTS is the exception, and it is a different kind of claim.** The old
  // delegation read a global label and let it stand for project authority, which
  // is the bug class this codebase keeps warning about. This reads the
  // membership rows themselves: somebody who leads a project or a team may
  // schedule things on it, which is the same permission `requireEventManager`
  // has always granted on the server. The group appears for them with this one
  // row in it; the six below stay behind `officer`.
  const leadsSomething = mine.some(({ rank }) => rank !== 'MEMBER')
  const locked = duesLocked(membership, user.role)
  // The *reason*, for the one note at the bottom of the rail that has to name
  // it. There used to be a second, stricter lock here — printing and borrowing
  // refused a guest whatever their standing — and it is gone: access is the
  // dues date now, so every locked row in this rail is locked by the same
  // condition. `locked` is that condition; this is only which sentence.
  const why = accessLock(membership, user.role)

  // Following a link on a phone has to put the menu away, or the page you asked
  // for opens underneath the list you asked for it from.
  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  return (
    <aside className="border-rule bg-base-200 border-b wide:min-h-[calc(100dvh-var(--spacing-nav))] wide:border-r wide:border-b-0">
      {/* Sticky on the inner element, not the aside: the aside has to stretch
          to the height of the row for its surface to read as a rail, and a
          sticky box only ever occupies its own content. */}
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
            {/* Never locked, and it sits in `/ GENERAL` rather than in
                `/ MANAGE` even though leads write tasks from it. Two reasons,
                and they are the same reason: it is a page about work somebody
                is already doing, like `/ MY PROJECTS`, and the server does not
                gate reading it. A row a lapsed member could open anyway is not
                a row to draw a padlock on. */}
            <NavLink to="/dashboard/tasks" className={linkClass}>
              TASKS
            </NavLink>
            {/* Only while it is owed. A permanent row for something you do once
                is dead weight in a list somebody opens every day — the way back
                to the answers afterwards is the overview's panel. */}
            {why === 'survey' && (
              <NavLink to="/dashboard/survey" className={linkClass}>
                MEMBER SURVEY
              </NavLink>
            )}
            {/* **Dues is lockable now**, and it is the one row here that used
                not to be. It was the page every other lock linked to, so it had
                to stay open whatever somebody's standing; the survey sits in
                front of it — on the server too — so while that is owed this is
                shut like everything else, and the row above is the way out. */}
            {why === 'survey' ? (
              <LockedRow>DUES &amp; PAYMENTS</LockedRow>
            ) : (
              <NavLink to="/dashboard/dues" className={linkClass}>
                DUES &amp; PAYMENTS
              </NavLink>
            )}
            {/* Locked by the same condition as everything else below: the
                club's line is that an uncovered account gets this page and its
                own projects, and both of these are the club spending money on
                somebody. */}
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

              {/* Somebody with projects, none of them this term. Said here
                  rather than left as a heading with nothing under it — a group
                  that appears empty reads as a list that failed to load, and
                  the row below is the answer to the question it raises. */}
              {thisTerm.length === 0 && (
                <p className="text-faint px-5 pb-1 text-[12px] leading-[1.5] text-pretty">
                  Nothing this semester yet.
                </p>
              )}

              {/* Last, under everything current, because it is where the rail
                  stops being about what you are doing now. */}
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
                      {/* Second, and next to ROLES rather than beside the queues,
                          because both are the club setting its own rules rather
                          than working through a list of things. */}
                      <NavLink to="/dashboard/officer/semesters" className={linkClass}>
                        SEMESTERS
                      </NavLink>
                      {/* Third, still on the club-rules side of the group: it is
                          what the members answered, not a queue anybody works. */}
                      <NavLink to="/dashboard/officer/survey" className={linkClass}>
                        SURVEY
                      </NavLink>
                      {/* Fourth, and still on the club-rules side rather than
                          beside PROJECTS, which is the row it is most easily
                          confused with: this is what the club says about itself
                          on the front page, not a list of things anybody works
                          through. It also keeps PROJECTS and EVENTS next to each
                          other, which the note below that pair depends on. */}
                      <NavLink
                        to="/dashboard/officer/front-page"
                        className={linkClass}
                      >
                        FRONT PAGE
                      </NavLink>
                      {/* Fifth, and directly under FRONT PAGE because it is the
                          same job on a different page: what the club says about
                          itself in public. It is one row rather than three even
                          though it writes three tables — an officer does not
                          think "sponsors, then tiers, then in-kind", they think
                          "the sponsor page". */}
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
                  {/* After PROJECTS and before the queues, which is where the
                      group turns from what the club curates to what somebody
                      works through. An event is curated; a print request is
                      queued. It is also the only row here a non-officer sees,
                      so it sits next to the other row about projects rather
                      than stranded at the bottom of a list they cannot open. */}
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

          {/* Three of the four lock reasons get a note here and one does not.
              A *lapsed* member is told nothing: the padlocks say the state, the
              overview carries the prompt to pay, and every page behind a lock
              explains itself when opened — a paragraph in the rail as well made
              the same point a fourth time, on every screen, to somebody who
              already knows.

              The others have nothing else telling them why half the rail is
              shut. `claim` is the one that would otherwise read as a bug: the
              club is charging them nothing and the rail is still closed, so it
              has to say that the fix is free and one press. `survey` is the
              one where even the dues page is shut, so the note is the only
              thing on screen naming the way through — the dialog over the top
              of it can be dismissed, this cannot. */}
          {why === 'survey' && (
            <div className="border-rule mt-5 border-t px-5 pt-5">
              <p className="text-faint text-[12px] leading-[1.5] text-pretty">
                Two minutes of questions, asked once, and all of this opens.
              </p>
              <Link
                to="/dashboard/survey"
                className="text-primary mt-2 inline-block font-mono text-[11px] font-medium tracking-[0.1em] underline underline-offset-2"
              >
                FILL IN THE SURVEY
              </Link>
            </div>
          )}

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
 * Still drawn, and drawn in place, rather than hidden. The tools have not gone
 * anywhere — a lead is still a lead — and a menu that quietly loses three items
 * reads as something being broken rather than as something being owed.
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
          otherwise the row's only text content is "PRINT QUEUELOCKED", which is
          what a screen reader reads out and what a test would have to match. */}
      <span>{children}</span>
      <span className="text-faint/70 text-[9px] tracking-[0.14em]">LOCKED</span>
    </span>
  )
}

/**
 * Who you are, at the top of the rail, and the way to the profile page.
 *
 * Signing out lives behind this rather than at the bottom of the rail. It is a
 * once-a-term action sitting in a list of things people click daily, and the
 * account page is where somebody already goes looking for it.
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
