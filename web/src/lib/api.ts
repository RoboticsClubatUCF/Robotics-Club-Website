/**
 * Thin client for the content API.
 *
 * The API is a separate origin — it runs on :4000 and allows this one through
 * `CORS_ORIGINS` — so every request needs an absolute base URL. There is
 * deliberately no `/api` proxy in `vite.config.ts`; if that ever changes, this
 * is the only file that has to know.
 */

const baseUrl = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '')

/**
 * A failed request, carrying the status so a caller can tell the cases apart.
 *
 * `status` is `0` when the request never reached the server at all — there is no
 * HTTP status for "the API isn't running", and a form has to say something
 * different about that than about a 429.
 */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ApiError'
    this.status = status
  }
}

// `fetch` only rejects on a network-level failure, and in development that is
// nearly always the same thing: the API isn't running. Say so, because the
// alternative is a bare "Failed to fetch" in the console and a page of em
// dashes with no explanation. Starting the frontend alone is not enough — the
// API is a separate package and needs Postgres up before it.
const unreachable = (cause: unknown) =>
  new ApiError(
    0,
    `Could not reach the API at ${baseUrl}. Is it running? (\`npm run db:up && npm run dev\` in server/)`,
    { cause },
  )

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response

  try {
    response = await fetch(`${baseUrl}/api${path}`, { signal })
  } catch (cause) {
    if (signal?.aborted) throw cause
    throw unreachable(cause)
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      `GET ${path} failed: ${response.status} ${response.statusText}`,
    )
  }

  return (await response.json()) as T
}

/**
 * Send JSON to one of the public write endpoints.
 *
 * There is exactly one of those — `POST /api/contact` — and it is rate limited,
 * so the status matters to the caller: a 429 is "you did this too often" and
 * wants a different sentence from a 400, which is "the server disagreed with
 * the form".
 */
export async function postJson<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response

  try {
    response = await fetch(`${baseUrl}/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (cause) {
    if (signal?.aborted) throw cause
    throw unreachable(cause)
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      `POST ${path} failed: ${response.status} ${response.statusText}`,
    )
  }

  return (await response.json()) as T
}

/**
 * Response shapes.
 *
 * The server is a separate package and Prisma's generated types can't be
 * imported into browser code, so these are written by hand to mirror the
 * `select` blocks in `server/src/routes/content.ts`. Keep them in step with
 * those — nothing enforces it. Dates arrive as ISO strings, not `Date`.
 */

export type ApiStats = {
  projects: number
  members: number
  events: number
}

export type ProjectStatus = 'CONCEPT' | 'IN_PROGRESS' | 'COMPLETED' | 'ARCHIVED'

export type ApiProject = {
  id: string
  slug: string
  title: string
  summary: string | null
  season: string | null
  competition: string | null
  status: ProjectStatus
  coverUrl: string | null
  repoUrl: string | null
  featured: boolean
  startedAt: string | null
  completedAt: string | null
}

export type EventType =
  | 'MEETING'
  | 'COMPETITION'
  | 'OUTREACH'
  | 'WORKSHOP'
  | 'FUNDRAISER'
  | 'SOCIAL'

export type ApiEvent = {
  id: string
  slug: string
  title: string
  description: string | null
  type: EventType
  location: string | null
  /** ISO. Parse with `new Date(...)` and read it in the visitor's local zone. */
  startsAt: string
  endsAt: string | null
  /** When true the clock times are filler and only the dates mean anything. */
  allDay: boolean
  registrationUrl: string | null
}

/**
 * The sponsorship levels, highest first. Mirrors the `SponsorTier` enum in
 * `schema.prisma`, and — like that enum — the order here is the ranking.
 * The wire format is the enum name; the underscores come out for display.
 */
export type SponsorTier =
  | 'PROCESSOR_PATRON'
  | 'CIRCUIT_SUPPORTER'
  | 'BOLT_BACKER'
  | 'ALUMINUM_ALLY'

export type ApiSponsor = {
  id: string
  name: string
  tier: SponsorTier
  logoUrl: string | null
  websiteUrl: string | null
  blurb: string | null
}

/**
 * The eight seats on the officer board. Mirrors the `OfficerPosition` enum in
 * `schema.prisma`, and — like that enum — the order here is the display order.
 */
export type OfficerPosition =
  | 'PRESIDENT'
  | 'VICE_PRESIDENT'
  | 'TREASURER'
  | 'SECRETARY'
  | 'MARKETING'
  | 'OUTREACH'
  | 'LAB_MANAGER'
  | 'FACULTY_ADVISOR'

/**
 * A roster entry, as `rosterSelect` in `server/src/routes/content.ts` returns
 * it. `officerPosition` is null for everyone not on the board; `GET /api/officers`
 * returns only those where it isn't, but the type is shared with the roster.
 */
export type ApiMember = {
  id: string
  slug: string | null
  fullName: string
  role: string
  officerPosition: OfficerPosition | null
  title: string | null
  gradYear: number | null
  bio: string | null
  photoUrl: string | null
  active: boolean
  subteam: { slug: string; name: string; color: string | null } | null
}
