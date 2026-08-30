import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ApiError, postJson, type ApiSignupCreated } from '../../lib/api/api'
import { socialLinks } from '../../content/home'
import { AcknowledgementDialog } from './AcknowledgementDialog'
import { DiscordUsernameField } from '../shared/DiscordUsernameField'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  fieldClass,
  labelClass,
  submitClass,
} from '../shared/formChrome'
import qrCodeUrl from '../../assets/qr-code.png'

/**
 * Step two: everything else, once the address has been proved.
 *
 * The address itself is not a field here — it comes from the link, and showing
 * it read-only is what tells someone with three UCF addresses forwarded into
 * one inbox which account they are making.
 *
 * The Discord half of the form is deliberately one block: the invite, the
 * instruction, and the field that will fail without them, in the order somebody
 * needs them. Asking for a handle above a QR code that would have got them one
 * is how you collect handles for accounts that do not exist.
 */

const PASSWORD_MIN = 10

type CreateState =
  | { status: 'idle' }
  | { status: 'creating' }
  | { status: 'failed'; message: string; expired?: boolean }

function explain(error: unknown): { message: string; expired?: boolean } {
  if (error instanceof ApiError) {
    if (error.status === 0) {
      return {
        message:
          "Couldn't reach the server. Check your connection and try again.",
      }
    }
    if (error.status === 429) {
      return {
        message:
          "That's a few too many tries at once. Please wait a little while and try again.",
      }
    }
    if (error.status === 410) {
      // The one failure the form cannot recover from: the link is spent, so
      // there is nothing to submit against however the fields are corrected.
      return { message: error.detail ?? 'That link has expired.', expired: true }
    }
    if (error.status === 400) {
      return { message: 'Check the fields and try again.' }
    }
    if (error.detail) return { message: error.detail }
  }

  return { message: 'Something went wrong creating that. Please try again.' }
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

const discordInvite = socialLinks.find((link) => link.label === 'DISCORD')?.href

export function SignupFinish({
  email,
  token,
  onCreated,
}: {
  email: string
  token: string
  onCreated: () => void
}) {
  const [state, setState] = useState<CreateState>({ status: 'idle' })
  // Controlled, because the field beside it checks the value against Discord as
  // it settles. Everything else is read off the form at submit.
  const [discordUsername, setDiscordUsername] = useState('')
  const [readingAcknowledgement, setReadingAcknowledgement] = useState(false)
  const id = useId()

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (state.status === 'creating') return

    const data = new FormData(event.currentTarget)
    const password = field(data, 'password')

    if (password !== field(data, 'confirmPassword')) {
      setState({ status: 'failed', message: 'Those two passwords do not match.' })
      return
    }

    setState({ status: 'creating' })

    postJson<ApiSignupCreated>('/signup/complete', {
      token,
      firstName: field(data, 'firstName'),
      lastName: field(data, 'lastName'),
      password,
      discordUsername,
      // Read off the box rather than hardcoded, unlike the eligibility one on
      // the first step. `required` means a browser never submits this unchecked,
      // so sending what it actually says costs nothing and keeps the server's
      // copy of the agreement honest if it ever does.
      acknowledgementAccepted: field(data, 'acknowledgementAccepted') === 'on',
    })
      .then(onCreated)
      .catch((error: unknown) => {
        console.error(error)
        setState({ status: 'failed', ...explain(error) })
      })
  }

  return (
    <>
      <FormEyebrow>/ ALMOST THERE</FormEyebrow>
      <FormHeading>Finish setting up your account.</FormHeading>

      <p className="text-dim mb-7 text-sm leading-[1.7] text-pretty">
        Confirmed for <strong className="text-base-content">{email}</strong>. A couple
        more things and you are on the roster.
      </p>

      <form onSubmit={create} className="flex flex-col gap-5">
        {/* Two columns above the breakpoint only. Side by side on a phone gives
            each name about eighty pixels. */}
        <div className="grid gap-5 wide:grid-cols-2">
          <div>
            <label htmlFor={`${id}-first`} className={labelClass}>
              FIRST NAME
            </label>
            <input
              id={`${id}-first`}
              name="firstName"
              type="text"
              required
              maxLength={50}
              autoComplete="given-name"
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor={`${id}-last`} className={labelClass}>
              LAST NAME
            </label>
            <input
              id={`${id}-last`}
              name="lastName"
              type="text"
              required
              maxLength={50}
              autoComplete="family-name"
              className={fieldClass}
            />
          </div>
        </div>

        <div>
          <label htmlFor={`${id}-password`} className={labelClass}>
            PASSWORD
          </label>
          <input
            id={`${id}-password`}
            name="password"
            type="password"
            required
            minLength={PASSWORD_MIN}
            maxLength={200}
            autoComplete="new-password"
            aria-describedby={`${id}-password-help`}
            className={fieldClass}
          />
          {/* Length and nothing else — the rule the server actually applies.
              Composition requirements push people toward `Password1!` and are
              no longer advised by anyone who has measured them. */}
          <p
            id={`${id}-password-help`}
            className="text-faint mt-1.5 text-[13px] leading-[1.5]"
          >
            At least {PASSWORD_MIN} characters.
          </p>
        </div>

        <div>
          <label htmlFor={`${id}-confirm`} className={labelClass}>
            CONFIRM PASSWORD
          </label>
          <input
            id={`${id}-confirm`}
            name="confirmPassword"
            type="password"
            required
            minLength={PASSWORD_MIN}
            maxLength={200}
            autoComplete="new-password"
            className={fieldClass}
          />
        </div>

        <FormPanel>
          <p className="mb-1.5 text-sm font-semibold">
            Make sure you are in the club Discord!
          </p>
          <p className="text-dim mb-5 text-sm leading-[1.7] text-pretty">
            Scan to join, then give us the username you joined with.
          </p>

          {/* On white, with a margin of it. A QR code needs light modules on a
              dark-enough background and a quiet zone around the outside — on
              the page's near-black it is a decoration that no phone will read.

              **Literal white in both themes, deliberately.** This is not the
              page's surface, it is the code's own quiet zone, and a scanner
              cares about the contrast between the modules and their margin
              rather than about our palette. It keeps a rule in light mode
              because an off-white page under a pure-white card otherwise leaves
              the quiet zone with no edge to it. */}
          <div className="border-rule mb-5 inline-block border bg-white p-3">
            <img
              src={qrCodeUrl}
              alt="QR code linking to the Robotics Club of Central Florida Discord invite"
              className="size-40"
            />
          </div>

          {discordInvite && (
            /* Nobody scans a code with the device it is displayed on, and a
               good half of signups will be at a laptop. */
            <p className="text-faint mb-6 text-[13px] leading-[1.5]">
              On the same device?{' '}
              <a
                href={discordInvite}
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary underline underline-offset-2"
              >
                Open the invite instead
              </a>
              .
            </p>
          )}

          <DiscordUsernameField
            value={discordUsername}
            onChange={setDiscordUsername}
          />
        </FormPanel>

        {/* The box and the link that opens the document are siblings, not
            nested: a `<button>` inside a `<label htmlFor>` gets the label's
            activation too, so opening the rules would tick the box that says
            they have been read. */}
        <div className="flex items-start gap-3">
          <input
            id={`${id}-acknowledgement`}
            type="checkbox"
            name="acknowledgementAccepted"
            required
            className="checkbox checkbox-sm border-rule checked:border-primary checked:bg-primary checked:text-primary-content mt-0.5 shrink-0"
          />
          <div className="text-dim text-sm leading-[1.6] text-pretty">
            <label
              htmlFor={`${id}-acknowledgement`}
              className="cursor-pointer"
            >
              I have read and agree to the RCCF member acknowledgement.
            </label>{' '}
            <button
              type="button"
              onClick={() => {
                setReadingAcknowledgement(true)
              }}
              className="text-primary cursor-pointer underline underline-offset-2"
            >
              Read it
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={state.status === 'creating'}
          className={submitClass}
        >
          {state.status === 'creating' ? 'CREATING…' : 'CREATE MY ACCOUNT'}
        </button>

        <div role="status">
          {state.status === 'failed' && (
            <p className="text-error text-sm leading-[1.6] text-pretty">
              {state.message}
            </p>
          )}
          {state.status === 'failed' && state.expired && (
            <Link
              to="/join"
              reloadDocument
              className="text-faint hover:text-primary mt-3 inline-block font-mono text-[11px] font-medium tracking-[0.14em] transition-colors duration-200"
            >
              START AGAIN
            </Link>
          )}
        </div>
      </form>

      {/* Outside the form: a dialog inside one is legal, but everything in
          there is a control the browser would otherwise consider part of it. */}
      <AcknowledgementDialog
        open={readingAcknowledgement}
        onClose={() => {
          setReadingAcknowledgement(false)
        }}
      />
    </>
  )
}
