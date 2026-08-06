import { useId, useState, type FormEvent } from 'react'
import { ApiError, postJson, type ApiSignupStarted } from '../../lib/api'
import {
  JoinEyebrow,
  JoinHeading,
  JoinPanel,
  fieldClass,
  labelClass,
  submitClass,
} from './joinChrome'

/**
 * Step one: who is allowed to join, and where the confirmation is going.
 *
 * The requirement comes before the field on purpose. Membership is for current
 * UCF students and the address has to be one they can open right now — somebody
 * who reads that after typing a Gmail address has already wasted the effort,
 * and somebody who reads it after the email is sent has wasted two minutes
 * waiting for mail they cannot reach.
 *
 * `POST /api/signup/start` stores nothing but the address, so this step creates
 * no account and can be abandoned without leaving anyone to clean up after.
 */

const STUDENT_DOMAIN = '@ucf.edu'

type SendState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'sent'; email: string; expiresInMinutes: number }
  | { status: 'failed'; message: string }

/**
 * Three of these are worth telling apart by status alone, the same three the
 * contact form separates: an unreachable API, a rate limit, and a rejected
 * field. The rest — an address that already has an account, a mailer that is
 * down — are sentences only the server can write, so they come back on the
 * error and are shown as sent.
 */
function explain(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) {
      return "Couldn't reach the server. Check your connection and try again."
    }
    if (error.status === 429) {
      return "That's a few too many tries at once. Please wait a little while before asking for another link."
    }
    if (error.status === 400) {
      return `Check the address — it has to be your UCF student email, ending in ${STUDENT_DOMAIN}.`
    }
    if (error.detail) return error.detail
  }

  return 'Something went wrong starting that. Please try again.'
}

/** "120 minutes" is a configuration value; "2 hours" is an answer. */
function readableExpiry(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`

  const hours = minutes / 60
  return hours === 1 ? 'an hour' : `${Number(hours.toFixed(1))} hours`
}

export function SignupStart() {
  const [state, setState] = useState<SendState>({ status: 'idle' })
  const id = useId()

  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (state.status === 'sending') return

    // Read synchronously: `currentTarget` is only the form for the length of the
    // handler, and everything below this line is after an await.
    const data = new FormData(event.currentTarget)
    const value = data.get('email')
    const email = typeof value === 'string' ? value.trim() : ''

    setState({ status: 'sending' })

    postJson<ApiSignupStarted>('/signup/start', {
      email,
      // The server asks for this too. The checkbox is a promise the browser
      // makes, and the requirement is the entire point of this step.
      acknowledged: true,
    })
      .then((sent) => {
        setState({
          status: 'sent',
          // The server's spelling, lowercased and trimmed — which is what it
          // actually mailed, and worth showing rather than what was typed.
          email: sent.email,
          expiresInMinutes: sent.expiresInMinutes,
        })
      })
      .catch((error: unknown) => {
        console.error(error)
        setState({ status: 'failed', message: explain(error) })
      })
  }

  if (state.status === 'sent') {
    return (
      <>
        <JoinEyebrow>/ CHECK YOUR EMAIL</JoinEyebrow>
        <JoinHeading>Confirm your address.</JoinHeading>

        <p className="text-dim mb-6 text-sm leading-[1.7] text-pretty">
          We sent a link to <strong className="text-white">{state.email}</strong>
          . Open it and you can finish setting up your account. It is good for{' '}
          {readableExpiry(state.expiresInMinutes)}.
        </p>

        {/* The single most common reason someone never finishes signing up, so
            it gets the accent panel rather than a line of small print under the
            fold. University filters are aggressive about mail from addresses
            nobody in the domain has written to before. */}
        <JoinPanel tone="accent">
          <p className="mb-2 text-sm font-semibold">
            Not there? Check your spam folder.
          </p>
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            UCF's filter often files a first email from us as junk or spam. Give
            it a minute or two, then look there before asking for another link —
            and mark it as not spam so the rest of ours reach you.
          </p>
        </JoinPanel>

        <button
          type="button"
          onClick={() => {
            setState({ status: 'idle' })
          }}
          className="text-faint hover:text-primary mt-6 cursor-pointer font-mono text-[11px] font-medium tracking-[0.14em] transition-colors duration-200"
        >
          WRONG ADDRESS? START AGAIN
        </button>
      </>
    )
  }

  return (
    <>
      <JoinEyebrow>/ JOIN THE CLUB</JoinEyebrow>
      <JoinHeading>Become a member.</JoinHeading>

      <JoinPanel tone="accent">
        <p className="mb-2 text-sm font-semibold">
          You need to be a current UCF student.
        </p>
        <p className="text-dim text-sm leading-[1.7] text-pretty">
          Membership is open to currently enrolled UCF students, so signing up
          takes a working <strong className="text-white">{STUDENT_DOMAIN}</strong>{' '}
          address that you can open right now — we send a link there to confirm
          it is yours, and there is no way past that step.
        </p>
      </JoinPanel>

      <form onSubmit={send} className="mt-7 flex flex-col gap-5">
        <div>
          <label htmlFor={`${id}-email`} className={labelClass}>
            UCF STUDENT EMAIL
          </label>
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            required
            maxLength={200}
            autoComplete="email"
            placeholder={`knightro${STUDENT_DOMAIN}`}
            /* The browser's own check for the shape of an address, and a
               pattern for the part that is this club's rule rather than the
               format's. The server enforces both again; neither is a boundary.

               Spelled out a character at a time because `pattern` takes no
               flags and is case-sensitive: the server lowercases before it
               compares, so a plain `@ucf\.edu` would block someone typing
               `@UCF.EDU` on an address the server would have accepted. */
            pattern=".+@[Uu][Cc][Ff]\.[Ee][Dd][Uu]"
            title={`Use your UCF student email, ending in ${STUDENT_DOMAIN}`}
            className={fieldClass}
          />
        </div>

        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="acknowledged"
            required
            className="checkbox checkbox-sm border-rule checked:border-primary checked:bg-primary checked:text-primary-content mt-0.5 shrink-0"
          />
          <span className="text-dim text-sm leading-[1.6] text-pretty">
            I understand — I am a current UCF student and I can read email at
            the address above.
          </span>
        </label>

        <button
          type="submit"
          disabled={state.status === 'sending'}
          className={submitClass}
        >
          {state.status === 'sending' ? 'SENDING…' : 'CONTINUE'}
        </button>

        {/* Live, because the outcome arrives long after the click and the button
            label is the only other thing that moves. Always rendered so the
            region exists before it has anything to say. */}
        <p role="status" className="text-error text-sm leading-[1.6]">
          {state.status === 'failed' && state.message}
        </p>
      </form>
    </>
  )
}
