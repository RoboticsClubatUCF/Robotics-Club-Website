/**
 * Thin client for the content API.
 *
 * The API is a separate origin — it runs on :4000 and allows this one through
 * `CORS_ORIGINS` — so every request needs an absolute base URL. There is
 * deliberately no `/api` proxy in `vite.config.ts`; if that ever changes, this
 * is the only file that has to know.
 */

const baseUrl = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '')

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response

  try {
    response = await fetch(`${baseUrl}/api${path}`, { signal })
  } catch (cause) {
    // `fetch` only rejects on a network-level failure, and in development that
    // is nearly always the same thing: the API isn't running. Say so, because
    // the alternative is a bare "Failed to fetch" in the console and a page of
    // em dashes with no explanation. Starting the frontend alone is not enough
    // — the API is a separate package and needs Postgres up before it.
    if (signal?.aborted) throw cause
    throw new Error(
      `Could not reach the API at ${baseUrl}. Is it running? (\`npm run db:up && npm run dev\` in server/)`,
      { cause },
    )
  }

  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status} ${response.statusText}`)
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
