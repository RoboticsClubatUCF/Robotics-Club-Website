import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router'
import { BrandMark } from './BrandMark'
import { Avatar } from '../shared/Avatar'
import { pageLinks, sectionLinks, type NavLink } from '../../content/home'
import { useSession } from '../../lib/auth/session'

/**
 * Sticky top bar. The blur is what lets the page-coloured background sit at 90% opacity
 * — content scrolling underneath stays suggested rather than legible.
 *
 * The links are two lists with a rule between them, and the split is the point. On the
 * left, in the order the front page runs them, are the sections of that page; on the
 * right is everywhere else on the site, ending in the gold button. One kind of link moves
 * the page under you and the other replaces it, and a bar that shuffled the two together
 * made every word a coin toss.
 *
 * Below the breakpoint the links move into a panel under the bar. The bar keeps three
 * things at every width — the mark, the call-to-action button and the menu toggle —
 * because a phone is where most people first hit the site and that button is the only
 * reason the bar exists.
 *
 * Signing in swaps the right-hand end and nothing else: the last page link goes from
 * "Sign in" to "Dashboard", and the gold button becomes the avatar.
 */

/**
 * The row was `gap-7` while it held five links and no rule. The split costs a divider and
 * two gaps on top of the sixth link, and 900px is a real width somebody browses at — this
 * is what keeps the whole bar on one line there.
 */
const rowGap = 'gap-5'

const rowLinkClass =
  'text-dim text-[13px] font-medium transition-colors duration-200 hover:text-base-content'

