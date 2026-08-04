import { useEffect, useState } from 'react'
import { getJson } from './api'

/**
 * A discriminated union rather than `{ data, loading, error }`, so a component
 * can't read `data` without having handled the other two states first.
 */
export type ApiState<T> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: T }

/**
 * Fetch a content endpoint on mount.
 *
 * No cache and no request dedupe: the landing page makes two calls, both are
 * GETs the server marks publicly cacheable, and the browser handles the rest.
 * If a page ever needs the same endpoint in two places, reach for a real
 * fetching library rather than growing this one.
 */
export function useApi<T>(path: string): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({ status: 'loading' })

  useEffect(() => {
    // Aborting on cleanup is what makes StrictMode's double-invoke in
    // development harmless, and stops a slow response from landing after the
    // component is gone.
    const controller = new AbortController()
    setState({ status: 'loading' })

    getJson<T>(path, controller.signal)
      .then((data) => {
        setState({ status: 'ready', data })
      })
      .catch((error: unknown) => {
        // An abort is this effect being cleaned up, not a failure.
        if (controller.signal.aborted) return
        console.error(error)
        setState({ status: 'error' })
      })

    return () => {
      controller.abort()
    }
  }, [path])

  return state
}
