import { vi } from 'vitest'

/**
 * Replace `fetch` for one test.
 *
 * Tests here never touch the network — that would make them depend on a running
 * API and a seeded database, and they exist precisely to check what the page
 * does when those aren't cooperating. `useApi` calls `fetch` exactly once per
 * path, so a map from path fragment to response is enough.
 */
export function stubFetch(routes: Record<string, unknown>) {
  return vi.fn((input: string | URL | Request) => {
    const url = String(input)
    const match = Object.keys(routes).find((path) => url.includes(path))

    if (!match) {
      return Promise.reject(new Error(`no stub for ${url}`))
    }

    return Promise.resolve(
      new Response(JSON.stringify(routes[match]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
}

/** A `fetch` that fails the way an unreachable API does. */
export function stubFetchNetworkError() {
  return vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
}

/** A `fetch` that never settles, so the loading state stays put. */
export function stubFetchPending() {
  return vi.fn(() => new Promise<Response>(() => {}))
}