export function SiteNav() {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const { session } = useSession()

  const signedIn = session.status === 'signed-in'

  /**
   * The last page link is whichever of the two the visitor can actually use. Neither is a
   * second button beside the gold one — the bar is already three things wide at 320px, and
   * a page with two buttons has no primary action.
   *
   * "Dashboard" is the whole section, where the avatar beside it is one page of it. Signed
   * out that link would only land on `/login`, which is what the link it replaces already
   * says, so the signed-out bar keeps the honest word.
   *
   * "Sign in" is also what shows while the session is still being read: nearly everybody
   * arriving here is signed out, so it's the state that stays put for most people.
   */
  const pages: NavLink[] = signedIn
    ? [...pageLinks, { href: '/dashboard', label: 'Dashboard' }]
    : [...pageLinks, { href: '/login', label: 'Sign in' }]


  useEffect(() => {
    if (!open) return

    // A menu that outlives its trigger needs a way out that isn't the trigger. Only while
    // open: a listener per page load, for a panel almost nobody has opened, is a listener
    // for nothing.
    const onKeyDown = (key: KeyboardEvent) => {
      if (key.key === 'Escape') setOpen(false)
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <header className="border-rule bg-base-100/90 sticky top-0 z-30 border-b backdrop-blur-sm">
      <nav className="navbar px-page gap-3 py-4 wide:gap-6 wide:py-5">
        {/* The site root, not `#top`. A masthead is the way back to the home page from
            wherever you are, and `#top` would only scroll you to the top of the page you
            were already on. */}
        <Link to="/" className="flex min-w-0 flex-1 items-center gap-2.5 wide:gap-3.5">
          <BrandMark className="w-8 shrink-0 wide:w-10" />
          <span className="min-w-0">
            <span className="block text-[13px] leading-none font-bold tracking-[0.06em]">
              ROBOTICS CLUB
            </span>
            {/* Truncates rather than wrapping on the narrowest phones: a two-line masthead
                pushes the bar's height around, and the club's name is worth keeping over
                the last two words of it. */}
            <span className="text-primary mt-[3px] block truncate font-mono text-[9px] leading-none font-medium tracking-[0.22em]">
              OF CENTRAL FLORIDA
            </span>
          </span>
        </Link>

        {/* Two lists, a rule, and the gold button after them. The lists are labelled as
            well as separated: the rule says "these are two kinds of thing" to everyone who
            can see it, and the labels say the same to everyone who cannot. */}
        <div className={`hidden items-center wide:flex ${rowGap}`}>
          <ul
            aria-label="Sections of this page"
            className={`flex items-center ${rowGap}`}
          >
            {sectionLinks.map((link) => (
              <li key={link.href}>
                <NavAnchor link={link} className={rowLinkClass} />
              </li>
            ))}
          </ul>

          {/* A hairline rather than a `|` glyph — every other divider here is one, and a
              pipe set in the body face sits at the wrong height beside two rows of links.
              Hidden from the accessibility tree: the labels carry what it means, and
              "vertical line" read out between two lists carries nothing. */}
          <span aria-hidden className="bg-rule h-4 w-px shrink-0" />

          <ul aria-label="Other pages" className={`flex items-center ${rowGap}`}>
            {pages.map((link) => (
              <li key={link.href}>
                <NavAnchor link={link} className={rowLinkClass} />
              </li>
            ))}
          </ul>
        </div>

        {/* The whole reason the bar exists — while you're signed out. It used to point at
            the FAQ, which is where becoming a member was explained while there was nowhere
            to actually do it. */}
        {signedIn ? (
          /* Signed in, this is the avatar instead: at that point the bar's job is "who am I
             and how do I get to my things", and a button spelling out MY DASHBOARD was the
             widest way to say it. It goes to the account page rather than the dashboard
             root because that's what a picture of a person promises. */
          <Link
            to="/dashboard/profile"
            aria-label={`Your account, ${session.user.fullName}`}
            className="focus-visible:outline-primary shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <Avatar
              fullName={session.user.fullName}
              photoUrl={session.user.photoUrl}
              framing={{
                focalX: session.user.photoFocalX,
                focalY: session.user.photoFocalY,
                zoom: session.user.photoZoom,
              }}
              className="size-9 text-[12px] hover:opacity-85 wide:size-10 wide:text-[13px]"
            />
          </Link>
        ) : (
          <Link
            to="/join"
            className="btn btn-primary btn-cta shrink-0 px-3.5 py-2.5 text-[11px] font-semibold wide:px-4.5 wide:text-xs"
          >
            <span className="wide:hidden">JOIN</span>
            <span className="hidden wide:inline">JOIN THE CLUB</span>
          </Link>
        )}

        <button
          type="button"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => {
            setOpen(!open)
          }}
          className="border-rule text-dim hover:border-primary hover:text-primary focus-visible:outline-primary flex size-10 shrink-0 cursor-pointer items-center justify-center border transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 wide:hidden"
        >
          <MenuIcon open={open} />
        </button>
      </nav>

      {/* Under the bar rather than over the page: a full-screen overlay would need focus
          trapping and a scroll lock to be honest, and this menu is seven links. `hidden`
          rather than unmounted so the open transition has a node to run on. */}
      <div
        id={menuId}
        className={`border-rule bg-base-100 overflow-hidden border-t transition-[opacity,transform] duration-200 transition-discrete wide:hidden ${
          open
            ? 'block translate-y-0 opacity-100 starting:-translate-y-2 starting:opacity-0'
            : 'hidden -translate-y-2 opacity-0'
        }`}
      >
        {/* The same two lists in the same order. A vertical stack can't use the row's rule
            — every row already has one — so the break between them is the gap. */}
        <div className="px-page flex flex-col gap-3 py-2">
          <MenuList
            label="Sections of this page"
            links={sectionLinks}
            onNavigate={() => {
              setOpen(false)
            }}
          />
          <MenuList
            label="Other pages"
            links={pages}
            onNavigate={() => {
              setOpen(false)
            }}
          />
        </div>
      </div>
    </header>
  )
}

/** One group of links in the phone panel. */
function MenuList({
  label,
  links,
  onNavigate,
}: {
  label: string
  links: NavLink[]
  onNavigate: () => void
}) {
  return (
    <ul aria-label={label} className="flex flex-col">
      {links.map((link) => (
        <li key={link.href} className="border-rule border-b last:border-b-0">
          <NavAnchor
            link={link}
            onNavigate={onNavigate}
            /* Full-width and 48px tall: a nav link on a phone is a thumb target, not a
               word. */
            className="hover:text-primary flex min-h-12 items-center text-sm font-medium transition-colors duration-200"
          />
        </li>
      ))}
    </ul>
  )
}

/**
 * One nav link, drawn as whichever kind of link it actually is.
 *
 * Anything carrying a hash stays a plain `<a>`. Those go to a section of the front page,
 * and the browser's own handling is the thing that works: from the front page it's an
 * in-page scroll, from anywhere else a load that lands on the right section. React Router
 * would take over the navigation and then not scroll anywhere.
 */
function NavAnchor({
  link,
  className,
  onNavigate,
}: {
  link: { href: string; label: string }
  className: string
  onNavigate?: () => void
}) {
  if (link.href.includes('#')) {
    return (
      <a href={link.href} onClick={onNavigate} className={className}>
        {link.label}
      </a>
    )
  }

  return (
    <Link to={link.href} onClick={onNavigate} className={className}>
      {link.label}
    </Link>
  )
}

/**
 * Two bars that become a cross. Drawn rather than imported: an icon package for one glyph
 * is a dependency for one glyph, and the animation between the two states is the whole
 * point of it being here.
 */
function MenuIcon({ open }: { open: boolean }) {
  const bar =
    'absolute h-px w-4.5 bg-current transition-transform duration-200'

  return (
    <span aria-hidden className="relative flex size-4.5 items-center justify-center">
      <span
        className={`${bar} ${open ? 'rotate-45' : '-translate-y-1'}`}
      />
      <span
        className={`${bar} ${open ? '-rotate-45' : 'translate-y-1'}`}
      />
    </span>
  )
}
