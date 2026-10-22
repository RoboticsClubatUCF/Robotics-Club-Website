import { useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ApiDeskProfile, ApiSlicerDesk } from '../../lib/api/api'
import { STATUS_TONE, shortDate } from '../../lib/format/formats'
import { NOUN, profileFacts, profileState, unreachable, usesLine } from '../../lib/slicer/profileDesk'
import { fieldClass, labelClass } from '../shared/formChrome'
import { smallDangerButton, smallLoudButton, smallQuietButton } from './slicerChrome'

export interface ProfileActions {
  busy: boolean
  onSave: (profile: ApiDeskProfile, change: { label?: string; description?: string | null }) => Promise<boolean>
  onToggle: (profile: ApiDeskProfile) => void
  onReplace: (profile: ApiDeskProfile) => void
  onDelete: (profile: ApiDeskProfile) => void
  onMove: (profile: ApiDeskProfile, by: -1 | 1) => Promise<boolean>
}

/**
 * One printer, process or filament on the profiles desk: what it is, whether members can pick it,
 * what uses it, and what can be done to it. The label and description edit in place; the file is
 * replaced through the same dialog that adds one.
 *
 * Buttons say `aria-disabled` rather than `disabled` while a write is out: a disabled button
 * drops keyboard focus to the page, and an officer pressing ↓ twice would lose their place.
 */
