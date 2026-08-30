import { useId, useState, type FormEvent } from 'react'
import {
  ApiError,
  postJson,
  type ApiContactAvailability,
  type ApiContactSent,
} from '../../lib/api/api'
import { useApi } from '../../lib/api/useApi'

/**
 * The public contact form — the one thing on the site that writes to the
 * database, via `POST /api/contact`.
 *
 * It sits beside the FAQ rather than in a section of its own because the two
 * answer the same question: the FAQ covers what is already written down, this
 * covers what isn't. Anyone who reaches the bottom of the answers without
 * finding theirs has the form right there.
 *
 * Validation is the browser's — `required`, `type="email"`, `maxLength` — with
 * the lengths matching `contactSchema` in `server/src/routes/public/forms.ts` so the
 * field stops you before the server does. The server revalidates regardless;
 * nothing here is a security boundary.
 *
 * Submissions land in `contact_messages` and are read in Prisma Studio. Nothing
 * emails anyone yet — that is Postmark's job, and it goes in the route, not
 * here.
 */
type SendState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'sent' }
  | { status: 'failed'; message: string }

/**
 * The status is the whole point of catching this: an unreachable API, a rate
 * limit and a rejected field are three different things to have done wrong, and
 * "something went wrong" for all three tells the sender nothing about whether
 * trying again would help.
 */
function explain(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) {
      return "Couldn't reach the server. Check your connection and try again."
    }
    if (error.status === 429) {
      // Two different limits answer 429 here and they mean opposite things —
      // "slow down" and "come back tomorrow" — so the server's own sentence
      // wins when it sent one. The fallback is the burst limit's, which is the
      // one with nothing specific to say.
      return (
        error.detail ??
        "That's a few too many messages at once. Please try again in a little while."
      )
    }
    if (error.status === 400) {
      return 'The server turned that down. Check the fields and try again.'
    }
  }

  return 'Something went wrong sending that. Please try again.'
}

/**
 * `FormData.get` is typed `string | File | null`, because a form *can* carry a
 * file. This one can't, but `String()` on the union would quietly post
 * "[object File]" if that ever changed.
 */
function field(data: FormData, name: string): string {
  const value = data.get(name)
  return typeof value === 'string' ? value : ''
}

const labelClass = 'text-faint mb-1.5 block font-mono text-[10px] font-medium tracking-[0.16em]'

const fieldClass = 'input border-rule bg-base-200 w-full text-sm'

