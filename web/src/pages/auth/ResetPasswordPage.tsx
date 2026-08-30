import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import {
  FormEyebrow,
  FormHeading,
  FormPage,
  FormPanel,
  fieldClass,
  labelClass,
  submitClass,
} from '../../components/shared/formChrome'
import { ApiError, postJson, type ApiPasswordResetSent } from '../../lib/api/api'
import { useSession } from '../../lib/auth/session'

/**
 * Getting back in without a password.
 *
 * One route with two halves, keyed on `?token` — the same shape `/join` uses
 * for its start and finish screens, and for the same reason: the emailed link
 * has to land somewhere real, and `/reset-password?token=…` is a URL somebody
 * might have to read out.
 *
 * Until this page existed the login form said there was no reset link and told
 * people to ask an officer, who set a hash by hand in Prisma Studio.
 */

/** Mirrors the server, which is length and nothing else. */
const MIN_LENGTH = 10

/** A `FormData` entry is a string *or a File*, and `String()` on the second
    gives "[object File]". The same helper the login page uses. */
function field(data: FormData, name: string): string {
  const value = data.get(name)
  return typeof value === 'string' ? value : ''
}

/**
 * A failure, as a sentence somebody can act on.
 *
 * Its own rather than `lib/apiErrors`, for the same reason the login page has
 * one: that helper answers every 429 with "too many changes at once", which is
 * management-page wording and says the wrong thing here — nothing was changed,
 * and the server's own 429 explains that a link has already gone out and where
 * to look for it. Both of the statuses this page can produce are ones the
 * server phrases better than the browser can, so `detail` comes first.
 */
function explain(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) {
      return "Couldn't reach the server. Check your connection and try again."
    }
    // The 410 for a spent link and the 429 for a second request are both
    // written to be read.
    if (error.detail) return error.detail
    if (error.status === 400) {
      return `Check the password — it needs at least ${MIN_LENGTH} characters.`
    }
  }

  return 'Something went wrong. Please try again.'
}

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token')

  return (
    <FormPage>
      {token ? <SetNewPassword token={token} /> : <AskForALink />}
    </FormPage>
  )
}

/**
 * Step one: the address.
 *
 * The answer is the server's own sentence and it is the same one whatever was
 * found. An answer that differed for an unknown address would turn this form
 * into a way to ask whether a given student is in the club, one address at a
 * time — which is exactly what the sign-in form next door is careful not to be.
 */
function AskForALink() {
  const id = useId()
  const [state, setState] = useState<
    | { status: 'idle' }
    | { status: 'sending' }
    | { status: 'sent'; message: string }
    | { status: 'failed'; message: string }
  >({ status: 'idle' })

  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (state.status === 'sending') return

    const data = new FormData(event.currentTarget)

    setState({ status: 'sending' })

    postJson<ApiPasswordResetSent>('/auth/password/forgot', {
      email: field(data, 'email'),
    })
      .then((answer) => {
        setState({ status: 'sent', message: answer.message })
      })
      .catch((error: unknown) => {
        console.error(error)
        setState({ status: 'failed', message: explain(error) })
      })
  }

  if (state.status === 'sent') {
    return (
      <>
        <FormEyebrow>/ RESET YOUR PASSWORD</FormEyebrow>
        <FormHeading>Check your email.</FormHeading>

        <FormPanel tone="accent">
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            {state.message}
          </p>
        </FormPanel>

        <p className="text-faint mt-6 text-[13px] leading-[1.7] text-pretty">
          Check spam if it doesn&rsquo;t arrive.
        </p>

        <div className="mt-6">
          <Link
            to="/login"
            className="text-primary font-mono text-[11px] font-medium tracking-[0.1em] underline underline-offset-2"
          >
            BACK TO SIGN IN
          </Link>
        </div>
      </>
    )
  }

  return (
    <>
      <FormEyebrow>/ RESET YOUR PASSWORD</FormEyebrow>
      <FormHeading>Forgotten it?</FormHeading>

      <form onSubmit={send} className="flex flex-col gap-5">
        <div>
          <label htmlFor={`${id}-email`} className={labelClass}>
            EMAIL
          </label>
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            required
            maxLength={200}
            autoComplete="email"
            autoFocus
            className={fieldClass}
          />
        </div>

        <button
          type="submit"
          disabled={state.status === 'sending'}
          className={submitClass}
        >
          {state.status === 'sending' ? 'SENDING…' : 'SEND ME A LINK'}
        </button>

        <p role="status" className="text-error text-sm leading-[1.6] text-pretty">
          {state.status === 'failed' && state.message}
        </p>
      </form>
    </>
  )
}

