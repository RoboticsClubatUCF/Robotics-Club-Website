import { useEffect, useState } from 'react'
import { ApiError, getJson } from './api'

/**
 * A discriminated union rather than `{ data, loading, error }`, so a component
 * can't read `data` without having handled the other two states first.
 *
 * `code` is the HTTP status of the failure, or `0` when the request never
 * reached the server. Most pages ignore it — "couldn't load" covers everything
 * — but a detail page for a slug that doesn't exist needs to say "no such
 * project" rather than implying the API is down.
 */
export type ApiState<T> =
  | { status: 'loading' }
  | { status: 'error'; code: number }
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
        setState({
          status: 'error',
          code: error instanceof ApiError ? error.status : 0,
        })
      })

    return () => {
      controller.abort()
    }
  }, [path])

  return state
}
