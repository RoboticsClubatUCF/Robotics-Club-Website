import { useId, useState, type FormEvent } from 'react'
import { postJson } from '../../lib/api/api'
import { explainApiError } from '../../lib/api/apiErrors'
import { fieldClass, labelClass } from '../shared/formChrome'
import {
  PanelStatus,
  ProfilePanel,
  noteClass,
  panelSaveClass,
  type PanelMessage,
} from './profileChrome'

/** Mirrors the server's rule, which is length and nothing else. Composition
    rules push people toward `Password1!` and are no longer advised by anyone
    who has measured them. */
const MIN_LENGTH = 10

/**
 * Setting a new password while signed in.
 *
 * Three fields rather than two. The confirmation is not ceremony: this form has no way to tell
 * somebody they mistyped, and the cost of a typo is being locked out of an account whose reset link
 * goes to an address they may be changing on the same page.
 */
export function ProfilePasswordPanel() {
  const id = useId()

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<PanelMessage>(null)

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return

    if (next !== again) {
      // Checked here because the server cannot: it is sent one password, and
      // "these two do not match" is a fact only this form has.
      setMessage({ tone: 'error', text: 'Those two do not match.' })
      return
    }

    setSaving(true)
    setMessage(null)

    postJson<{ status: string; otherSessionsEnded: number }>(
      '/account/password',
      { currentPassword: current, newPassword: next },
    )
      .then((answer) => {
        setCurrent('')
        setNext('')
        setAgain('')
        setMessage({
          tone: 'ok',
          text:
            answer.otherSessionsEnded > 0
              ? `Saved. You have been signed out everywhere else — ${answer.otherSessionsEnded} other ${answer.otherSessionsEnded === 1 ? 'session' : 'sessions'} ended.`
              : 'Saved. This is the only device you were signed in on.',
        })
      })
      .catch((error: unknown) => {
        console.error(error)
        setMessage({
          tone: 'error',
          text: explainApiError(error),
        })
      })
      .finally(() => {
        setSaving(false)
      })
  }

  return (
    <ProfilePanel label="PASSWORD">
      <form onSubmit={save} className="flex flex-col gap-4">
        <div>
          <label htmlFor={`${id}-current`} className={labelClass}>
            CURRENT PASSWORD
          </label>
          <input
            id={`${id}-current`}
            name="currentPassword"
            type="password"
            required
            maxLength={200}
            autoComplete="current-password"
            value={current}
            onChange={(event) => {
              setCurrent(event.target.value)
            }}
            className={fieldClass}
          />
        </div>

        <div>
          <label htmlFor={`${id}-next`} className={labelClass}>
            NEW PASSWORD
          </label>
          <input
            id={`${id}-next`}
            name="newPassword"
            type="password"
            required
            minLength={MIN_LENGTH}
            maxLength={200}
            /* `new-password` is what tells a password manager to offer to
               generate one rather than filling in what it already has. */
            autoComplete="new-password"
            value={next}
            onChange={(event) => {
              setNext(event.target.value)
            }}
            className={fieldClass}
          />
          <p className={`${noteClass} mt-1.5`}>
            At least {MIN_LENGTH} characters. Length is the part that helps —
            there are no rules about symbols.
          </p>
        </div>

        <div>
          <label htmlFor={`${id}-again`} className={labelClass}>
            NEW PASSWORD AGAIN
          </label>
          <input
            id={`${id}-again`}
            name="newPasswordAgain"
            type="password"
            required
            maxLength={200}
            autoComplete="new-password"
            value={again}
            onChange={(event) => {
              setAgain(event.target.value)
            }}
            className={fieldClass}
          />
        </div>

        <div>
          <button type="submit" disabled={saving} className={panelSaveClass}>
            {saving ? 'SAVING…' : 'CHANGE MY PASSWORD'}
          </button>
        </div>

        <p className={noteClass}>
          Changing it signs you out on every other device, and leaves you signed
          in here.
        </p>
      </form>

      <PanelStatus message={message} />
    </ProfilePanel>
  )
}
