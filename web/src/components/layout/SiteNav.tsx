import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router'
import { BrandMark } from './BrandMark'
import { navLinks } from '../../content/home'

/**
 * Sticky top bar. The blur is what lets the near-black background sit at 90%
 * opacity — content scrolling underneath stays suggested rather than legible.
 *
 * Below the breakpoint the links move into a panel under the bar. The bar keeps
 * three things at every width — the mark, the join button and the menu toggle —
 * because a phone is where most people first hit the site and the join button is
 * the only reason the bar exists. Fitting all three inside 320px is why the
 * button says "JOIN" there and "JOIN THE CLUB" above the breakpoint.
 */
export function SiteNav() {
  const [open, setOpen] = useState(false)
  const menuId = useId()

  useEffect(() => {
    if (!open) return

    // A menu that outlives its trigger needs a way out that isn't the trigger.
    // Only while open: a listener per page load, for a panel almost nobody has
    // opened, is a listener for nothing.
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
        {/* The site root, not `#top`. A masthead is the way back to the home
            page from wherever you are, and `#top` would only ever scroll you to
            the top of the page you were already on. */}
        <Link to="/" className="flex min-w-0 flex-1 items-center gap-2.5 wide:gap-3.5">
          <BrandMark className="w-8 shrink-0 wide:w-10" />
          <span className="min-w-0">
            <span className="block text-[13px] leading-none font-bold tracking-[0.06em]">
              ROBOTICS CLUB
            </span>
            {/* Truncates rather than wrapping on the narrowest phones: a
                two-line masthead pushes the bar's height around, and the club's
                name is worth keeping over the last two words of it. */}
            <span className="text-primary mt-[3px] block truncate font-mono text-[9px] leading-none font-medium tracking-[0.22em]">
              OF CENTRAL FLORIDA
            </span>
          </span>
        </Link>

        <ul className="hidden items-center gap-7 wide:flex">
          {navLinks.map((link) => (
            <li key={link.href}>
              <NavAnchor
                link={link}
                className="text-dim text-[13px] font-medium transition-colors duration-200 hover:text-white"
              />
            </li>
          ))}
        </ul>

        {/* The whole reason the bar exists. It used to point at the FAQ, which
            is where becoming a member was explained while there was nowhere to
            actually do it. */}
        <Link
          to="/join"
          className="btn btn-primary btn-cta shrink-0 px-3.5 py-2.5 text-[11px] font-semibold wide:px-4.5 wide:text-xs"
        >
          <span className="wide:hidden">JOIN</span>
          <span className="hidden wide:inline">JOIN THE CLUB</span>
        </Link>

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

      {/* Under the bar rather than over the page: a full-screen overlay would
          need focus trapping and a scroll lock to be honest, and this menu is
          five links. `hidden` rather than unmounted so the open transition has
          a node to run on — see the styling notes in CLAUDE.md. */}
      <div
        id={menuId}
        className={`border-rule bg-base-100 overflow-hidden border-t transition-[opacity,transform] duration-200 transition-discrete wide:hidden ${
          open
            ? 'block translate-y-0 opacity-100 starting:-translate-y-2 starting:opacity-0'
            : 'hidden -translate-y-2 opacity-0'
        }`}
      >
        <ul className="px-page flex flex-col py-2">
          {navLinks.map((link) => (
            <li key={link.href} className="border-rule border-b last:border-b-0">
              <NavAnchor
                link={link}
                onNavigate={() => {
                  setOpen(false)
                }}
                /* Full-width and 48px tall: a nav link on a phone is a thumb
                   target, not a word. */
                className="hover:text-primary flex min-h-12 items-center text-sm font-medium transition-colors duration-200"
              />
            </li>
          ))}
        </ul>
      </div>
    </header>
  )
}

/**
 * One nav link, drawn as whichever kind of link it actually is.
 *
 * Anything carrying a hash stays a plain `<a>`. Those go to a section of the
 * front page, and the browser's own handling of them is the thing that works:
 * from the front page it is an in-page scroll, from anywhere else it is a load
 * that lands on the right section. React Router would take over the navigation
 * and then not scroll anywhere, because it has no reason to know the hash meant
 * something.
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
 * Two bars that become a cross. Drawn rather than imported: an icon package for
 * one glyph is a dependency for one glyph, and the animation between the two
 * states is the whole point of it being here.
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
