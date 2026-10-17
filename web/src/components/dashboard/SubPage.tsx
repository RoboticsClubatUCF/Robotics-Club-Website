import type { ReactNode } from 'react'

/**
 * One sub-page of a section, kept mounted while a sibling is on screen.
 *
 * The router can't stop a navigation (a `BrowserRouter` has no blocker), so unmounting would
 * drop whatever was half-typed the moment somebody pressed the sibling beside it. Hidden keeps
 * it, as the section's single page always did, and the section's reads happen once rather
 * than on every switch. Leaving the section still drops it, as it always has.
 */
export function SubPage({
  shown,
  children,
}: {
  shown: boolean
  children: ReactNode
}) {
  return <div hidden={!shown}>{children}</div>
}
