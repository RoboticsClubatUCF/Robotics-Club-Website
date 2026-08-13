import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { getJson, postJson, type ApiSession, type ApiUser } from './api'
import { SessionContext, type SessionState } from './session'

/**
 * Who is signed in, for the whole app.
 *
 * Deliberately a context rather than a `useApi` call per component. Three
 * separate places want the answer — the nav, the dashboard and the dues page —
 * and `useApi` has no cache, so each would ask independently and the nav would
 * flicker from "sign in" to a name after the page below it had already settled.
 *
 * Nothing about the session is kept in `localStorage`. The session *is* the
 * cookie, which is `httpOnly` and so unreadable from here on purpose; this
 * holds only what the server said about it, and asks again on load.
 *
 * The context and the hook live in `session.ts` — see the note there.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>({ status: 'loading' })

  const refresh = useCallback(async () => {
    try {
      const { user } = await getJson<ApiSession>('/auth/me')
      setSession(user ? { status: 'signed-in', user } : { status: 'signed-out' })
    } catch (error) {
      // An unreachable API is not "signed out". Saying so would offer a sign-in
      // form that cannot possibly work, and the pages that render this state
      // say what is actually wrong instead.
      console.error(error)
      setSession({ status: 'error' })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const signOut = useCallback(async () => {
    try {
      await postJson('/auth/logout', {})
    } catch (error) {
      // The cookie is the session, and a logout that never reached the server
      // has not cleared it — so this cannot pretend to have worked. Re-reading
      // is what tells the truth either way.
      console.error(error)
    }

    await refresh()
  }, [refresh])

  const adopt = useCallback((user: ApiUser) => {
    setSession({ status: 'signed-in', user })
  }, [])

  return (
    <SessionContext value={{ session, refresh, signOut, adopt }}>
      {children}
    </SessionContext>
  )
}
