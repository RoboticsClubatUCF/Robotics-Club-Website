import { Outlet } from 'react-router'
import { SiteNav } from './SiteNav'
import { SiteFooter } from './SiteFooter'

/**
 * The chrome every page sits inside.
 *
 * This is where `SiteNav` and `SiteFooter` moved to when the router landed —
 * they used to be part of the landing page itself, back when the landing page
 * was the whole site. The `<main>` landmark lives here for the same reason:
 * every route wants exactly one, and a page that has to remember to draw its
 * own is a page that eventually doesn't.
 *
 * The column is what holds the footer down. Short pages — signup, the 404 —
 * used to end wherever their content did, leaving the footer stranded across
 * the middle of a tall monitor with black underneath it. `flex-1` on the main
 * element makes it absorb whatever is left over, so the footer sits on the
 * bottom of the viewport when the page is shorter than the screen and travels
 * down normally when it isn't.
 *
 * `min-h-dvh` rather than `min-h-screen`: on a phone `100vh` is the viewport
 * *without* the browser's chrome, so the last chunk of footer sits below the
 * fold until the address bar retracts.
 *
 * The nav stays sticky through this. Its containing block is now this column
 * rather than the body, and the column spans the whole document — and nothing
 * here sets `overflow`, which is the thing that would quietly break it.
 */
export function SiteLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteNav />
      <main className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  )
}
