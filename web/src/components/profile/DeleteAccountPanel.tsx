import { useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { deleteJson } from '../../lib/api/api'
import { explainApiError } from '../../lib/api/apiErrors'
import { useSession } from '../../lib/auth/session'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { fieldClass, labelClass } from '../shared/formChrome'
import { PanelStatus, noteClass, type PanelMessage } from './profileChrome'

/**
 * Deleting the account, and the warning in front of it.
 *
 * **The warning lists what actually goes, because the cascades are not
 * obvious.** "Your account will be deleted" reads as a login being removed;
 * what really happens is that the club's record of every payment this person
 * made, every part it printed for them and every tool it lent them goes with
 * it. Somebody is entitled to that — it is their data — but they are not
 * entitled to be surprised by it.
 *
 * Two things the server refuses rather than cascading, and the panel shows its
 * sentence for both: equipment still out, and an open seat on the officer
 * board. Neither is a case where the right answer is "are you sure?".
 *
 * The password is asked for inside the dialog rather than in the panel, so the
 * one credential on this page that is worth typing carefully is typed at the
 * moment of the decision and not five minutes before it.
 */
export function DeleteAccountPanel({ fullName }: { fullName: string }) {
  const { refresh } = useSession()
  const navigate = useNavigate()
  const id = useId()

  const [asking, setAsking] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<PanelMessage>(null)

  const close = () => {
    setAsking(false)
    setPassword('')
  }

  const remove = () => {
    if (busy) return

    setBusy(true)
    setMessage(null)

    deleteJson<{ status: string }>('/account', { password })
      .then(async () => {
        // Off the dashboard *before* the session is re-read, exactly as signing
        // out does it: the layout sends anyone signed out to the login page,
        // and a sign-in form is a strange answer to having deleted an account.
        await navigate('/', { replace: true })
        await refresh()
      })
      .catch((error: unknown) => {
        console.error(error)
        // The server's own sentence, which is the point here: it names the
        // equipment still out, or says the board has to stand you down first.
        setMessage({ tone: 'error', text: explainApiError(error) })
        setBusy(false)
        close()
      })
  }

  return (
    <div className="border-error/40 bg-error/5 border p-5">
      <p className="text-error mb-3 font-mono text-[10px] font-medium tracking-[0.16em]">
        DELETE YOUR ACCOUNT
      </p>

      <p className="text-dim mb-3 text-[13px] leading-[1.7] text-pretty">
        This removes you from the club&rsquo;s site entirely, and cannot be
        undone.
      </p>

      <p className={`${noteClass} mb-2`}>What goes with it:</p>

      {/* Named one by one rather than summarised. Somebody is entitled to
          delete all of this; they are not entitled to be surprised by it. */}
      <ul className={`${noteClass} mb-3 list-disc space-y-1 pl-5`}>
        <li>your dues history, and the receipts for every payment</li>
        <li>every 3D print request you have made, and any file still with it</li>
        <li>every record of equipment you have borrowed</li>
        <li>your place on every project and team you are part of</li>
        <li>your photo, your bio, and your session on every device</li>
      </ul>

      <p className={`${noteClass} mb-4`}>
        Terms you served on the officer board stay in the club&rsquo;s archive.
        Rejoining later means signing up again from scratch.
      </p>

      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setAsking(true)
        }}
        className="btn btn-outline border-error/40 text-error hover:border-error hover:bg-error/10 hover:text-error h-auto min-h-0 cursor-pointer px-5 py-2.5 text-[11px] font-semibold tracking-[0.04em] disabled:opacity-50"
      >
        DELETE MY ACCOUNT
      </button>

      <PanelStatus message={message} />

      {asking && (
        <ConfirmDialog
          title="Delete this account for good?"
          confirmLabel={busy ? 'DELETING…' : 'DELETE IT'}
          dismissLabel="KEEP MY ACCOUNT"
          tone="danger"
          busy={busy || password === ''}
          onConfirm={remove}
          onDismiss={close}
        >
          <p>
            Everything listed on the page goes with{' '}
            <span className="text-base-content">{fullName}</span>. This cannot be
            undone.
          </p>

          <div className="pt-2">
            <label htmlFor={`${id}-password`} className={labelClass}>
              TYPE YOUR PASSWORD TO CONFIRM
            </label>
            <input
              id={`${id}-password`}
              type="password"
              maxLength={200}
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
              }}
              className={fieldClass}
            />
          </div>
        </ConfirmDialog>
      )}
    </div>
  )
}
