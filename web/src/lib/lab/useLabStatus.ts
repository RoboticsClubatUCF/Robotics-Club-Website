import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, getJson } from '../api/api'
import type { ApiLabStatus } from '../api/api'
import type { ApiState } from '../api/useApi'

/**
 * Is the lab open — kept up to date while the page is open.
 *
 * The one endpoint on this site whose answer changes without the reader doing anything. Everything
 * else here is fetched on mount and is still true ten minutes later; this one flips when an officer
 * presses something, and increasingly that press happens in Discord rather than on the site. A page
 * that only asked on mount would sit saying CLOSED while the channel had said OPEN for twenty
 * minutes — somebody walking across campus on a stale sign, which is the failure the whole feature
 * exists to prevent.
 *
 * So it polls rather than pushing. A websocket or SSE would hold a connection open per reader, on
 * every instance, to deliver one boolean a few times a day — a great deal of machinery and a new
 * failure mode for something a `GET` of one indexed row already answers, and the API has no other
 * reason to push anything.
 *
 * Thirty seconds, which is what the endpoint already promises: `GET /api/lab` sets `max-age=30`
 * precisely because a five-minute-old answer is the one that costs somebody the walk (see
 * `routes/public/lab.ts`), and polling faster only asks for what the browser would serve from its
 * own cache. Nothing at all while the tab is hidden, and an immediate re-ask when it comes back —
 * that is where the useful freshness is, and a laptop left open on a lab bench for six hours should
 * not spend it asking.
 *
 * A failed poll keeps the last good answer. A failure must never invent a state — the landing page
 * draws nothing rather than CLOSED, because CLOSED is the direction that sends somebody to a locked
 * door — and the mirror of that is that one flaky request must not throw away an answer the server
 * gave thirty seconds ago. Only the first load can land in `error`.
 */

/** Matches `s-maxage=30` on the route. See the note above. */
const POLL_MS = 30_000

export interface LabStatus {
  state: ApiState<ApiLabStatus>
  /** Ask again now. The dashboard's switch uses it after a flip that failed, to
      find out what the lab actually ended up as. */
  refresh: () => void
  /** Adopt an answer the caller already has, without a round trip. `PATCH
      /api/lab` replies with the state it wrote, and a refetch after it would
      only be a flicker between the press and the same answer arriving again. */
  adopt: (data: ApiLabStatus) => void
}

export function useLabStatus(): LabStatus {
  const [state, setState] = useState<ApiState<ApiLabStatus>>({
    status: 'loading',
  })

  // Read inside the fetch rather than closed over, so `load` never has to be
  // rebuilt and the polling effect never has to tear itself down and restart.
  const ready = useRef(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await getJson<ApiLabStatus>('/lab', signal)
      ready.current = true
      setState({ status: 'ready', data })
    } catch (error) {
      if (signal?.aborted) return
      console.error(error)
      // See the note above: a poll that fails leaves the last good answer where
      // it is. Only a first load has nothing to keep.
      if (ready.current) return
      setState({
        status: 'error',
        code: error instanceof ApiError ? error.status : 0,
      })
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setInterval> | null = null

    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }

    const start = () => {
      stop()
      timer = setInterval(() => void load(controller.signal), POLL_MS)
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stop()
        return
      }

      // Back on screen: ask straight away rather than waiting out the rest of
      // an interval, then resume. This is the refresh that matters.
      void load(controller.signal)
      start()
    }

    void load(controller.signal)
    if (document.visibilityState === 'visible') start()

    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      controller.abort()
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load])

  const refresh = useCallback(() => void load(), [load])

  const adopt = useCallback((data: ApiLabStatus) => {
    ready.current = true
    setState({ status: 'ready', data })
  }, [])

  return { state, refresh, adopt }
}
