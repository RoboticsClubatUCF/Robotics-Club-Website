import { useEffect, useId, useState } from 'react'
import { postJson, type ApiDiscordCheck } from '../../lib/api/api'
import { fieldClass, labelClass } from './formChrome'
import instructionsUrl from '../../assets/DiscordInstructions.png'

/**
 * The Discord handle, checked against the club's server while it's typed.
 *
 * This field gets more machinery than the rest of the form put together, and it earns it: nearly
 * everything the club plans to build on an account joins on this string, so a handle one character
 * out is a member who quietly never gets added to anything. Finding that out here costs a
 * correction; finding it out in April costs somebody's semester.
 *
 * Two mistakes account for almost all of them. Typing the display name instead of the username —
 * which is what the screenshot beside the label is for. And not being in the club's server at all,
 * which is why the answer comes from a search of that server and sits under the invite QR code.
 *
 * It lives in `shared/` because two pages use it: signup, and the profile page editing the handle
 * on an account that already exists.
 */

type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'answered'; result: ApiDiscordCheck }
  /** The check itself failed — offline, rate limited. Not an answer about the
      handle, and must not be dressed up as one. */
  | { status: 'error' }

/**
 * The same tidying the server does, so the field does not ask about a string
 * the server would never look up. The `@` comes from Discord's own UI and the
 * capitals from people typing their name the way they think of it — neither is
 * worth an error message.
 */
const normalise = (input: string) =>
  input.trim().replace(/^@+/, '').toLowerCase()

/** Discord's rules: 2–32 characters of lowercase letters, digits, `_` and `.`. */
const isHandleShaped = (handle: string) => /^[a-z0-9._]{2,32}$/.test(handle)

/** Long enough that a correction does not fire a request per keystroke, short
    enough that the answer feels like it belongs to what was just typed. */
const DEBOUNCE_MS = 700

function message(state: CheckState): { text: string; tone: string } | null {
  if (state.status === 'checking') {
    return { text: 'Checking Discord…', tone: 'text-faint' }
  }

  if (state.status === 'error') {
    return {
      text: "Couldn't check that just now. Try again in a moment.",
      tone: 'text-dim',
    }
  }

  if (state.status !== 'answered') return null

  switch (state.result.status) {
    case 'connected':
      return { text: 'Successfully connected.', tone: 'text-success' }
    case 'not_found':
      return { text: 'Cannot find that user.', tone: 'text-error' }
    case 'taken':
      return {
        text: 'That Discord username is already connected to another account.',
        tone: 'text-error',
      }
    case 'unavailable':
      return {
        text: "Couldn't reach Discord to check that right now. Try again in a moment.",
        tone: 'text-dim',
      }
    case 'unchecked':
      // No bot configured. Saying nothing would read as approval, and claiming
      // a connection nobody confirmed is the one thing this field must not do.
      return {
        text: 'Saved as typed — we cannot confirm it automatically right now.',
        tone: 'text-dim',
      }
  }
}

export function DiscordUsernameField({
  value,
  onChange,
  checkPath = '/signup/discord-check',
}: {
  value: string
  onChange: (value: string) => void
  /**
   * Which endpoint answers "is this handle free".
   *
   * The default is signup's, which is unauthenticated and calls a handle taken if any account
   * holds it. The profile page passes `/account/discord-check` instead, which excuses the caller —
   * without that, somebody re-saving the handle they already have is told it's taken by
   * themselves. Which row to excuse is decided from the session on the server.
   */
  checkPath?: string
}) {
  const [state, setState] = useState<CheckState>({ status: 'idle' })
  const [pinned, setPinned] = useState(false)
  const id = useId()

  useEffect(() => {
    const handle = normalise(value)

    if (!handle) {
      setState({ status: 'idle' })
      return
    }

    if (!isHandleShaped(handle)) {
      // Answered without asking, exactly as the server would. A display name
      // fails this — capitals and spaces are not legal in a handle — and that
      // is the mistake worth catching before a round trip.
      setState({ status: 'answered', result: { status: 'not_found' } })
      return
    }

    const controller = new AbortController()

    const timer = setTimeout(() => {
      setState({ status: 'checking' })

      postJson<ApiDiscordCheck>(
        checkPath,
        { discordUsername: handle },
        controller.signal,
      )
        .then((result) => {
          setState({ status: 'answered', result })
        })
        .catch((error: unknown) => {
          // An abort is this effect being cleaned up, not a failure — the value
          // changed and a newer check is already on its way.
          if (controller.signal.aborted) return
          console.error(error)
          setState({ status: 'error' })
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [value, checkPath])

  const note = message(state)

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <label htmlFor={`${id}-discord`} className={`${labelClass} mb-0`}>
          DISCORD USERNAME
        </label>

        {/* `group` so the card counts as part of the trigger: the pointer can
            travel onto the screenshot without it vanishing on the way. The gap
            between the two is the card's own padding rather than a margin, or
            the hover would drop as the pointer crossed it. */}
        <span className="group relative inline-flex">
          <button
            type="button"
            aria-expanded={pinned}
            /* Hover is not available to a thumb and not available to a
               keyboard. The same card opens on click, which is the only reason
               this is a button at all. */
            onClick={() => {
              setPinned(!pinned)
            }}
            className="border-rule text-faint hover:border-primary hover:text-primary focus-visible:outline-primary flex size-4.5 cursor-pointer items-center justify-center rounded-full border font-mono text-[10px] leading-none font-semibold transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <span aria-hidden>i</span>
            <span className="sr-only">
              Show me where to find my Discord username
            </span>
          </button>

          <span
            className={`absolute top-full left-0 z-20 pt-2 transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 ${
              pinned ? 'visible opacity-100' : 'invisible opacity-0'
            }`}
          >
            {/* Not lazy-loaded: by the time somebody reaches for this they are
                already confused, and a spinner is a worse answer than the
                picture. It is 113kB on a page that is otherwise text. */}
            <img
              src={instructionsUrl}
              alt="A Discord profile. The display name at the top, PhiBi, is marked “Not this”. The username underneath it, phibiscool, is marked “This”."
              className="border-rule w-[min(17rem,72vw)] max-w-none border shadow-2xl"
            />
          </span>
        </span>
      </div>

      <input
        id={`${id}-discord`}
        name="discordUsername"
        type="text"
        required
        maxLength={64}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="phibiscool"
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className={fieldClass}
      />

      {/* Live: the answer arrives a beat after typing stops, and nothing else on
          screen moves when it does. Always rendered, so the region exists before
          it has anything to announce. */}
      <p
        role="status"
        className={`mt-1.5 min-h-5 text-[13px] leading-[1.5] ${note?.tone ?? ''}`}
      >
        {note?.text}
      </p>
    </div>
  )
}
