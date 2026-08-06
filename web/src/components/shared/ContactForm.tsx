import { useId, useState, type FormEvent } from 'react'
import { ApiError, postJson } from '../lib/api'

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
 * the lengths matching `contactSchema` in `server/src/routes/forms.ts` so the
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
      return "That's a few too many messages at once. Please try again in a little while."
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
  const id = useId()

  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (state.status === 'sending') return

    // Read synchronously: `currentTarget` is only the form for the length of the
    // handler, and everything below this line is after an await.
    const form = event.currentTarget
    const data = new FormData(form)
    const subject = field(data, 'subject').trim()

    setState({ status: 'sending' })

    postJson('/contact', {
      name: field(data, 'name'),
      email: field(data, 'email'),
      // Omitted rather than empty: the server has it optional, and a blank
      // subject is not a subject.
      ...(subject ? { subject } : {}),
      message: field(data, 'message'),
    })
      .then(() => {
        form.reset()
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
        Still stuck, or want to talk about sponsoring us? Send a note and an
        officer will get back to you.
      </p>

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

        {/* Live, because the outcome arrives long after the click and the button
            label is the only other thing that moves. Always rendered so the
            region exists before it has anything to say — a `role="status"` that
            appears at the same moment as its text is often missed. */}
        <p
          role="status"
          className={`text-sm leading-[1.6] ${
            state.status === 'failed' ? 'text-error' : 'text-primary'
          }`}
        >
          {state.status === 'sent' &&
            'Thanks — that reached us. An officer will reply by email.'}
          {state.status === 'failed' && state.message}
        </p>
      </form>
    </div>
  )
}
