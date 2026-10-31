import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import type { ApiMembership, ApiMyProject, ApiUser } from '../../lib/api/api'
import type { ApiState } from '../../lib/api/useApi'
import { accessLock, duesLocked, surveyPrompt } from '../../lib/dues/dues'
import { isOfficer, opensPrintQueue } from '../../lib/auth/session'
import {
  FRONT_PAGE_PAGES,
  PRINT_QUEUE_PAGES,
  PROFILE_PAGES,
  PROJECTS_DESK_PAGES,
  ROLES_PAGES,
  SPONSORS_PAGES,
  SURVEY_PAGES,
  projectPages,
  within,
  type SubPage,
} from '../../lib/dashboard/subPages'
import { useWide } from '../../lib/useWide'
import { Avatar } from '../shared/Avatar'

const groupLabelClass =
  'text-faint mb-2 px-5 font-mono text-[10px] font-medium tracking-[0.16em]'

/**
 * A rail row. The gold bar down the left edge marks the current page, since colour alone
 * made "which one am I on" a matter of noticing a shade. Rows grow to 44px below `wide`,
 * where they're tapped.
 */
const linkClass = ({ isActive }: { isActive: boolean }) =>
  `block border-l-2 py-[7px] pr-4 pl-[18px] font-mono text-[11px] leading-snug font-medium tracking-[0.1em] transition-colors duration-200 max-wide:py-[15px] ${
    isActive
      ? 'border-primary bg-primary/10 text-primary'
      : 'border-transparent text-dim hover:bg-base-content/5 hover:text-base-content'
  }`

/** A row inside a dropdown, hung off a hairline that lines up with its parent's label. */
const subLinkClass = ({ isActive }: { isActive: boolean }) =>
  `-ml-px block border-l-2 py-[6px] pr-4 pl-4 font-mono text-[10px] leading-snug font-medium tracking-[0.1em] transition-colors duration-200 max-wide:py-[15px] ${
    isActive
      ? 'border-primary text-primary'
      : 'border-transparent text-dim hover:text-base-content'
  }`

/**
 * The rail: a full-height options menu at `wide:`, a collapsible band above the content on
 * phones.
 *
 * The collapse is React state and a `hidden` class rather than a `<details>`, matching
 * `SiteNav`: the same list has to be permanently open at `wide:`, and a `<details>` can't be
 * forced open from CSS.
 *
 * Groups appear only when they have something in them. An empty MY PROJECTS heading would
 * just be the sad version of the overview's empty state.
 */
