import { ago } from '../../lib/format/formats'
import { useLabStatus } from '../../lib/lab/useLabStatus'

/**
 * Whether the lab is open, above the headline on the front page.
 *
 * The one thing on this site that is true for about six hours at a time, which
 * is what shapes every decision here. `GET /api/lab` is deliberately outside
 * the API's cached half — see `routes/public/lab.ts` — because a five-minute-old
 * answer to this question is the answer that sends somebody across campus for
 * nothing.
 *
 * **And it is the only thing here that keeps asking.** Every other panel on
 * this page is fetched on mount and still true ten minutes later; this one
 * flips when an officer presses something, and that press is now as likely to
 * be a button in Discord as the switch on the dashboard. `useLabStatus` polls
 * on the endpoint's own thirty seconds and stops while the tab is hidden — see
 * the note there, including why this is not a websocket.
 *
 * Between 10pm and 8am Orlando time the building is shut, so this reads closed
 * whatever an officer left the switch on — the server masks it.
 *
 * **It says one of two things and nothing else: open, or closed.** It used to
 * add OPENS 8AM overnight, and that is a promise the site is not in a position
 * to make — an officer might open at eight, or at noon, or not at all, and the
 * building being unlocked is not the lab being staffed. A closed sign that
 * quietly commits somebody to a time is worse than a closed sign.
 *
 * **The row is always drawn, at a fixed height, whatever the request is
 * doing.** It sits directly above the `<h1>`, so anything that appeared or
 * vanished after the page settled would shove the hero down or up. Loading is a
 * skeleton the size of the text it replaces; a failure is *empty*, which is the
 * one state worth being deliberate about — showing CLOSED because the API could
 * not be reached is inventing a fact, and the direction it invents in is the
 * one that costs somebody a walk to a locked door.
 *
 * The square rather than a dot: every other edge in this design is the theme's
 * 2px cut, and a round status light would be the one curved thing on the page.
 */
export function LabStatus() {
  const { state } = useLabStatus()

  return (
    <p className="mb-6 flex h-4 items-center gap-2.5 font-mono text-[10px] font-medium tracking-[0.16em]">
      {state.status === 'loading' && (
        <span aria-busy="true" className="bg-base-300 h-2.5 w-28 animate-pulse" />
      )}

      {state.status === 'ready' && (
        <>
          <span
            aria-hidden
            className={`size-2 shrink-0 ${
              state.data.open ? 'bg-success' : 'bg-error'
            }`}
          />
          <span className={state.data.open ? 'text-success' : 'text-error'}>
            {state.data.open ? 'LAB OPEN' : 'LAB CLOSED'}
          </span>
          {/* How stale the claim is, and only once somebody has actually
              flipped it — a club that has not started using the button has a
              `changedAt` of null, and "CLOSED · JUST NOW" would be a claim
              nobody made.

              Dropped overnight rather than replaced. At two in the morning "4
              HR AGO" is the answer to a question nobody asked, and the thing it
              used to be swapped for — OPENS 8AM — was the site promising an
              hour nobody had agreed to. So the sign simply says CLOSED, which
              is the part it knows. The dashboard's panel is where the
              building's hours are explained, to the officer who wants to know
              why the switch is greyed out. */}
          {state.data.buildingOpen && state.data.changedAt && (
            <span className="text-faint">
              {ago(state.data.changedAt).toUpperCase()}
            </span>
          )}
        </>
      )}
    </p>
  )
}
