import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import {
  FormEyebrow,
  FormHeading,
  FormPage,
  fieldClass,
  labelClass,
  submitClass,
} from '../../components/shared/formChrome'
import { ApiError, postJson, type ApiUser } from '../../lib/api/api'
import { useSession } from '../../lib/auth/session'

/**
 * Signing in.
 *
 * The counterpart to `/join`, and much the smaller half: signup is four screens
 * because it has to prove an address and connect a Discord account, while this
 * is two fields and a cookie.
 *
 * Where somebody lands afterwards is whichever page sent them here — the dues
 * page pushes `state.from` when it finds nobody signed in, so paying dues from
 * a cold start is sign in, then straight back to what you were doing, rather
 * than a detour through the dashboard.
 */

type SignInState =
  | { status: 'idle' }
  | { status: 'signing-in' }
  | { status: 'failed'; message: string }

/**
 * The same three the other forms separate by status alone — unreachable, rate
 * limited, rejected — plus the one sentence the server writes itself.
 *
 * A 401 is deliberately not given a message here. The server says the same
 * thing for a wrong password, an unknown address and an account that has never
 * had a password set, and paraphrasing it would risk splitting them apart
 * again; the whole point is that a login form must not answer "is this person a
 * member".
 */
function explain(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) {
      return "Couldn't reach the server. Check your connection and try again."
    }
    if (error.status === 429) {
      return "That's a few too many attempts. Please wait a little while and try again."
    }
    if (error.detail) return error.detail
    if (error.status === 400) {
      return 'Check the email and password and try again.'
    }
  }

  return 'Something went wrong signing you in. Please try again.'
}

function field(data: FormData, name: string): string {
  const value = data.get(name)
  return typeof value === 'string' ? value : ''
}

export function LoginPage() {
  const [state, setState] = useState<SignInState>({ status: 'idle' })
  const { session, adopt } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const id = useId()

  // Where to go afterwards. `replace` throughout, so the back button does not
  // walk somebody back into a login form they have already used.
  const from =
    (location.state as { from?: string } | null)?.from ?? '/dashboard'

  // Somebody already signed in has no business on this page — they arrive here
  // by bookmark, or by pressing back after signing in.
  useEffect(() => {
    if (session.status === 'signed-in') {
      void navigate(from, { replace: true })
    }
  }, [session.status, from, navigate])

  const signIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (state.status === 'signing-in') return

    const data = new FormData(event.currentTarget)
    setState({ status: 'signing-in' })

    postJson<{ user: ApiUser }>('/auth/login', {
      email: field(data, 'email'),
      password: field(data, 'password'),
    })
      .then(({ user }) => {
        // Adopted straight from the response rather than re-fetching `/auth/me`.
        // The nav is watching the same context, and a round trip here is a
        // visible flicker between "sign in" and a name for no new information.
        adopt(user)
        void navigate(from, { replace: true })
      })
      .catch((error: unknown) => {
        console.error(error)
        setState({ status: 'failed', message: explain(error) })
      })
  }

  return (
    <FormPage>
      <FormEyebrow>/ SIGN IN</FormEyebrow>
      <FormHeading>Welcome back.</FormHeading>

      <form onSubmit={signIn} className="flex flex-col gap-5">
        <div>
          {/* "Email", not "UCF student email" as the signup form says. Signing
              up is restricted to @ucf.edu; signing in is not, because a roster
              entry an officer made by hand, and the seeded admin account, are
              both real logins on other domains. A `pattern` here would lock
              them out of a site their own account works on. */}
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
            /* Focused on arrival: this page has exactly one starting point and
               nothing above the field worth reading twice. */
            autoFocus
            className={fieldClass}
          />
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
            maxLength={200}
            /* `current-password`, not `new-password` — this is what tells a
               password manager to offer what it has rather than propose a new
               one, which is the difference between signing in with one click
               and being locked out by a manager that saved something else. */
            autoComplete="current-password"
            className={fieldClass}
          />
          {/* No length rule here, unlike signup. The rule belongs where a
              password is set; applying it to sign-in would refuse to even try
              an older account's password and would tell anyone guessing what
              shape to guess. */}
        </div>

        <button
          type="submit"
          disabled={state.status === 'signing-in'}
          className={submitClass}
        >
          {state.status === 'signing-in' ? 'SIGNING IN…' : 'SIGN IN'}
        </button>

        {/* Live, because the outcome lands well after the click and the button
            label is the only other thing that moves. Always rendered so the
            region exists before it has anything to say. */}
        <p role="status" className="text-error text-sm leading-[1.6] text-pretty">
          {state.status === 'failed' && state.message}
        </p>
      </form>

      {/* Both links, no prose. The reset link works even for an account that
          has never had a password — a roster entry an officer typed in — but
          saying so here only invites the question. */}
      <p className="text-dim mt-8 flex gap-4 text-sm">
        <Link to="/join" className="text-primary underline underline-offset-2">
          Create an account
        </Link>
        <Link
          to="/reset-password"
          className="text-primary underline underline-offset-2"
        >
          Forgot password?
        </Link>
      </p>
    </FormPage>
  )
}
