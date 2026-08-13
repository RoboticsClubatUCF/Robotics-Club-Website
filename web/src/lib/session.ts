import { createContext, useContext } from 'react'
import type { ApiUser } from './api'

/**
 * The session context and the hook that reads it.
 *
 * Split from the provider in `auth.tsx` only so that the file holding a React
 * component holds nothing else — Fast Refresh gives up on a module that mixes
 * components with anything, and quietly stops hot-reloading the provider that
 * wraps the entire app.
 */

export type SessionState =
  /** Still asking. Distinct from signed-out — the nav treats them alike, but
      the dashboard must not redirect somebody to sign in before it knows. */
  | { status: 'loading' }
  | { status: 'signed-in'; user: ApiUser }
  | { status: 'signed-out' }
  /** The API could not be reached. Not the same as nobody being signed in. */
  | { status: 'error' }

export interface SessionContextValue {
  session: SessionState
  /** Re-read the session — after signing in, or when a page suspects it is stale. */
  refresh: () => Promise<void>
  signOut: () => Promise<void>
  /** Adopt the user a sign-in just returned, without a second round trip. */
  adopt: (user: ApiUser) => void
}

export const SessionContext = createContext<SessionContextValue | null>(null)

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext)

  if (!value) {
    // Thrown rather than defaulted to signed-out. A component rendered outside
    // the provider would otherwise render the anonymous version of itself for
    // ever, which looks like a session bug and is a wiring bug.
    throw new Error('useSession must be used inside a <SessionProvider>')
  }

  return value
}
