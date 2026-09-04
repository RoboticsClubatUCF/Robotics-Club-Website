import { vi } from 'vitest'

/**
 * Replace `fetch` for one test.
 *
 * Tests here never touch the network — that would make them depend on a running API and a seeded
 * database, and they exist precisely to check what the page does when those are not cooperating.
 * `useApi` calls `fetch` exactly once per path, so a map from path fragment to response is enough.
 */
/**
 * `fetch` accepts a string, a URL or a Request, and only the first two survive
 * `String()` — a Request stringifies to "[object Request]" and would match no
 * route at all.
 */
export function urlOf(input: string | URL | Request): string {
  return input instanceof Request ? input.url : input.toString()
}

/**
 * Every stub takes `init` even when it ignores it. Declaring only the first parameter would type
 * `mock.calls` as a one-element tuple, and a test wanting to assert on the method or body of a POST
 * could then only get at it through a cast.
 */
export function stubFetch(routes: Record<string, unknown>) {
  return vi.fn((input: string | URL | Request, _init?: RequestInit) => {
    const url = urlOf(input)
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

/**
 * A `fetch` that answers everything with one status.
 *
 * For the write endpoint, where the status is the message: a 429 and a 400 have
 * to reach the sender as different sentences, and the only way to tell them
 * apart is the number.
 */
export function stubFetchStatus(status: number, body: unknown = {}) {
  return vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
}

/** A `fetch` that fails the way an unreachable API does. */
export function stubFetchNetworkError() {
  return vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
    Promise.reject(new TypeError('Failed to fetch')),
  )
}

/** A `fetch` that never settles, so the loading state stays put. */
export function stubFetchPending() {
  return vi.fn(
    (_input: string | URL | Request, _init?: RequestInit) => new Promise<Response>(() => {}),
  )
}

/** The JSON a stubbed call was given, for asserting on what a form sent. */
export function bodyOf(init?: RequestInit): unknown {
  return typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
}