export function ContactForm() {
  const [state, setState] = useState<SendState>({ status: 'idle' })
  /**
   * What the send said was left, once one has been sent. Null until then, and
   * the check below is what answers before that.
   *
   * The count comes back from the write rather than being decremented here.
   * One less mirror of a server rule to drift — and the number the route
   * reports is the only one that decides anything.
   */
  const [remaining, setRemaining] = useState<number | null>(null)
  const id = useId()

  /**
   * Ask before drawing the box.
   *
   * A form that takes what somebody typed and then says they were not allowed
   * to send it has wasted the only thing they came here to do — and the daily
   * limit is two, so the second refusal is the common one, not the exotic one.
   *
   * **This is politeness, not the gate.** The gate is `POST /api/contact`,
   * which spends the same window server-side; a bot reloading the page to get
   * at the fields never asks this and is refused there. Which is also why a
   * *failed* check opens the form rather than closing it: the API being
   * unreachable is not evidence that anybody is over their limit, and the one
   * mistake worth avoiding here is a page that hides its contact form because
   * a request nobody depends on came back 500.
   */
  const check = useApi<ApiContactAvailability>('/contact')

  /**
   * What the visitor has left, or null while nothing has answered — a failed
   * check included, which is the case that must not read as zero.
   */
  const left =
    remaining ?? (check.status === 'ready' ? check.data.remaining : null)

  /**
   * `allowed` is the route's own yes-or-no and outranks the count while it is
   * the freshest thing anybody has said. Once a message has gone, the number
   * that came back with it is newer than the check, so that one decides.
   */
  const closed =
    remaining !== null
      ? remaining <= 0
      : check.status === 'ready' && !check.data.allowed

  const refusal =
    (check.status === 'ready' ? check.data.message : null) ??
    "That's your two messages for today. An officer will reply to those; anything else can wait until tomorrow."

  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (state.status === 'sending') return

    // Read synchronously: `currentTarget` is only the form for the length of the
    // handler, and everything below this line is after an await.
    const form = event.currentTarget
    const data = new FormData(form)
    const subject = field(data, 'subject').trim()

    setState({ status: 'sending' })

    postJson<ApiContactSent>('/contact', {
      name: field(data, 'name'),
      email: field(data, 'email'),
      // Omitted rather than empty: the server has it optional, and a blank
      // subject is not a subject.
      ...(subject ? { subject } : {}),
      message: field(data, 'message'),
    })
      .then((sent) => {
        form.reset()
        setRemaining(sent.remaining)
        setState({ status: 'sent' })
      })
      .catch((error: unknown) => {
        console.error(error)
        setState({ status: 'failed', message: explain(error) })
      })
  }

  return (
    <div id="contact" className="scroll-mt-20">
      <h2 className="text-faint mb-9 font-mono text-[13px] font-bold tracking-[0.2em]">
        / CONTACT US
      </h2>

      <p className="text-dim mb-6 text-sm leading-[1.7] text-pretty">
        Still stuck, or want to talk about sponsoring us? An officer will get
        back to you.
      </p>

      {/* A skeleton the shape of the fields it replaces, so the FAQ above and
          the footer below do not jump when the answer lands. Four bars and a
          button, not a faithful copy — the check is one uncached read and is
          usually gone before the first paint settles. */}
      {check.status === 'loading' && (
        <div aria-busy="true" className="flex flex-col gap-4">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex flex-col gap-1.5">
              <div className="bg-base-300 h-2 w-16 animate-pulse rounded-[2px]" />
              <div className="bg-base-300 h-10 w-full animate-pulse rounded-[2px]" />
            </div>
          ))}
          <div className="bg-base-300 h-24 w-full animate-pulse rounded-[2px]" />
          <div className="bg-base-300 h-12 w-full animate-pulse rounded-[2px]" />
        </div>
      )}

      {check.status !== 'loading' && closed && (
        <p className="border-rule bg-base-200 text-dim border p-5 text-sm leading-[1.7] text-pretty">
          {refusal}
        </p>
      )}

      {check.status !== 'loading' && !closed && (
        <form onSubmit={send} noValidate={false} className="flex flex-col gap-4">
          <div>
            <label htmlFor={`${id}-name`} className={labelClass}>
              NAME
            </label>
            <input
              id={`${id}-name`}
              name="name"
              type="text"
              required
              maxLength={100}
              autoComplete="name"
              className={fieldClass}
            />
          </div>

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
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor={`${id}-subject`} className={labelClass}>
              SUBJECT <span className="tracking-normal normal-case">(optional)</span>
            </label>
            <input
              id={`${id}-subject`}
              name="subject"
              type="text"
              maxLength={200}
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor={`${id}-message`} className={labelClass}>
              MESSAGE
            </label>
            <textarea
              id={`${id}-message`}
              name="message"
              required
              maxLength={5000}
              rows={5}
              className="textarea border-rule bg-base-200 w-full text-sm leading-[1.6]"
            />
          </div>

          <button
            type="submit"
            disabled={state.status === 'sending'}
            className="btn btn-primary btn-cta w-full px-6 py-3.5 text-[13px] font-semibold disabled:opacity-60"
          >
            {state.status === 'sending' ? 'SENDING…' : 'SEND MESSAGE'}
          </button>

          {/* Only once one has gone, so a first-time visitor is not told about
              a limit that has no bearing on them. Somebody on their last one is
              worth telling, because the box disappears after it. */}
          {left === 1 && (
            <p className="text-faint font-mono text-[10px] tracking-[0.14em]">
              ONE MESSAGE LEFT TODAY
            </p>
          )}
        </form>
      )}

      {/* Live, because the outcome arrives long after the click and the button
          label is the only other thing that moves. Always rendered so the
          region exists before it has anything to say — a `role="status"` that
          appears at the same moment as its text is often missed.

          Outside the form, because the last message of the day takes the form
          with it and the confirmation for that one still has to be readable. */}
      <p
        role="status"
        className={`text-sm leading-[1.6] ${
          state.status === 'failed' ? 'text-error' : 'text-primary'
        } mt-4`}
      >
        {state.status === 'sent' &&
          'Thanks — that reached us. An officer will reply by email.'}
        {state.status === 'failed' && state.message}
      </p>
    </div>
  )
}
