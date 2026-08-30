import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import {
  postJson,
  type ApiAccount,
  type ApiAccountUser,
  type ApiEmailChangeStarted,
} from '../../lib/api/api'
import { explainApiError } from '../../lib/api/apiErrors'
import { useSession } from '../../lib/auth/session'
import { fieldClass, labelClass } from '../shared/formChrome'
import {
  PanelStatus,
  ProfilePanel,
  noteClass,
  panelSaveClass,
  type PanelMessage,
} from './profileChrome'

/**
 * Moving the address the account signs in with.
 *
 * Two steps with an email in between, the same shape as signup, and for a
 * sharper reason here: a typo on signup is a link that never arrives, while a
 * typo written straight onto an existing account is a member locked out of a
 * site they belong to. So the link goes to the *new* address and nothing moves
 * until it is followed.
 *
 * This panel is also where that link lands. The confirmation URL is this page
 * with `?emailToken=…` on it, so the token is spent by a POST rather than by
 * the GET that opened it — mail scanners follow every link in an incoming
 * message, and against a GET endpoint the confirmation would be used up before
 * anybody clicked it.
 */
export function ProfileEmailPanel({
  account,
  onSaved,
}: {
  account: ApiAccount
  onSaved: (account: Partial<ApiAccount>) => void
}) {
  const { adopt } = useSession()
  const id = useId()
  const [params, setParams] = useSearchParams()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<PanelMessage>(null)
  const [pending, setPending] = useState(account.pendingEmail)

  const token = params.get('emailToken')
  /**
   * The token this panel has already posted.
   *
   * A ref rather than a shortened dependency list: `onSaved` is rebuilt on
   * every render of the page above, so the effect genuinely does re-run, and a
   * token must be spent exactly once — the second post would answer 410 and
   * replace "that is your address now" with a refusal about a link that worked.
   */
  const spent = useRef<string | null>(null)

  /**
   * Spend the token the moment the page opens with one.
   *
   * No button, because there is nothing left to decide: following the link from
   * an inbox *was* the confirmation, and asking again on arrival is the same
   * question twice. The token comes out of the URL as soon as it is used, so a
   * reload does not re-post a link that is now spent and answer with a 410 the
   * reader cannot act on.
   */
  useEffect(() => {
    if (!token || spent.current === token) return
    spent.current = token

    setBusy(true)
    setMessage(null)

    postJson<ApiAccountUser>('/account/email/confirm', { token })
      .then(({ user }) => {
        adopt(user)
        onSaved({ email: user.email, pendingEmail: null })
        setPending(null)
        setMessage({
          tone: 'ok',
          text: `That is your address now. Next time, sign in with ${user.email ?? 'it'}.`,
        })
      })
      .catch((error: unknown) => {
        console.error(error)
        setMessage({ tone: 'error', text: explainApiError(error) })
      })
      .finally(() => {
        setBusy(false)
        setParams(
          (current) => {
            const next = new URLSearchParams(current)
            next.delete('emailToken')
            return next
          },
          // Replace, so the back button does not walk somebody onto a spent
          // token and a refusal they have already moved past.
          { replace: true },
        )
      })
  }, [token, adopt, onSaved, setParams])

  const ask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return

    setBusy(true)
    setMessage(null)

    postJson<ApiEmailChangeStarted>('/account/email', {
      password,
      email: email.trim(),
    })
      .then((answer) => {
        setPending(answer.email)
        onSaved({ pendingEmail: answer.email })
        setEmail('')
        setPassword('')
        setMessage({
          tone: 'ok',
          text: `Check ${answer.email} — the link is good for ${answer.expiresInMinutes} minutes. Nothing changes until you follow it.`,
        })
      })
      .catch((error: unknown) => {
        console.error(error)
        setMessage({ tone: 'error', text: explainApiError(error) })
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <ProfilePanel label="EMAIL">
      <p className="text-dim mb-4 text-[13px] leading-[1.6] text-pretty">
        You sign in with <span className="text-base-content">{account.email ?? '—'}</span>.
      </p>

      {pending && (
        <p className={`${noteClass} border-primary/35 bg-primary/5 mb-4 border p-3`}>
          Waiting on <span className="text-base-content">{pending}</span> to be
          confirmed. Until then this one still works.
        </p>
      )}

      <form onSubmit={ask} className="flex flex-col gap-4">
        <div>
          <label htmlFor={`${id}-email`} className={labelClass}>
            NEW EMAIL
          </label>
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            required
            maxLength={200}
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
            }}
            className={fieldClass}
          />
        </div>

        <div>
          <label htmlFor={`${id}-password`} className={labelClass}>
            YOUR CURRENT PASSWORD
          </label>
          <input
            id={`${id}-password`}
            name="currentPassword"
            type="password"
            required
            maxLength={200}
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
            }}
            className={fieldClass}
          />
          <p className={`${noteClass} mt-1.5`}>
            Asked because this is the address you sign in with.
          </p>
        </div>

        <div>
          <button type="submit" disabled={busy} className={panelSaveClass}>
            {busy ? 'SENDING…' : 'SEND THE CONFIRMATION'}
          </button>
        </div>
      </form>

      <PanelStatus message={message} />
    </ProfilePanel>
  )
}
