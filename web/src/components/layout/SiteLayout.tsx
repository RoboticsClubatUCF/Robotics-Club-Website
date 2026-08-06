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
 */
export function SiteLayout() {
  return (
    <>
      <SiteNav />
      <main>
        <Outlet />
      </main>
      <SiteFooter />
    </>
  )
}
