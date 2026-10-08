import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import type { ApiDeskProfile, ApiSlicerDesk } from '../../lib/api/api'
import { STATUS_TONE, shortDate } from '../../lib/format/formats'
import { NOUN, profileFacts, profileState, unreachable } from '../../lib/slicer/profileDesk'
import { fieldClass, labelClass } from '../shared/formChrome'

const actionBase =
  'btn h-auto min-h-11 cursor-pointer px-3 py-1.5 text-[10.5px] font-semibold tracking-[0.06em] disabled:opacity-50 wide:min-h-0'
const quiet = `${actionBase} btn-outline border-base-content/28 text-base-content hover:border-base-content hover:bg-base-content/6 hover:text-base-content`
const danger = `${actionBase} btn-outline border-error/40 text-error hover:border-error hover:bg-error/10 hover:text-error`
const save = `${actionBase} btn-primary btn-cta`

export interface ProfileActions {
  busy: boolean
  onSave: (profile: ApiDeskProfile, change: { label?: string; description?: string | null; offered?: boolean }) => Promise<boolean>
  onReplace: (profile: ApiDeskProfile) => void
  onDelete: (profile: ApiDeskProfile) => void
  onMove: (profile: ApiDeskProfile, by: -1 | 1) => void
}

/**
 * One printer, process or filament on the profiles desk: what it is, whether members can pick it,
 * and what can be done to it. The label and description edit in place; the file is replaced
 * through the same dialog that adds one.
 */
export function ProfileRow({
  profile,
  desk,
  first,
  last,
  actions,
  children,
}: {
  profile: ApiDeskProfile
  desk: ApiSlicerDesk
  first: boolean
  last: boolean
  actions: ProfileActions
  /** A printer's processes, under it. */
  children?: ReactNode
}) {
  const id = useId()
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(profile.label)
  const [description, setDescription] = useState(profile.description ?? '')
  const state = profileState(profile)
  const facts = profileFacts(profile, desk)
  const blocked = unreachable(profile, desk)
  const noun = NOUN[profile.kind]
  const resolving = profile.state === 'QUEUED' || profile.state === 'RUNNING'

  const startEditing = () => {
    setLabel(profile.label)
    setDescription(profile.description ?? '')
    setEditing(true)
  }

  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-base-content text-[15px] font-semibold break-words">{profile.label}</span>
            <span className={`font-mono text-[10px] font-semibold tracking-[0.14em] ${STATUS_TONE[state.tone]}`}>
              {state.text}
            </span>
          </p>
          {profile.label !== profile.name && (
            <p className="text-faint text-[12px] break-words">{profile.name}</p>
          )}
          {facts && <p className="text-dim mt-0.5 text-[12.5px] leading-[1.5] break-words">{facts}</p>}
          {profile.description && !editing && (
            <p className="text-dim mt-1 text-[12.5px] leading-[1.5] break-words">{profile.description}</p>
          )}
          {resolving && (
            <p className="text-faint mt-1 text-[12px] leading-[1.5]">
              The slicer is reading it and slicing a test cube with it.
            </p>
          )}
          {profile.state === 'FAILED' && profile.failure && (
            <p className="text-error mt-1 text-[12.5px] leading-[1.5] break-words">{profile.failure}</p>
          )}
          {blocked && <p className="text-warning mt-1 text-[12.5px] leading-[1.5]">{blocked}</p>}
          {profile.state === 'READY' && profile.kind !== 'PRINTER' && (
            <p className="text-faint mt-1 text-[11.5px] leading-[1.5]">
              {profile.testedWith
                ? `Test-sliced on ${profile.testedWith}.`
                : `Not test-sliced yet: there's nothing to slice it with.`}
            </p>
          )}
          <p className="text-faint mt-1 text-[11.5px] leading-[1.5] break-words">
            {profile.sourceFile}
            {profile.uploadedBy ? ` · ${profile.uploadedBy}` : ''} · {shortDate(profile.updatedAt)}
          </p>
        </div>

        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            className={quiet}
            disabled={actions.busy || first}
            aria-label={`Move ${profile.label} up`}
            onClick={() => {
              actions.onMove(profile, -1)
            }}
          >
            <span aria-hidden="true">↑</span>
          </button>
          <button
            type="button"
            className={quiet}
            disabled={actions.busy || last}
            aria-label={`Move ${profile.label} down`}
            onClick={() => {
              actions.onMove(profile, 1)
            }}
          >
            <span aria-hidden="true">↓</span>
          </button>
        </div>
      </div>

      {editing ? (
        <form
          className="mt-3 grid max-w-[32rem] grid-cols-1 gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void actions
              .onSave(profile, { label: label.trim(), description: description.trim() || null })
              .then((saved) => {
                if (saved) setEditing(false)
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
            <button type="submit" className={save} disabled={actions.busy || label.trim() === ''}>
              SAVE
            </button>
            <button
              type="button"
              className={quiet}
              onClick={() => {
                setEditing(false)
              }}
            >
              CANCEL
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={quiet} disabled={actions.busy} onClick={startEditing}>
            EDIT
          </button>
          <button
            type="button"
            className={quiet}
            disabled={actions.busy}
            onClick={() => {
              actions.onReplace(profile)
            }}
          >
            REPLACE FILE
          </button>
          <button
            type="button"
            className={quiet}
            disabled={actions.busy}
            aria-label={`${profile.offered ? 'Hide' : 'Offer'} the ${profile.label} ${noun}`}
            onClick={() => {
              void actions.onSave(profile, { offered: !profile.offered })
            }}
          >
            {profile.offered ? 'HIDE' : 'OFFER'}
          </button>
          <button
            type="button"
            className={danger}
            disabled={actions.busy}
            aria-label={`Delete the ${profile.label} ${noun}`}
            onClick={() => {
              actions.onDelete(profile)
            }}
          >
            DELETE
          </button>
        </div>
      )}

      {children}
    </div>
  )
}