/**
 * Step two: the new password.
 *
 * Twice, for the same reason the profile page asks twice — there is nobody to
 * tell somebody they mistyped, and the cost of a typo is being locked out of
 * the account they are in the middle of recovering.
 */
function SetNewPassword({ token }: { token: string }) {
  const id = useId()
  const navigate = useNavigate()
  const { session, refresh } = useSession()

  const [state, setState] = useState<
    | { status: 'idle' }
    | { status: 'saving' }
    | { status: 'done' }
    | { status: 'failed'; message: string }
  >({ status: 'idle' })

  /**
   * The reset ends every session the account had, this browser's included, so
   * somebody who was signed in when they followed the link is signed out by the
   * time it lands. Re-reading the session is what makes the nav agree with that
   * rather than going on showing a name.
   */
  useEffect(() => {
    if (state.status === 'done' && session.status === 'signed-in') {
      void refresh()
    }
  }, [state.status, session.status, refresh])

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (state.status === 'saving') return

    const data = new FormData(event.currentTarget)
    const password = field(data, 'password')
    const again = field(data, 'passwordAgain')

    if (password !== again) {
      setState({ status: 'failed', message: 'Those two do not match.' })
      return
    }

    setState({ status: 'saving' })

    postJson('/auth/password/reset', { token, password })
      .then(() => {
        setState({ status: 'done' })
      })
      .catch((error: unknown) => {
        console.error(error)
        setState({ status: 'failed', message: explain(error) })
      })
  }

  if (state.status === 'done') {
    return (
      <>
        <FormEyebrow>/ RESET YOUR PASSWORD</FormEyebrow>
        <FormHeading>That&rsquo;s done.</FormHeading>

        <p className="text-dim mb-7 text-sm leading-[1.7] text-pretty">
          Your password is set. Every device has been signed out.
        </p>

        <button
          type="button"
          onClick={() => void navigate('/login', { replace: true })}
          className={submitClass}
        >
          SIGN IN
        </button>
      </>
    )
  }

  return (
    <>
      <FormEyebrow>/ RESET YOUR PASSWORD</FormEyebrow>
      <FormHeading>Set a new one.</FormHeading>

      <p className="text-dim mb-7 text-sm leading-[1.7] text-pretty">
        At least {MIN_LENGTH} characters.
      </p>

      <form onSubmit={save} className="flex flex-col gap-5">
        <div>
          <label htmlFor={`${id}-password`} className={labelClass}>
            NEW PASSWORD
          </label>
          <input
            id={`${id}-password`}
            name="password"
            type="password"
            required
            minLength={MIN_LENGTH}
            maxLength={200}
            autoComplete="new-password"
            autoFocus
            className={fieldClass}
          />
        </div>

        <div>
          <label htmlFor={`${id}-again`} className={labelClass}>
            NEW PASSWORD AGAIN
          </label>
          <input
            id={`${id}-again`}
            name="passwordAgain"
            type="password"
            required
            maxLength={200}
            autoComplete="new-password"
            className={fieldClass}
          />
        </div>

        <button
          type="submit"
          disabled={state.status === 'saving'}
          className={submitClass}
        >
          {state.status === 'saving' ? 'SAVING…' : 'SET MY PASSWORD'}
        </button>

        <p role="status" className="text-error text-sm leading-[1.6] text-pretty">
          {state.status === 'failed' && state.message}
        </p>
      </form>

      <div className="mt-8">
        <FormPanel>
          <p className="text-faint mb-3 font-mono text-[10px] font-medium tracking-[0.16em]">
            LINK EXPIRED?
          </p>
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            They expire, and each one works only once.{' '}
            <Link
              to="/reset-password"
              className="text-primary underline underline-offset-2"
            >
              Ask for another
            </Link>
            .
          </p>
        </FormPanel>
      </div>
    </>
  )
}