export function DashboardRail({
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
  // The context carries every membership because a past project's pages still have to
  // resolve. The rail only wants the ones running now.
  const thisTerm = mine.filter(({ current }) => current)
  const before = mine.filter(({ current }) => !current)
  const officer = isOfficer(user.role)
  // EVENTS is the one `/ MANAGE` row a non-officer gets. It reads the membership rows, the
  // same permission `requireEventManager` grants on the server, never a global label.
  const leadsSomething = mine.some(({ rank }) => rank !== 'MEMBER')
  // Operators work the queue and project leads decline their projects' prints there. Officers
  // get the whole PRINT QUEUE section instead of the one row.
  const printQueue =
    !officer &&
    opensPrintQueue(
      user.role,
      membership.status === 'ready' && membership.data.printOperator,
      mine,
    )
  const locked = duesLocked(membership, user.role)
  const why = accessLock(membership, user.role)
  // Not a lock reason: an unanswered survey shuts nothing. It only decides whether the rail
  // still offers the form.
  const asking = surveyPrompt(membership)

  // Following a link on a phone has to put the menu away, or the page you asked for opens
  // underneath the list you asked for it from.
  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  // At `wide` the rail scrolls on its own, and with a long section open the current row can
  // sit below its fold. Bring it into view after each navigation. On a phone the box doesn't
  // scroll and this does nothing.
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const box = scroller.current
    const row = box?.querySelector('[aria-current="page"]')
    if (!box || !row || box.scrollHeight <= box.clientHeight) return

    const shown = box.getBoundingClientRect()
    const at = row.getBoundingClientRect()
    if (at.top < shown.top || at.bottom > shown.bottom) {
      box.scrollTop += at.top - shown.top - shown.height / 3
    }
  }, [location.pathname])

  return (
    <aside className="border-rule bg-base-200 border-b wide:min-h-[calc(100dvh-var(--spacing-nav))] wide:border-r wide:border-b-0">
      {/* Sticky on the inner element, not the aside: the aside has to stretch to the
          height of the row for its surface to read as a rail, and a sticky box only
          ever occupies its own content. */}
      <div
        ref={scroller}
        className="wide:sticky wide:top-nav wide:max-h-[calc(100dvh-var(--spacing-nav))] wide:overflow-y-auto"
      >
        <ProfileHead user={user} />

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
            {/* Only while the survey is still being asked for, on the same predicate as
                the prompt, so one checkbox turns both off. */}
            {asking && (
              <NavLink to="/dashboard/survey" className={linkClass}>
                MEMBER SURVEY
              </NavLink>
            )}
            {/* Never locked. It's the page every other lock links to. */}
            <NavLink to="/dashboard/dues" className={linkClass}>
              DUES &amp; PAYMENTS
            </NavLink>
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
              {thisTerm.map(({ project, rank }) => {
                const label = project.title.toUpperCase()
                const page = `/dashboard/projects/${project.slug}`

                // A lapsed lead keeps the project and loses the tools, so the manage
                // pages collapse to one padlocked row rather than a dropdown of them.
                if (rank !== 'MEMBER' && !locked) {
                  return (
                    <RailSection
                      key={project.id}
                      label={label}
                      // The manage page gives an officer the project lead's view
                      // whatever their rank, so the rail lists that view's pages.
                      pages={projectPages(
                        project.slug,
                        officer ? 'PROJECT_LEAD' : rank,
                      )}
                    />
                  )
                }

                return (
                  <div key={project.id}>
                    <NavLink to={page} className={linkClass}>
                      {label}
                    </NavLink>
                    {rank !== 'MEMBER' && (
                      <LockedRow className="pl-9 text-[10px]">MANAGE</LockedRow>
                    )}
                  </div>
                )
              })}

              {/* Somebody with projects, none of them this term. A group that appears
                  empty reads as a list that failed to load. */}
              {thisTerm.length === 0 && (
                <p className="text-faint px-5 pb-1 text-[12px] leading-[1.5] text-pretty">
                  Nothing this semester yet.
                </p>
              )}

              {before.length > 0 && (
                <NavLink to="/dashboard/projects/past" className={linkClass}>
                  PAST PROJECTS
                </NavLink>
              )}
            </div>
          )}

          {(officer || leadsSomething || printQueue) && (
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
                  {(officer || leadsSomething) && <LockedRow>EVENTS</LockedRow>}
                  {printQueue && <LockedRow>PRINT QUEUE</LockedRow>}
                  {officer && (
                    <>
                      <LockedRow>PRINT QUEUE</LockedRow>
                      <LockedRow>EQUIPMENT</LockedRow>
                    </>
                  )}
                </>
              ) : (
                <>
                  {/* The club setting its rules and curating first, then from EVENTS on
                      the queues. EVENTS sits beside PROJECTS because it's the one row a
                      lead sees, and it shouldn't be stranded at the bottom. */}
                  {officer && (
                    <>
                      <RailSection label="ROLES" pages={ROLES_PAGES} />
                      <NavLink to="/dashboard/officer/officers" className={linkClass}>
                        OFFICERS
                      </NavLink>
                      <NavLink to="/dashboard/officer/semesters" className={linkClass}>
                        SEMESTERS
                      </NavLink>
                      <RailSection label="SURVEY" pages={SURVEY_PAGES} />
                      <RailSection label="FRONT PAGE" pages={FRONT_PAGE_PAGES} />
                      <RailSection label="SPONSORS" pages={SPONSORS_PAGES} />
                      <RailSection label="PROJECTS" pages={PROJECTS_DESK_PAGES} />
                    </>
                  )}
                  {(officer || leadsSomething) && (
                    <NavLink to="/dashboard/events" className={linkClass}>
                      EVENTS
                    </NavLink>
                  )}
                  {printQueue && (
                    <NavLink to="/dashboard/officer/print" className={linkClass}>
                      PRINT QUEUE
                    </NavLink>
                  )}
                  {officer && (
                    <>
                      <RailSection label="PRINT QUEUE" pages={PRINT_QUEUE_PAGES} />
                      <NavLink to="/dashboard/officer/equipment" className={linkClass}>
                        EQUIPMENT
                      </NavLink>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* A lapsed member gets no note: the padlocks say it, and the overview carries
              the prompt to pay. `claim` gets one because a closed rail for a free
              membership would otherwise read as a bug. */}
          {why === 'claim' && (
            <RailNote
              text="Membership is free right now. One press opens all of this."
              action="CLAIM MY MEMBERSHIP"
            />
          )}

          {why === 'newcomer' && (
            <RailNote
              text="The printers and the club’s tools are for members."
              action="BECOME A MEMBER"
            />
          )}
        </nav>
      </div>
    </aside>
  )
}

/**
 * Open while you're inside the section, shut once you leave it, so a session of visiting
 * desks doesn't leave every one of them open.
 *
 * A press overrides that until you next arrive in or leave the section: opening one to look
 * keeps it open as you move around elsewhere, and shutting the one you're in keeps it shut
 * while you move between its pages. The reset happens during render rather than in an
 * effect, so the rail never paints a frame with the current section shut.
 */
function useDropdown(pages: readonly SubPage[], openInside = true) {
  const { pathname } = useLocation()
  const inside = within(pathname, pages)
  const [pressed, setPressed] = useState<boolean | null>(null)
  const [wasInside, setWasInside] = useState(inside)

  if (inside !== wasInside) {
    setWasInside(inside)
    setPressed(null)
  }

  const open = pressed ?? (inside && openInside)

  return {
    open,
    toggle: () => {
      setPressed(!open)
    },
  }
}

/**
 * A rail row with sub-pages: the label goes to the first of them, and the chevron beside it
 * shows the rest without leaving the page you're on.
 *
 * The label stays a link rather than becoming the toggle, so a section is still one press
 * away. The parent's `NavLink` has no `end`, so it stays lit on every sub-page, and it says
 * `aria-current="true"` (this section) rather than "page", which belongs to the sub-page.
 */
function RailSection({
  label,
  pages,
}: {
  label: string
  pages: readonly SubPage[]
}) {
  const id = useId()
  const { open, toggle } = useDropdown(pages)

  return (
    <div>
      <div className="relative">
        <NavLink
          to={pages[0].to}
          aria-current="true"
          className={(state) => `${linkClass(state)} pr-12`}
        >
          {label}
        </NavLink>
        <DropdownToggle label={label} controls={id} open={open} onToggle={toggle} />
      </div>
      <SubList id={id} open={open} pages={pages} />
    </div>
  )
}

function DropdownToggle({
  label,
  controls,
  open,
  onToggle,
}: {
  label: string
  controls: string
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      aria-label={`${label} pages`}
      onClick={onToggle}
      className="text-faint hover:text-primary focus-visible:outline-primary absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center text-[13px] transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2"
    >
      <span
        aria-hidden
        className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
      >
        ›
      </span>
    </button>
  )
}

function SubList({
  id,
  open,
  pages,
}: {
  id: string
  open: boolean
  pages: readonly SubPage[]
}) {
  return (
    <ul id={id} hidden={!open} className="border-rule mb-1.5 ml-[18px] border-l">
      {pages.map(({ label, to }) => (
        <li key={to}>
          <NavLink to={to} end className={subLinkClass}>
            {label}
          </NavLink>
        </li>
      ))}
    </ul>
  )
}

/**
 * A rail row that is not a link, because dues have lapsed. Drawn in place rather than
 * hidden: a menu that quietly loses rows reads as broken rather than as owed.
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
      className={`text-faint flex items-center justify-between gap-2 border-l-2 border-transparent py-[7px] pr-4 pl-[18px] font-mono text-[11px] leading-snug font-medium tracking-[0.1em] max-wide:py-[15px] ${className}`}
    >
      {/* Its own element, or the row's text reads "PRINT QUEUELOCKED". */}
      <span>{children}</span>
      <span className="text-faint/70 text-[9px] tracking-[0.14em]">LOCKED</span>
    </span>
  )
}

