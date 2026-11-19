import { useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { FormPanel } from '../shared/formChrome'
import { InfoTip } from '../shared/InfoTip'
import { MemberSearch } from '../shared/MemberSearch'
import { Status } from '../shared/Status'
import { ApiError, postJson } from '../../lib/api/api'
import type {
  ApiBoardPerson,
  ApiHandover,
  ApiOfficerDesk,
  OfficerPosition,
  UserRole,
} from '../../lib/api/api'
import { explainApiError } from '../../lib/api/apiErrors'
import {
  type Holder,
  type Plan,
  type PlanChanges,
  changesOf,
  dropSeatless,
  emptySeat,
  grantsDesks,
  hasChanges,
  holderOfMember,
  holderOfSeat,
  place,
  placesNext,
  placesNow,
  planFrom,
  problemOf,
  rebase,
  requestOf,
} from '../../lib/board/handover'
import { seatLabel } from '../../lib/officerTerms'
import { panelLabel, primaryButton, secondaryButton, textButton } from './boardChrome'

const placeName = (seat: OfficerPosition | null) =>
  seat === null ? 'no seat' : seatLabel(seat)

/** Which control takes focus after an edit, so a keyboard user isn't dropped on `<body>`
    when the row they pressed in is redrawn. `n` makes a repeat of the same target count. */
type Focus = { target: OfficerPosition | 'seatless' | 'add' | 'panel' | 'send'; n: number }

/**
 * Rotation day: the board as it should be, seat by seat, sent in one press.
 *
 * It opens on today's board, so only what changes needs touching. Picking somebody who sits
 * elsewhere moves them; CHANGE and leaving the box empty vacates a seat. The server swaps the
 * whole board and the officer desks in one transaction.
 *
 * The plan remembers the board it was made from. If the desk reloads underneath it (a seat set
 * on OFFICER BOARD, or a 409 from somebody else's change), HAND OVER waits until the plan is
 * carried over onto today's board or started again.
 */
export function BoardHandover({
  desk,
  failed,
  reload,
  setDesk,
  me,
  onLostDesks,
}: {
  desk: ApiOfficerDesk | null
  failed: boolean
  reload: () => void
  setDesk: (desk: ApiOfficerDesk) => void
  me: { id: string; role: UserRole }
  /** Called when this handover took the officer desks from whoever is signed in. */
  onLostDesks: () => void
}) {
  const [draft, setDraft] = useState<{ base: ApiOfficerDesk; plan: Plan } | null>(null)
  const [focus, setFocus] = useState<Focus | null>(null)
  const [adding, setAdding] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<ApiHandover['change'] | null>(null)

  const doneBox = useRef<HTMLDivElement>(null)
  const seatlessHeading = useRef<HTMLParagraphElement>(null)
  const panelHeading = useRef<HTMLParagraphElement>(null)
  const sendButton = useRef<HTMLButtonElement>(null)

  // The result lands where the button was, and the reader is taken to it.
  useEffect(() => {
    if (!done) return
    doneBox.current?.focus()
    doneBox.current?.scrollIntoView?.({ block: 'nearest' })
  }, [done])

  useEffect(() => {
    if (focus?.target === 'seatless') seatlessHeading.current?.focus()
    if (focus?.target === 'panel') panelHeading.current?.focus()
    if (focus?.target === 'send') sendButton.current?.focus()
  }, [focus])

  if (failed && !desk) {
    return (
      <FormPanel>
        <p className={`${panelLabel} mb-4`}>HAND OVER THE BOARD</p>
        <p className="mb-4 text-[13px] text-dim">We couldn&rsquo;t load the board just now.</p>
        <button type="button" className={secondaryButton} onClick={reload}>
          TRY AGAIN
        </button>
      </FormPanel>
    )
  }

  if (!desk) return <HandoverSkeleton />

  const base = draft?.base ?? desk
  const plan = draft?.plan ?? planFrom(desk)
  const stale = draft !== null && draft.base !== desk

  const focusOn = (target: Focus['target']) => {
    setFocus((last) => ({ target, n: (last?.n ?? 0) + 1 }))
  }

  const edit = (next: Plan, target: Focus['target']) => {
    setDraft({ base, plan: next })
    setError('')
    setDone(null)
    focusOn(target)
  }

  const startAgain = () => {
    setDraft(null)
    setError('')
    reload()
    focusOn('panel')
  }

  const carryOver = () => {
    if (!draft) return
    setDraft({ base: desk, plan: rebase(draft.base, draft.plan, desk) })
    setError('')
    // The plan was already reviewed; the next step is sending it.
    focusOn('send')
  }

  const now = placesNow(base)
  const next = placesNext(plan)
  const changes = changesOf(base, plan)
  const changed = hasChanges(changes)
  const problem = changed ? problemOf(plan) : null

  const mine = next.get(`u:${me.id}`)
  const iLoseDesks =
    me.role === 'OFFICER' &&
    now.has(`u:${me.id}`) &&
    (mine === undefined || !grantsDesks(mine))

  const seatlessLeaving = changes.leaving.filter((holder) => now.get(holder.key) === null)

  // Officers by role with no place on the board. The handover leaves them alone unless the
  // plan places them, so they're listed where they can be added.
  const offBoard = desk.offBoard.filter((person) => !next.has(`u:${person.id}`))

  const send = async () => {
    setBusy(true)
    setError('')

    try {
      const { change, ...answer } = await postJson<ApiHandover>(
        '/officer/terms/handover',
        requestOf(base, plan),
      )
      setDesk(answer)
      setDraft(null)
      setFocus(null)
      setDone(change)

      if (change.revoked.includes(me.id)) onLostDesks()
    } catch (caught: unknown) {
      // The board moved under the plan. Reading it again marks the plan stale, which is
      // where carrying it over is offered.
      if (caught instanceof ApiError && caught.status === 409) reload()
      else {
        setError(
          explainApiError(caught, {
            forbidden: 'The server does not agree you are an officer.',
          }),
        )
      }
    } finally {
      setConfirming(false)
      setBusy(false)
    }
  }

  return (
    <FormPanel>
      <div className="mb-4 flex items-center gap-1">
        <p ref={panelHeading} tabIndex={-1} className={`${panelLabel} outline-none`}>
          HAND OVER THE BOARD
        </p>
        <InfoTip label="Hand over the board">
          Everyone keeps their seat unless you change it. One press swaps the whole board: new
          officers get the officer desks, leaving ones lose them and move to the officers page.
          The faculty advisor seat comes without desks.
        </InfoTip>
      </div>

      <ol className="divide-y divide-[var(--color-rule)] border-y border-rule">
        {base.seats.map((seat) => {
          const held = base.board.find((term) => term.position === seat)
          const current = held ? holderOfSeat(held) : null
          const holder = plan.seats[seat] ?? null
          const same = (current?.key ?? null) === (holder?.key ?? null)

          return (
            <li key={seat} className="py-3.5">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <p className="text-[13px] font-semibold">{seatLabel(seat)}</p>
                {!same && (
                  <span className="font-mono text-[10px] font-medium tracking-[0.14em] text-primary">
                    {holder ? 'CHANGING' : 'LEFT EMPTY'}
                  </span>
                )}
              </div>

              {holder?.termId ? (
                <AccountlessHolder
                  key={holder.key}
                  name={holder.fullName}
                  label={`Change ${seatLabel(seat)}`}
                  disabled={busy}
                  autoFocus={focus?.target === seat}
                  onChange={() => {
                    edit(emptySeat(plan, seat), seat)
                  }}
                />
              ) : (
                <MemberSearch
                  // A new key when the holder changes, so a cleared seat opens on an empty
                  // box rather than the last search.
                  key={holder?.key ?? 'empty'}
                  picked={holder}
                  onPick={(member) => {
                    edit(
                      member
                        ? place(plan, holderOfMember(member), seat)
                        : emptySeat(plan, seat),
                      seat,
                    )
                  }}
                  disabled={busy}
                  label={`Who holds ${seatLabel(seat)} next`}
                  hideLabel
                  changeLabel={`Change ${seatLabel(seat)}`}
                  autoFocus={focus?.target === seat}
                />
              )}

              {!same && current && (
                <p className="mt-1.5 flex flex-wrap items-center gap-x-3 text-[12px] text-faint">
                  <span>Now {current.fullName}.</span>
                  <button
                    type="button"
                    className={textButton}
                    disabled={busy}
                    aria-label={`Keep ${current.fullName} as ${seatLabel(seat)}`}
                    onClick={() => {
                      edit(place(plan, current, seat), seat)
                    }}
                  >
                    KEEP
                  </button>
                </p>
              )}
            </li>
          )
        })}
      </ol>

      <div className="mt-6">
        <p
          ref={seatlessHeading}
          tabIndex={-1}
          className={`${panelLabel} mb-2 outline-none`}
        >
          WITHOUT A SEAT
        </p>

        {(plan.seatless.length > 0 || seatlessLeaving.length > 0 || offBoard.length > 0) && (
          <ul className="mb-4 divide-y divide-[var(--color-rule)] border-y border-rule">
            {plan.seatless.map((holder) => (
              <SeatlessRow
                key={holder.key}
                name={holder.fullName}
                note={
                  now.get(holder.key) === null
                    ? null
                    : now.has(holder.key)
                      ? `WAS ${placeName(now.get(holder.key) ?? null).toUpperCase()}`
                      : 'JOINING'
                }
                action="REMOVE"
                actionLabel={`Take ${holder.fullName} off the board`}
                disabled={busy}
                onAction={() => {
                  edit(dropSeatless(plan, holder.key), 'seatless')
                }}
              />
            ))}
            {seatlessLeaving.map((holder) => (
              <SeatlessRow
                key={holder.key}
                name={holder.fullName}
                note="LEAVING"
                action="KEEP"
                actionLabel={`Keep ${holder.fullName} on the board`}
                disabled={busy}
                onAction={() => {
                  edit(place(plan, holder, null), 'seatless')
                }}
              />
            ))}
            {offBoard.map((person) => (
              <SeatlessRow
                key={person.id}
                name={person.fullName}
                note="HAS THE DESKS, NOT ON THE BOARD"
                action="ADD"
                actionLabel={`Add ${person.fullName} to the board`}
                disabled={busy}
                onAction={() => {
                  edit(place(plan, holderOfMember(person), null), 'seatless')
                }}
              />
            ))}
          </ul>
        )}

        <MemberSearch
          key={adding}
          picked={null}
          onPick={(member) => {
            if (!member) return
            edit(place(plan, holderOfMember(member), null), 'add')
            setAdding((count) => count + 1)
          }}
          disabled={busy}
          label="Add somebody without a seat"
          hideLabel
          autoFocus={focus?.target === 'add'}
        />
      </div>

      {changed && (
        <div className="mt-6 border border-rule bg-base-100 p-4">
          <ChangeList changes={changes} />
        </div>
      )}

      {done && (
        <div
          ref={doneBox}
          tabIndex={-1}
          role="status"
          className="mt-6 outline-none"
        >
          <HandoverDone change={done} me={me} />
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          ref={sendButton}
          type="button"
          className={primaryButton}
          disabled={busy || stale || !changed || problem !== null}
          onClick={() => {
            setConfirming(true)
          }}
        >
          {busy ? 'HANDING OVER…' : 'HAND OVER'}
        </button>
        {stale && (
          <button type="button" className={secondaryButton} disabled={busy} onClick={carryOver}>
            UPDATE THE PLAN
          </button>
        )}
        {(changed || error || stale) && (
          <button type="button" className={secondaryButton} disabled={busy} onClick={startAgain}>
            START AGAIN
          </button>
        )}
      </div>

      {stale && (
        <p className="mt-3 text-[13px] leading-[1.6] text-dim">
          The board changed since you made this plan. UPDATE THE PLAN keeps your changes on
          today&rsquo;s board.
        </p>
      )}
      {problem && <Status message={problem} />}
      {error && <Status message={error} />}

      {confirming && (
        <ConfirmDialog
          title="Hand over the board?"
          confirmLabel="HAND OVER"
          tone="primary"
          busy={busy}
          onConfirm={() => {
            void send()
          }}
          onDismiss={() => {
            setConfirming(false)
          }}
        >
          <ChangeList changes={changes} />
          {(changes.joining.length > 0 || changes.leaving.length > 0) && (
            <p className="mt-3">
              Leaving officers lose the officer desks and move to the officers page. New ones
              get the desks.
            </p>
          )}
          {offBoard.length > 0 && (
            <p className="mt-3">
              {names(offBoard)} {offBoard.length === 1 ? 'keeps' : 'keep'} the officer desks
              with no place on the board.
            </p>
          )}
          {iLoseDesks && (
            <p className="mt-3">
              That includes you. Your desks close when you leave the roles desk.
            </p>
          )}
        </ConfirmDialog>
      )}
    </FormPanel>
  )
}

const names = (people: ApiBoardPerson[]) => people.map((person) => person.fullName).join(', ')

/** A seat held on a term with no account behind it: it can be kept or vacated, not moved. */
function AccountlessHolder({
  name,
  label,
  disabled,
  autoFocus,
  onChange,
}: {
  name: string
  label: string
  disabled: boolean
  autoFocus: boolean
  onChange: () => void
}) {
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (autoFocus) button.current?.focus()
  }, [autoFocus])

  return (
    <div className="flex items-center justify-between gap-4 border border-rule bg-base-100 px-3 py-2.5">
      <span className="text-sm font-medium">
        {name}
        <span className="ml-2 text-[12px] font-normal text-faint">no account</span>
      </span>
      <button
        ref={button}
        type="button"
        className={textButton}
        disabled={disabled}
        aria-label={label}
        onClick={onChange}
      >
        CHANGE
      </button>
    </div>
  )
}

function SeatlessRow({
  name,
  note,
  action,
  actionLabel,
  disabled,
  onAction,
}: {
  name: string
  note: string | null
  action: string
  actionLabel: string
  disabled: boolean
  onAction: () => void
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold">{name}</p>
        {note && <p className="font-mono text-[10px] tracking-[0.14em] text-faint">{note}</p>}
      </div>
      <button
        type="button"
        className={textButton}
        disabled={disabled}
        aria-label={actionLabel}
        onClick={onAction}
      >
        {action}
      </button>
    </li>
  )
}

/** Who joins, moves and leaves, and which seats empty. Under the form and in the confirmation. */
function ChangeList({ changes }: { changes: PlanChanges }) {
  return (
    <dl className="space-y-2 text-[13px] leading-[1.6] text-pretty">
      {changes.joining.length > 0 && (
        <div>
          <dt className={panelLabel}>JOINING</dt>
          <dd>
            {changes.joining
              .map(({ holder, to }) => `${holder.fullName} (${placeName(to)})`)
              .join(', ')}
          </dd>
        </div>
      )}
      {changes.moving.length > 0 && (
        <div>
          <dt className={panelLabel}>MOVING</dt>
          <dd>
            {changes.moving
              .map(
                ({ holder, from, to }) =>
                  `${holder.fullName} (${placeName(from)} → ${placeName(to)})`,
              )
              .join(', ')}
          </dd>
        </div>
      )}
      {changes.leaving.length > 0 && (
        <div>
          <dt className={panelLabel}>LEAVING</dt>
          <dd>{changes.leaving.map((holder: Holder) => holder.fullName).join(', ')}</dd>
        </div>
      )}
      {changes.emptied.length > 0 && (
        <div>
          <dt className={panelLabel}>LEFT EMPTY</dt>
          <dd>{changes.emptied.map((seat) => seatLabel(seat)).join(', ')}</dd>
        </div>
      )}
    </dl>
  )
}

function HandoverDone({
  change,
  me,
}: {
  change: ApiHandover['change']
  me: { id: string }
}) {
  return (
    <p className="text-[13px] leading-[1.6] text-success">
      The board has been handed over.
      {change.revoked.includes(me.id) &&
        ' Your officer desks close when you leave the roles desk.'}
    </p>
  )
}

/** Sized to the seat list, so the panel doesn't jump when the board arrives. */
function HandoverSkeleton() {
  return (
    <FormPanel>
      <p className={`${panelLabel} mb-4`}>HAND OVER THE BOARD</p>
      <div aria-hidden="true" className="space-y-5">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="space-y-2">
            <div className="skeleton h-3.5 w-28" />
            <div className="skeleton h-11 w-full" />
          </div>
        ))}
      </div>
      <span className="sr-only" role="status">
        Loading the board
      </span>
    </FormPanel>
  )
}
