import { useRef } from 'react'
import { Outlet } from 'react-router'
import { SiteNav } from './SiteNav'
import { SiteFooter } from './SiteFooter'

/**
 * The chrome every page sits inside.
 *
 * This is where `SiteNav` and `SiteFooter` moved to when the router landed — they used to be part
 * of the landing page itself, back when the landing page was the whole site. The `<main>` landmark
 * lives here for the same reason: every route wants exactly one, and a page that has to remember to
 * draw its own is a page that eventually does not.
 *
 * The column is what holds the footer down. Short pages — signup, the 404 — used to end wherever
 * their content did, leaving the footer stranded across the middle of a tall monitor with black
 * underneath it. `flex-1` on the main element makes it absorb whatever is left over.
 *
 * `min-h-dvh` rather than `min-h-screen`: on a phone `100vh` is the viewport without the browser's
 * chrome, so the last chunk of footer sits below the fold until the address bar retracts.
 *
 * The nav stays sticky through this. Its containing block is now this column rather than the body,
 * and the column spans the whole document — and nothing here sets `overflow`, which is the thing
 * that would quietly break it.
 */
export function SiteLayout() {
  const mainRef = useRef<HTMLElement>(null)

  return (
    <div className="flex min-h-dvh flex-col">
      {/* The first Tab stop on every page, so a keyboard doesn't walk the whole bar to reach the
          content. Focus is moved by hand rather than by following `#main`, which would add a
          history entry and leave `#main` on any link copied from the address bar. A section
          with its own navigation inside `<main>` marks where its content starts with
          `data-skip-target`, as the dashboard does past its rail. */}
      <a
        href="#main"
        onClick={(event) => {
          event.preventDefault()
          const main = mainRef.current
          const target = main?.querySelector<HTMLElement>('[data-skip-target]') ?? main
          target?.focus()
        }}
        className="bg-primary text-primary-content sr-only z-50 font-mono text-[11px] font-semibold tracking-[0.1em] focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:px-4 focus:py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
      >
        SKIP TO CONTENT
      </a>
      <SiteNav />
      <main id="main" ref={mainRef} tabIndex={-1} className="flex-1 outline-none">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  )
}
