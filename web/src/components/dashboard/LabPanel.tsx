import { useState } from 'react'
import { ApiError, patchJson } from '../../lib/api/api'
import type { ApiLabStatus, ApiUser } from '../../lib/api/api'
import { duesLocked } from '../../lib/dues/dues'
import { ago } from '../../lib/format/formats'
import { CLOSES_AT, OPENS_AT } from '../../lib/lab/lab'
import { useLabStatus } from '../../lib/lab/useLabStatus'
import { FormPanel } from '../shared/formChrome'
import type { DashboardContext } from './DashboardLayout'
import { isOfficer } from '../../lib/auth/session'

/**
 * The lab, on the dashboard overview: what it's doing, and — for an officer — the switch.
 *
 * This is the one thing on the overview that branches on a role, and it's worth saying
 * why: every other panel there splits on data, and nothing asks who is looking. There's no
 * data shape that distinguishes an officer from anybody else. So the panel is split
 * instead — the state is for everybody, because "is the lab open" is the most useful thing
 * a member can read on a Thursday evening, and only the two buttons are gated.
 *
 * Which is cosmetics, like every other role check here. `PATCH /api/lab` goes through
 * `requireOfficer` and refuses anybody else whatever this renders.
 *
 * The press waits on Discord now, and it can come back refused. The sign in the club's
 * channel is the record, so the server renames that channel first and only writes the row
 * if that landed. Discord allows two renames per ten minutes, and the third comes back as
 * a 429 whose sentence says how long to wait — the server writes it and the failure line
 * prints it. What this file owes the officer is the busy state on the button.
 *
 * The same switch exists in Discord, as a button under the sign, and either moves the other.
 *
 * The state keeps asking, through `useLabStatus`, because the lab is now flipped from
 * Discord as often as from here. That hook is also why the fetch isn't `useApi` — pressing
 * the switch has to change what the panel says, and `useApi` has no refetch.
 */
export function LabPanel({
  user,
  membership,
}: {
  user: ApiUser
  membership: DashboardContext['membership']
}) {
  const { state, refresh, adopt } = useLabStatus()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  const officer = isOfficer(user.role)
  // An officer whose dues have lapsed reaches a 403 here exactly as on every management
  // page, so the switch comes off rather than sitting there waiting to refuse. The prompt
  // to pay is already directly above, which is why there's no note with it.
  const canFlip = officer && !duesLocked(membership, user.role)

  const flip = (open: boolean) => {
    setBusy(true)
    setFailed(null)

    patchJson<ApiLabStatus>('/lab', { open })
      .then((data) => {
        // Adopted rather than refetched. The server has just answered with the state it
        // wrote, and a second round trip would only be a flicker.
        adopt(data)
      })
      .catch((error: unknown) => {
        console.error(error)
        // The server's own sentence where there is one — a lapsed officer gets a paragraph
        // about dues, a throttled one gets the rename cooldown with the wait in it. The
        // cooldown is one this file couldn't write at all: the number comes from Discord.
        setFailed(
          (error instanceof ApiError ? error.detail : null) ??
            "That didn't go through. Try again in a moment.",
        )
        // Ask what the lab actually is. A refused flip leaves it exactly as it was, but a
        // cooldown means somebody else pressed something a moment ago, and what they did is
        // what this panel should now be showing.
        refresh()
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <FormPanel>
      <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]">
        THE LAB
      </p>

      {state.status === 'loading' && (
        <div aria-busy="true" className="space-y-2.5">
          <div className="bg-base-300 h-4 w-1/2 animate-pulse rounded-[2px]" />
          <div className="bg-base-300 h-3 w-1/3 animate-pulse rounded-[2px]" />
        </div>
      )}

      {state.status === 'error' && (
        <p className="text-dim text-sm leading-[1.7]">
          {/* Never guessed at. Printing CLOSED because the request failed is how somebody
              ends up trusting a sign the site never made. */}
          We couldn't tell whether the lab is open just now.
        </p>
      )}

      {state.status === 'ready' && (
        <>
          <p className="flex items-center gap-2.5 text-sm font-semibold">
            <span
              aria-hidden
              className={`size-2 shrink-0 ${
                state.data.open ? 'bg-success' : 'bg-error'
              }`}
            />
            <span className={state.data.open ? 'text-success' : 'text-error'}>
              {state.data.open ? 'Open' : 'Closed'}
            </span>
          </p>

          <p className="text-faint mt-1 text-[13px] leading-[1.6] text-pretty">
            {/* The curfew answers the question the state raises — CLOSED at 2am otherwise
                reads as somebody forgetting. It replaces the timestamp rather than joining
                it: at that hour why is the useful half, and when is not. */}
            {!state.data.buildingOpen
              ? `The building is shut between ${CLOSES_AT} and ${OPENS_AT}, so the lab can't be opened until then.`
              : state.data.changedAt
                ? `Last changed ${ago(state.data.changedAt)}.`
                : 'Nobody has set this yet, so the site is saying closed.'}
          </p>

          {canFlip && (
            <>
              <button
                type="button"
                /* Disabled overnight rather than hidden, which is the opposite of what
                   lapsed dues do a few lines up — and the difference is who is being
                   refused. Dues are personal, and a locked control on somebody's own
                   dashboard is a padlock they have to go and deal with. The curfew refuses
                   everybody, so the switch is still theirs and simply has nothing to act on
                   yet; greying it out says that, where taking it away would read as broken.
                   The server refuses either way, so this is the door being visibly shut. */
                disabled={busy || !state.data.buildingOpen}
                onClick={() => {
                  flip(!state.data.open)
                }}
                /* Gold to open and outlined to close, rather than one colour for both. The
                   gold is this site's "do the thing" and opening the lab is the thing; a
                   gold button that shuts it would invite the press that ends somebody's
                   build night. Sized for a panel — `formChrome`'s two are a page footer and
                   a hero-sized pair, and neither belongs inside a card. */
                className={
                  state.data.open
                    ? 'btn btn-outline mt-4 h-auto min-h-0 cursor-pointer border-base-content/28 px-6 py-2.5 text-[11px] font-semibold tracking-[0.04em] text-base-content transition-[border-color,background-color] duration-200 hover:border-base-content hover:bg-base-content/6 hover:text-base-content disabled:opacity-50'
                    : 'btn btn-primary btn-cta mt-4 cursor-pointer px-6 py-2.5 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-60'
                }
              >
                {state.data.open ? 'CLOSE THE LAB' : 'OPEN THE LAB'}
              </button>

              {/* Always rendered, so the live region exists before it has anything to
                  announce — one added at the moment it gains text is a region nothing was
                  watching. */}
              <p
                role="status"
                className="text-error mt-3 min-h-5 text-[13px] leading-[1.5] text-pretty"
              >
                {failed}
              </p>
            </>
          )}
        </>
      )}
    </FormPanel>
  )
}