export function ProfileRow({
  profile,
  desk,
  first,
  last,
  actions,
  printer,
  children,
}: {
  profile: ApiDeskProfile
  desk: ApiSlicerDesk
  first: boolean
  last: boolean
  actions: ProfileActions
  /** The label of the printer a process or filament is on. */
  printer?: string
  /** A printer's processes and filaments, under it. */
  children?: ReactNode
}) {
  const id = useId()
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(profile.label)
  const [description, setDescription] = useState(profile.description ?? '')
  const editButton = useRef<HTMLButtonElement>(null)
  const up = useRef<HTMLButtonElement>(null)
  const down = useRef<HTMLButtonElement>(null)
  const state = profileState(profile)
  const facts = profileFacts(profile)
  const blocked = unreachable(profile, desk)
  const used = usesLine(profile.uses)
  const noun = NOUN[profile.kind]
  // Two printers can each have a PLA, so a process's or filament's controls say whose it is.
  const on = printer ? ` on ${printer}` : ''
  const named = `the ${profile.label} ${noun}${on}`
  const Title = profile.kind === 'PRINTER' ? 'h3' : 'span'
  const resolving = profile.state === 'QUEUED' || profile.state === 'RUNNING'
  const busy = actions.busy

  const startEditing = () => {
    setLabel(profile.label)
    setDescription(profile.description ?? '')
    setEditing(true)
    requestAnimationFrame(() => document.getElementById(`${id}-label`)?.focus())
  }

  const stopEditing = () => {
    setEditing(false)
    requestAnimationFrame(() => editButton.current?.focus())
  }

  const move = (by: -1 | 1) => {
    if (busy) return
    void actions.onMove(profile, by).then(() => {
      // The row has moved; keep focus on its arrow, or the other one once it reaches an end.
      requestAnimationFrame(() => {
        const pressed = by === -1 ? up.current : down.current
        const other = by === -1 ? down.current : up.current
        ;(pressed?.disabled ? other : pressed)?.focus()
      })
    })
  }

  const unless = (run: () => void) => () => {
    if (!busy) run()
  }

  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            {/* A printer heads its panel, so heading navigation can jump between printers. */}
            <Title className="text-base-content min-w-0 text-[15px] font-semibold [overflow-wrap:anywhere]">
              {profile.label}
            </Title>
            <span
              aria-live="polite"
              className={`font-mono text-[10px] font-semibold tracking-[0.14em] ${STATUS_TONE[state.tone]}`}
            >
              {state.text}
            </span>
          </div>
          {profile.label !== profile.name && (
            <p className="text-faint text-[12px] [overflow-wrap:anywhere]">{profile.name}</p>
          )}
          {facts && <p className="text-dim mt-0.5 text-[12.5px] leading-[1.5] [overflow-wrap:anywhere]">{facts}</p>}
          {profile.description && !editing && (
            <p className="text-dim mt-1 text-[12.5px] leading-[1.5] [overflow-wrap:anywhere]">{profile.description}</p>
          )}
          {resolving && (
            <p className="text-faint mt-1 text-[12px] leading-[1.5]">
              The slicer is reading it and slicing a test cube with it.
              {profile.offered ? ' Members can pick it once that works.' : ''}
            </p>
          )}
          {profile.state === 'FAILED' && profile.failure && (
            <p className="text-error mt-1 text-[12.5px] leading-[1.5] [overflow-wrap:anywhere]">{profile.failure}</p>
          )}
          {blocked && <p className="text-warning mt-1 text-[12.5px] leading-[1.5]">{blocked}</p>}
          {used && (
            <p className="text-dim mt-1 text-[12px] leading-[1.5]">
              Used by {used}.
            </p>
          )}
          {profile.state === 'READY' && profile.kind !== 'PRINTER' && (
            <p className="text-faint mt-1 text-[11.5px] leading-[1.5]">
              {profile.testedWith
                ? `Test-sliced on ${profile.testedWith}.`
                : `Not test-sliced yet: there's nothing to slice it with.`}
            </p>
          )}
          <p className="text-faint mt-1 text-[11.5px] leading-[1.5] [overflow-wrap:anywhere]">
            {profile.sourceFile}
            {profile.uploadedBy ? ` · ${profile.uploadedBy}` : ''} · {shortDate(profile.updatedAt)}
          </p>
        </div>

        <div className="flex shrink-0 gap-1.5">
          <button
            ref={up}
            type="button"
            className={smallQuietButton}
            disabled={first}
            aria-disabled={busy}
            aria-label={`Move ${profile.label}${on} up`}
            onClick={() => {
              move(-1)
            }}
          >
            <span aria-hidden="true">↑</span>
          </button>
          <button
            ref={down}
            type="button"
            className={smallQuietButton}
            disabled={last}
            aria-disabled={busy}
            aria-label={`Move ${profile.label}${on} down`}
            onClick={() => {
              move(1)
            }}
          >
            <span aria-hidden="true">↓</span>
          </button>
        </div>
      </div>

      {editing ? (
        <form
          className="mt-3 grid max-w-[32rem] grid-cols-1 gap-3"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              stopEditing()
            }
          }}
          onSubmit={(event) => {
            event.preventDefault()
            if (busy || label.trim() === '') return
            void actions
              .onSave(profile, { label: label.trim(), description: description.trim() || null })
              .then((saved) => {
                if (saved) stopEditing()
              })
          }}
        >
          <div>
            <label htmlFor={`${id}-label`} className={labelClass}>
              NAME MEMBERS SEE
            </label>
            <input
              id={`${id}-label`}
              required
              maxLength={60}
              value={label}
              onChange={(event) => {
                setLabel(event.target.value)
              }}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor={`${id}-description`} className={labelClass}>
              LINE UNDER IT
            </label>
            <input
              id={`${id}-description`}
              maxLength={200}
              value={description}
              placeholder={profile.kind === 'PROCESS' ? 'Blank describes it from its walls and infill' : undefined}
              onChange={(event) => {
                setDescription(event.target.value)
              }}
              className={fieldClass}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={smallLoudButton} aria-disabled={busy || label.trim() === ''}>
              SAVE
            </button>
            <button type="button" className={smallQuietButton} onClick={stopEditing}>
              CANCEL
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            ref={editButton}
            type="button"
            className={smallQuietButton}
            aria-disabled={busy}
            aria-label={`Edit ${named}`}
            onClick={unless(startEditing)}
          >
            EDIT
          </button>
          <button
            type="button"
            className={smallQuietButton}
            aria-disabled={busy}
            aria-label={`Replace the file of ${named}`}
            onClick={unless(() => {
              actions.onReplace(profile)
            })}
          >
            REPLACE FILE
          </button>
          {/* Only once it works: hiding or offering a profile members can't use yet means nothing. */}
          {profile.state === 'READY' && (
            <button
              type="button"
              className={smallQuietButton}
              aria-disabled={busy}
              aria-label={`${profile.offered ? 'Hide' : 'Offer'} ${named}`}
              onClick={unless(() => {
                actions.onToggle(profile)
              })}
            >
              {profile.offered ? 'HIDE' : 'OFFER'}
            </button>
          )}
          <button
            type="button"
            className={smallDangerButton}
            aria-disabled={busy}
            aria-label={`Delete ${named}`}
            onClick={unless(() => {
              actions.onDelete(profile)
            })}
          >
            DELETE
          </button>
        </div>
      )}

      {children}
    </div>
  )
}