function RailNote({ text, action }: { text: string; action: string }) {
  return (
    <div className="border-rule mt-5 border-t px-5 pt-5">
      <p className="text-faint text-[12px] leading-[1.5] text-pretty">{text}</p>
      <Link
        to="/dashboard/dues"
        className="text-primary mt-2 inline-block font-mono text-[11px] font-medium tracking-[0.1em] underline underline-offset-2"
      >
        {action}
      </Link>
    </div>
  )
}

/**
 * Who you are, at the top of the rail, with the profile pages folded under it. Outside the
 * phone's MENU, so they're one press away at any width.
 *
 * It only opens itself at `wide`. On a phone it sits above every page, and the profile pages
 * already list their siblings under the heading.
 */
function ProfileHead({ user }: { user: ApiUser }) {
  const id = useId()
  const wide = useWide()
  const { open, toggle } = useDropdown(PROFILE_PAGES, wide)

  return (
    <div className="border-rule border-b">
      <div className="relative">
        <NavLink
          to={PROFILE_PAGES[0].to}
          aria-current="true"
          className={({ isActive }) =>
            `flex items-center gap-3 py-4 pr-12 pl-5 transition-colors duration-200 ${
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
        <DropdownToggle label="Profile" controls={id} open={open} onToggle={toggle} />
      </div>
      <div hidden={!open} className="pb-3">
        <SubList id={id} open={open} pages={PROFILE_PAGES} />
      </div>
    </div>
  )
}
