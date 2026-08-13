import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { ApiError, getJson } from '../../lib/api'
import type {
  ApiDuesStatus,
  ApiMembership,
  ApiMyProject,
  ApiUser,
} from '../../lib/api'
import { duesLocked, memberLocked } from '../../lib/dues'
import { useSession } from '../../lib/session'
import type { ApiState } from '../../lib/useApi'
import { Avatar } from '../shared/Avatar'
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
 * The rail's `/ MANAGE` group is the officer desks, and it is shown or hidden by
 * the *global* role — cosmetics only, since every route behind it re-checks on
 * the server. It is named for what those pages do rather than for who may open
 * them: a group headed OFFICERS describes the reader, and the reader already
 * knows. Project links carry rank the same way — the per-project MANAGE link
 * appears for leads, and the server would refuse anyone else anyway.
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
        state: { from: location.pathname },
      })
    }
  }, [session.status, navigate, location.pathname])

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
            Your account is fine — this page just couldn't check who you are.
            Try again in a moment.
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

  return (
    <div className="wide:grid wide:grid-cols-[15rem_1fr]">
      <DashboardNav user={user} projects={projects} membership={membership} />

      <div className="px-page min-w-0 py-9 wide:py-12">
        {/* Capped and left-aligned rather than centred in the remaining space:
            the rail is the left edge of the layout now, and content that
            drifted away from it on a wide monitor would leave a canyon. */}
        <div className="min-w-0 max-w-[62rem]">
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
      : 'border-transparent text-dim hover:bg-white/5 hover:text-white'
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
  // The `/ MANAGE` group is officers only, all three rows of it. It briefly had
  // a fourth audience: somebody carrying a `PROJECT_LEAD` roster label could
  // start one project of their own. That label is not a role any more — leading
  // a project is a fact about a membership row — and the delegation went with
  // it, so this is one condition again rather than two.
  const officer = user.role === 'ADMIN' || user.role === 'OFFICER'
  const locked = duesLocked(membership, user.role)
  // Stricter, and only for the two rows that spend club money: a guest is
  // refused those whatever their standing says. Nobody holding a rank is a
  // guest, so the management rows below stay on `duesLocked`.
  const requests = memberLocked(membership, user.role)

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
            <NavLink to="/dashboard/dues" className={linkClass}>
              DUES &amp; PAYMENTS
            </NavLink>
            {/* Locked when dues lapse *and* for anybody who has not joined:
                the club's line is that an unpaid account gets this page and its
                own projects, and both of these are the club spending money on
                somebody. */}
            {requests ? (
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
              {mine.map(({ project, rank }) => (
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
            </div>
          )}

          {officer && (
            <div className="border-rule mt-5 border-t pt-5">
              <p className={groupLabelClass}>/ MANAGE</p>
              {locked ? (
                <>
                  <LockedRow>PROJECTS</LockedRow>
                  <LockedRow>PRINT QUEUE</LockedRow>
                  <LockedRow>EQUIPMENT</LockedRow>
                </>
              ) : (
                <>
                  <NavLink to="/dashboard/officer/projects" className={linkClass}>
                    PROJECTS
                  </NavLink>
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
            </div>
          )}

          {/* Only for somebody who has never joined, and only because they
              have nothing else telling them why half the rail is shut. A
              lapsed member has no note here on purpose: the padlocks say the
              state, the overview carries the prompt to pay, and every page
              behind a lock explains itself when opened — a paragraph in the
              rail as well made the same point a fourth time, on every screen,
              to somebody who already knows. */}
          {requests === 'guest' && (
            <div className="border-rule mt-5 border-t px-5 pt-5">
              <p className="text-faint text-[12px] leading-[1.5] text-pretty">
                The printers and the club&rsquo;s tools are for members. Joining
                takes one page &mdash; and over the summer it costs nothing.
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
          isActive ? 'bg-primary/10' : 'hover:bg-white/5'
        }`
      }
    >
      <Avatar fullName={user.fullName} tone="outline" className="size-9 text-[12px]" />
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
