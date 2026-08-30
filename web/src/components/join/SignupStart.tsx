import { useEffect, useId, useState, type FormEvent } from 'react'
import { ApiError, postJson, type ApiSignupStarted } from '../../lib/api/api'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  fieldClass,
  labelClass,
  submitClass,
} from '../shared/formChrome'

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

/**
 * How long "start again" stays shut after a link goes out.
 *
 * Starting again is one click away from asking for a second email, and the
 * usual reason somebody reaches for it is that the first one has not arrived in
 * the four seconds they have been watching for it. Mail takes longer than that,
 * every extra request pushes the previous link out of date, and enough of them
 * in a row is how a sender's reputation gets spent.
 */
const RESTART_COOLDOWN_MS = 30_000

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
  /** When "start again" opens up. 0 means it is not counting down. */
  const [restartAt, setRestartAt] = useState(0)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const id = useId()

  /**
   * Counted from a deadline rather than by decrementing a number every second.
   *
   * The expected thing to do on this screen is switch to a mail app, and a
   * background tab has its timers throttled to roughly one a minute — a
   * countdown built from ticks would still be showing twenty-odd seconds after
   * five minutes away. Reading the clock each time means the wait is over when
   * it is actually over.
   */
  useEffect(() => {
    if (!restartAt) return

    const update = () => {
      setSecondsLeft(Math.max(0, Math.ceil((restartAt - Date.now()) / 1000)))
    }

    update()
    const timer = setInterval(update, 500)

    return () => {
      clearInterval(timer)
    }
  }, [restartAt])

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
        setRestartAt(Date.now() + RESTART_COOLDOWN_MS)
      })
      .catch((error: unknown) => {
        console.error(error)
        setState({ status: 'failed', message: explain(error) })
      })
  }

  if (state.status === 'sent') {
    return (
      <>
        <FormEyebrow>/ CHECK YOUR EMAIL</FormEyebrow>
        <FormHeading>Confirm your address.</FormHeading>

        <p className="text-dim mb-6 text-sm leading-[1.7] text-pretty">
          We sent a link to <strong className="text-base-content">{state.email}</strong>
          . Open it and you can finish setting up your account. It is good for{' '}
          {readableExpiry(state.expiresInMinutes)}.
        </p>

        {/* The single most common reason someone never finishes signing up, so
            it gets the accent panel rather than a line of small print under the
            fold. University filters are aggressive about mail from addresses
            nobody in the domain has written to before. */}
        <FormPanel tone="accent">
          <p className="mb-2 text-sm font-semibold">
            Not there? Check your spam folder.
          </p>
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            UCF's filter often files our first email as junk. Mark it as not
            spam so the rest reach you.
          </p>
        </FormPanel>

        {/* Said plainly because the alternative is somebody sitting on this tab
            waiting for it to advance by itself. It never does: the rest of
            signup hangs off the token in the link, which is what lets them
            finish on their phone after starting on a laptop. */}
        <p className="text-dim mt-6 text-sm leading-[1.7] text-pretty">
          You can close this tab — carry on from the link, on any device.
        </p>

        <button
          type="button"
          disabled={secondsLeft > 0}
          onClick={() => {
            setState({ status: 'idle' })
            setRestartAt(0)
          }}
          className="mt-6 block font-mono text-[11px] font-medium tracking-[0.14em] transition-colors duration-200 not-disabled:cursor-pointer disabled:cursor-not-allowed"
        >
          {/* Only the second half is the link. The first half is the question
              it answers, and painting both gold made the whole line read as one
              long button. */}
          <span className="text-faint">WRONG ADDRESS? </span>
          {secondsLeft > 0 ? (
            <span className="text-faint">START AGAIN IN {secondsLeft}S</span>
          ) : (
            <span className="text-primary underline decoration-transparent underline-offset-4 transition-[text-decoration-color] duration-200 hover:decoration-current">
              START AGAIN
            </span>
          )}
        </button>
      </>
    )
  }

  return (
    <>
      <FormEyebrow>/ JOIN THE CLUB</FormEyebrow>
      <FormHeading>Become a member.</FormHeading>

      <FormPanel tone="accent">
        <p className="mb-2 text-sm font-semibold">
          You need to be a current UCF student.
        </p>
        <p className="text-dim text-sm leading-[1.7] text-pretty">
          Signing up takes a working{' '}
          <strong className="text-base-content">{STUDENT_DOMAIN}</strong> address you
          can open right now — we send a confirmation link there.
        </p>
      </FormPanel>

      {/* Directly under the requirement, because this is the line somebody
          reads the moment they find out it rules them out — a page that says
          "students only" and stops is a dead end for every school team, mentor
          and volunteer who came here wanting to build something.

          A plain `<a>`, not a `<Link>`: the target is a section of the front
          page, and a router navigation would take the hash over and then not
          scroll to it. Written `/#partners` rather than `#partners` for the
          same reason the nav's links are — a bare fragment on this route
          scrolls to nothing. */}
      <p className="text-faint mt-4 text-[13px] leading-[1.6] text-pretty">
        Not a UCF student? There are still ways in —{' '}
        <a
          href="/#partners"
          className="text-primary underline decoration-transparent underline-offset-4 transition-[text-decoration-color] duration-200 hover:decoration-current"
        >
          see the programs we partner with
        </a>
        .
      </p>

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
            I am a current UCF student and can read email at this address.
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
