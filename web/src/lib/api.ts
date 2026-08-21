/**
 * Thin client for the content API.
 *
 * The API is a separate origin — it runs on :4000 and allows this one through
 * the server's `SITE_URL` — so every request needs an absolute base URL. There
 * is deliberately no `/api` proxy in `vite.config.ts`; if that ever changes,
 * this is the only file that has to know.
 */

/**
 * Where the API lives. Exported because `fetch` is not the only thing that has
 * to reach it: an `<img src>` or a download link pointing at `/api/files/<id>`
 * needs the same origin in front of it, and that address is root-relative — see
 * `storedFiles.ts`, which is where those are resolved.
 */
export const apiBaseUrl = (
  import.meta.env.VITE_API_URL ?? 'http://localhost:4000'
).replace(/\/+$/, '')

const baseUrl = apiBaseUrl

/**
 * An https page cannot call an http API, and the failure looks like nothing.
 *
 * The browser blocks the request as mixed content before it is sent: no CORS
 * error, no status, no server log — every `fetch` here rejects the same way it
 * would if the API were down, so the whole site renders its "couldn't reach the
 * server" states and the API looks broken from the outside.
 *
 * `VITE_API_URL` is baked in at build time, so this is a build that shipped
 * with the wrong value rather than anything to recover from at runtime. Say
 * which value, once, and let the states below do the rest.
 */
if (
  typeof location !== 'undefined' &&
  location.protocol === 'https:' &&
  baseUrl.startsWith('http://')
) {
  console.error(
    `This page is https but VITE_API_URL is ${baseUrl} — the browser will block every API call as mixed content. Rebuild with an https VITE_API_URL.`,
  )
}

/**
 * A failed request, carrying the status so a caller can tell the cases apart.
 *
 * `status` is `0` when the request never reached the server at all — there is no
 * HTTP status for "the API isn't running", and a form has to say something
 * different about that than about a 429.
 */
export class ApiError extends Error {
  readonly status: number

  /**
   * The sentence the server sent, when it sent one.
   *
   * Most failures are better explained by the caller — it knows what the person
   * was doing and the status is enough to say so. But signup has refusals only
   * the server can phrase: which of two unique fields was taken, whether a link
   * expired or was already spent. Those arrive as `{ error }` and are written to
   * be read, so the form shows them rather than inventing a paraphrase.
   *
   * Null when the body was not JSON, carried no `error` string, or was a
   * validation failure — those come back as a zod report, which is a debugging
   * aid and not something to put in front of anyone.
   */
  readonly detail: string | null

  constructor(
    status: number,
    message: string,
    options?: ErrorOptions & { detail?: string | null },
  ) {
    super(message, options)
    this.name = 'ApiError'
    this.status = status
    this.detail = options?.detail ?? null
  }
}

/**
 * Turn a failed response into an `ApiError`, reading the server's own sentence
 * out of it if there is one.
 *
 * The body can only be read once and this consumes it, which is fine — a failed
 * response has no payload any caller wants.
 */
async function failure(method: string, path: string, response: Response) {
  let detail: string | null = null

  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string') detail = body.error
  } catch {
    // Not JSON — a proxy's HTML error page, or an empty body. The status still
    // says everything the caller needs.
  }

  return new ApiError(
    response.status,
    `${method} ${path} failed: ${response.status} ${response.statusText}`,
    { detail },
  )
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

/**
 * The session cookie will not cross an origin without this.
 *
 * The API is on a different port, so every call here is cross-origin, and
 * `fetch` sends no cookies on one of those unless it is told to. Left off, the
 * failure is silent in both directions: the browser reports nothing, the server
 * sees an anonymous request, and signing in appears to work while every page
 * after it says nobody is signed in. It is set on the reads as well as the
 * writes because `/auth/me` and `/dues/status` are GETs.
 *
 * The server side of the same bargain is `credentials: true` on its CORS
 * middleware — both halves are required, and neither is any use alone.
 */
const withCredentials = { credentials: 'include' } as const

/**
 * @param fresh Bypass the browser's own HTTP cache for this one read.
 *
 * Needed in exactly one place, and it is not arbitrary. The public content
 * routes answer with `Cache-Control: public, max-age=…` — that is the point of
 * them — which means a read taken straight after a write can be served from the
 * browser's cache and show the *pre-write* copy for up to a minute. Everywhere
 * else that is correct and free; on the project page's editor it looks exactly
 * like the save silently failed.
 *
 * The alternative fixes are both worse: lowering the cache window makes the
 * whole public site pay for one page's editor, and `?t=${Date.now()}` defeats
 * caching for good rather than for one request — including the `immutable`
 * headers on `/api/files/:id`, which the gallery depends on.
 */
export async function getJson<T>(
  path: string,
  signal?: AbortSignal,
  fresh = false,
): Promise<T> {
  let response: Response

  try {
    response = await fetch(`${baseUrl}/api${path}`, {
      ...withCredentials,
      ...(fresh ? { cache: 'no-store' as const } : {}),
      signal,
    })
  } catch (cause) {
    if (signal?.aborted) throw cause
    throw unreachable(cause)
  }

  if (!response.ok) {
    throw await failure('GET', path, response)
  }

  return (await response.json()) as T
}

/**
 * The shared shape of every write. All of them are rate limited, so the status
 * matters to the caller: a 429 is "you did this too often" and wants a
 * different sentence from a 400, which is "the server disagreed with the form".
 * Where the server has something specific to say it comes back on
 * `ApiError.detail`.
 */
async function sendJson<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response

  try {
    response = await fetch(`${baseUrl}/api${path}`, {
      ...withCredentials,
      method,
      // A DELETE carries no body, and an empty JSON header on one confuses
      // nothing but is a lie about what was sent.
      ...(body === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
      signal,
    })
  } catch (cause) {
    if (signal?.aborted) throw cause
    throw unreachable(cause)
  }

  if (!response.ok) {
    throw await failure(method, path, response)
  }

  return (await response.json()) as T
}

export function postJson<T>(path: string, body: unknown, signal?: AbortSignal) {
  return sendJson<T>('POST', path, body, signal)
}

export function patchJson<T>(path: string, body: unknown, signal?: AbortSignal) {
  return sendJson<T>('PATCH', path, body, signal)
}

export function deleteJson<T>(path: string, signal?: AbortSignal) {
  return sendJson<T>('DELETE', path, undefined, signal)
}

/**
 * Send a form with a file in it.
 *
 * Deliberately no `Content-Type` header: a multipart body needs the boundary
 * string the browser generates, and setting the header by hand replaces the
 * whole value — boundary included — so the server would receive a body it
 * cannot split. Leaving it off lets `fetch` write the correct one.
 */
export async function postForm<T>(
  path: string,
  form: FormData,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response

  try {
    response = await fetch(`${baseUrl}/api${path}`, {
      ...withCredentials,
      method: 'POST',
      body: form,
      signal,
    })
  } catch (cause) {
    if (signal?.aborted) throw cause
    throw unreachable(cause)
  }

  if (!response.ok) {
    throw await failure('POST', path, response)
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
  /** The free-text label a lead types: "Spring 2026", "Season-long". It prints
      and it compares to nothing — the pair below is what decides. */
  season: string | null
  /**
   * The term this project is built for.
   *
   * A build that runs for years is one row per term, so this is what tells last
   * semester's rover from this semester's. `Season` is declared in calendar
   * order on the server, so `(termYear, termSeason)` sorts chronologically.
   */
  termYear: number
  termSeason: Season
  competition: string | null
  status: ProjectStatus
  coverUrl: string | null
  repoUrl: string | null
  featured: boolean
  startedAt: string | null
  completedAt: string | null
}

/**
 * One person on a project, as `GET /api/projects/:slug` lists them.
 *
 * Two `title`s at two levels, and they are different things: the outer one is
 * what this person is called *on this project* ("Software Lead"), the inner one
 * is their club title. Both are free text and neither grants anything.
 */
export type ApiProjectMember = {
  title: string | null
  user: {
    slug: string | null
    fullName: string
    photoUrl: string | null
    title: string | null
  }
}

/**
 * One picture in a project's gallery. `url` is either an external address
 * somebody typed or `/api/files/<id>` for an upload — the browser does not care
 * which, and the prefix is only ever read on the server, where deleting the
 * bytes is decided. `caption` doubles as the image's `alt` when set.
 */
export type ApiProjectImage = {
  id: string
  url: string
  caption: string | null
  /**
   * How the picture sits in the gallery's fixed frame — `object-position`
   * percentages plus a zoom multiplier, applied as CSS at display time and
   * never baked into the file. 50/50/1 is a plain centred crop. See
   * `lib/imageFraming.ts`.
   */
  focalX: number
  focalY: number
  zoom: number
}

/** A labelled link on a project's page — the design doc, the CAD, the rules. */
export type ApiProjectLink = {
  id: string
  label: string
  url: string
}

/**
 * The single-project answer: the list row plus the long form, the people, the
 * gallery and the resource links. The last two come back already in display
 * order, which is why neither carries a sort key.
 */
export type ApiProjectDetail = ApiProject & {
  description: string | null
  members: ApiProjectMember[]
  images: ApiProjectImage[]
  links: ApiProjectLink[]
}

/**
 * Somebody's project role, mirroring `ProjectMemberRank` in `schema.prisma`.
 *
 * This is the *only* thing that decides who can manage a project, and it means
 * nothing outside the membership row it sits on: the lead of one project is a
 * plain member on the next. `UserRole` says nothing about any project — it used
 * to carry `PROJECT_LEAD` and `TEAM_LEAD` as roster labels, spelled the same as
 * these and granting nothing, which is why the two are worth telling apart on
 * sight.
 */
export type ProjectMemberRank = 'PROJECT_LEAD' | 'TEAM_LEAD' | 'MEMBER'

/** A project as its members and leads see it: the public row plus the meeting
    schedule, mirroring `managedProjectSelect` in `server/src/routes/officer.ts`. */
export type ApiManagedProject = ApiProject & {
  /** 0 = Sunday … 6 = Saturday, matching `Date.getDay()`. */
  meetingWeekday: number | null
  /** Wall-clock "18:30", campus-local. */
  meetingTime: string | null
  meetingLocation: string | null
  /**
   * The Discord role this project's crew carries, or null. Setting it hands the
   * role to everybody on the project and clearing it takes it back, so the form
   * that edits this is editing people's Discord access rather than a label.
   */
  discordRoleId: string | null
}

/** One row of `GET /api/me/projects`: my standing on one project. `rank` is the
    permission, `title` the free-text display string beside it. */
export type ApiMyProject = {
  rank: ProjectMemberRank
  title: string | null
  team: { id: string; name: string } | null
  /**
   * Whether this project's term is the one we are in, decided by the server
   * against UCF's calendar rather than by comparing dates here.
   *
   * It sits beside `rank` rather than inside `project` because everything in
   * there is a stored column and this is a fact about the clock. The dashboard
   * shows only the current ones; `/dashboard/projects/past` shows the rest.
   */
  current: boolean
  project: ApiManagedProject
}

export type ApiTeam = {
  id: string
  name: string
  description: string | null
}

/** One person, as `GET /api/projects/:id/team` lists them. No email — this is
    the members' view, not the officer desk. */
export type ApiProjectTeamMember = {
  userId: string
  fullName: string
  photoUrl: string | null
  title: string | null
  rank: ProjectMemberRank
  teamId: string | null
}

export type ApiProjectTeamView = {
  project: ApiManagedProject
  teams: ApiTeam[]
  members: ApiProjectTeamMember[]
}

/**
 * A hit from the officer people-picker, `GET /api/officer/members`.
 *
 * Both contact fields are nullable and an account may carry either one alone —
 * the search matches on the name and on both of them, so a member with a
 * Discord handle and no email is findable and identifiable.
 */
export type ApiOfficerMember = {
  id: string
  fullName: string
  email: string | null
  discordUsername: string | null
  role: UserRole
  /** So the roles desk can say where somebody stands before granting them a
      term. Null for anybody who has never paid or been granted one. */
  duesPaidThrough: string | null
}

/**
 * Where a 3D print request has got to. `DONE` and `REJECTED` are terminal,
 * and terminal means the uploaded model has been deleted — the club does not
 * store files it no longer needs. What survives is this row: the name, the
 * size, and how it ended.
 */
export type PrintRequestStatus = 'PENDING' | 'PRINTING' | 'DONE' | 'REJECTED'

/** The two machines. Everything else about a request pairs off this. */
export type PrintProcess = 'FDM' | 'SLA'

/**
 * What the club stocks. The pairing is the rule and the server enforces it:
 * FDM takes `PLA` or `PETG`, SLA takes `ABS_LIKE_RESIN` and nothing else.
 */
export type PrintMaterial = 'PLA' | 'PETG' | 'ABS_LIKE_RESIN'

export type InfillPattern =
  | 'GRID'
  | 'GYROID'
  | 'LINES'
  | 'TRIANGLES'
  | 'CUBIC'
  | 'HONEYCOMB'
  | 'CONCENTRIC'

/** A print request as its owner sees it, from `GET /api/me/print-requests`. */
export type ApiPrintRequest = {
  id: string
  fileName: string
  fileSize: number
  /** How many of it to print. Its own field rather than a line in `notes`,
      because it is the one thing in there that changes the arithmetic. */
  quantity: number
  /** The special requests — colour, brims, "no supports on the face". What is
      left once the fields have taken everything they can say. */
  notes: string | null
  status: PrintRequestStatus
  /**
   * When an officer put it on a printer, or null if nobody ever did.
   *
   * The only thing that tells a **cancelled** print from a **declined**
   * request: both land on `REJECTED`, and they are different events. See
   * `actionPhrase` in `lib/printing.ts`.
   */
  startedAt: string | null
  officerNote: string | null
  /** Null once the job settles and the file is deleted — which is also how the
      page knows to stop offering the download. */
  fileId: string | null
  /** What was asked for. Both infill fields are null on a resin print, which
      has no infill at all. */
  process: PrintProcess
  material: PrintMaterial
  infillPattern: InfillPattern | null
  infillDensity: number | null
  /**
   * What actually came off the machine, when an officer said it differed —
   * they print in whatever is on the shelf. **Null means "as asked"**, so
   * every read is `printedX ?? askedX`; `actualSettings` in `lib/printing.ts`
   * is that in one place.
   */
  printedProcess: PrintProcess | null
  printedMaterial: PrintMaterial | null
  printedInfillPattern: InfillPattern | null
  printedInfillDensity: number | null
  /** Whole grams, written by the officer at settlement. Null until then. */
  gramsUsed: number | null
  /** The project it is for, or null for a personal print — and that null is
      the budget rule: personal prints come out of the allowance, project ones
      are uncapped. */
  project: { id: string; slug: string; title: string } | null
  createdAt: string
  updatedAt: string
}

/**
 * What a member has left to print with this term, from
 * `GET /api/me/print-allowance`.
 *
 * Never stored anywhere — the server counts it from finished personal prints
 * each time it is asked. `remainingGrams` **can be negative**: an officer may
 * knowingly print past somebody's allowance, and clamping it at zero would
 * hide exactly that.
 */
export type ApiPrintAllowance = {
  limitGrams: number
  usedGrams: number
  remainingGrams: number
  /** The term it belongs to, so a page can say when it resets. */
  term: ApiTerm
}

/** The same request on the officer queue, which also names who asked. */
export type ApiPrintQueueItem = ApiPrintRequest & {
  user: {
    fullName: string
    email: string | null
    discordUsername: string | null
  }
  /** The officer who last moved it — including whoever put it on the printer,
      not only whoever settled it. */
  decidedBy: { fullName: string } | null
  /** The requester's balance for this request's term, or null on a project
      print: those are uncapped, and a balance beside one would invite the
      officer to weigh it against a budget it does not come out of. */
  allowance: ApiPrintAllowance | null
}

/**
 * A loan's life. `APPROVED` and `CHECKED_OUT` both hold a unit — a thing set
 * aside for somebody who hasn't collected it is not available to anyone else,
 * which is the rule the availability count turns on.
 */
export type LoanStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'CHECKED_OUT'
  | 'RETURNED'
  | 'DENIED'
  | 'CANCELED'

/** One borrowable thing, with a live count of how many are free right now. */
export type ApiEquipment = {
  id: string
  name: string
  description: string | null
  quantity: number
  available: number
  /** The longest a member may ask to keep one, in whole days. */
  maxLoanDays: number
}

/** The same item on the officer desk, which also sees retired ones. */
export type ApiOfficerEquipment = ApiEquipment & {
  active: boolean
  out: number
  /** Loans ever made against it — what a delete would take with it. */
  loanCount: number
}

/** What a new item needs, mirroring `equipmentBody` in `routes/officer.ts`. */
export type NewEquipment = {
  name: string
  quantity: number
  maxLoanDays: number
  description: string | null
}

/** A loan as its borrower sees it, from `GET /api/me/loans`. */
export type ApiLoan = {
  id: string
  status: LoanStatus
  note: string | null
  officerNote: string | null
  /** The officer's deadline, and the one the return reminder hangs off. */
  dueAt: string | null
  /** Set only on a booking — null means they wanted it straight away. */
  startAt: string | null
  /** What the member said when they asked. `dueAt` is the answer to it. */
  requestedDueAt: string | null
  requestedAt: string
  decidedAt: string | null
  checkedOutAt: string | null
  returnedAt: string | null
  equipment: { id: string; name: string }
}

/** The same loan on the officer queue, which also names who has it. */
export type ApiOfficerLoan = ApiLoan & {
  user: {
    fullName: string
    email: string | null
    discordUsername: string | null
  }
  decidedBy: { fullName: string } | null
}

export type TaskStatus = 'OPEN' | 'DONE'

/** A task as the project board returns it, mirroring `taskSelect` + `wire()`
    in `server/src/routes/tasks.ts`. */
export type ApiTask = {
  id: string
  projectId: string
  teamId: string | null
  title: string
  details: string | null
  dueAt: string | null
  status: TaskStatus
  completedAt: string | null
  completedByName: string | null
  createdById: string | null
  assignees: { userId: string; fullName: string }[]
}

/** One row of `GET /api/me/tasks`: my open work, with where it belongs. */
export type ApiMyTask = {
  id: string
  title: string
  details: string | null
  dueAt: string | null
  status: TaskStatus
  project: { slug: string; title: string }
  team: { name: string } | null
}

/**
 * An event as `GET /api/me/events` returns it: the public shape plus the
 * ownership fields — which project and team it belongs to, and whether the
 * public site shows it. `published: false` here is normal, not a draft: it is
 * what every lead-created project event looks like.
 */
export type ApiMeEvent = ApiEvent & {
  published: boolean
  projectId: string | null
  teamId: string | null
  createdById: string | null
  project: { slug: string; title: string } | null
  team: { name: string } | null
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

/**
 * Signup, mirroring `server/src/routes/signup.ts`.
 *
 * Nothing about the account comes back from any of these. There is no session
 * to establish yet, and the two fields worth protecting — the address and the
 * password hash — are exactly the ones every other route is careful never to
 * return.
 */

export type ApiSignupStarted = {
  status: 'sent'
  email: string
  /** So the page can say how long the link is good for without hardcoding a
      number the server is free to change. */
  expiresInMinutes: number
}

/** Which address the link belongs to, for someone with several forwarded into
    one inbox. */
export type ApiSignupVerified = { email: string }

export type ApiSignupCreated = { id: string; status: 'created' }

/**
 * The answer about a Discord handle.
 *
 * Five states rather than a boolean, because they call for five different
 * things from the person filling the form. `not_found` sends them to the QR
 * code, `taken` does not; `unchecked` means the club has no bot configured and
 * nothing was asked; `unavailable` means Discord itself did not answer, which
 * is not evidence about the handle either way.
 */
export type ApiDiscordCheck =
  | { status: 'connected'; username: string; id: string }
  | { status: 'not_found' | 'taken' | 'unchecked' | 'unavailable' }

/**
 * Signing in, mirroring `server/src/routes/auth.ts`.
 *
 * `GET /api/auth/me` answers `{ user: null }` with a 200 rather than a 401 when
 * nobody is signed in — that is the ordinary state of the front page, not a
 * failure, and treating it as one puts a red line in the console on every load.
 */
/**
 * Somebody's standing in the *club*, mirroring `UserRole` in `schema.prisma`.
 *
 * Four values, and what this is for on the client is showing and hiding officer
 * navigation. It is never what grants access — every officer route re-checks it
 * server-side — and it says **nothing about any project**. Who runs which
 * project or team is `ProjectMemberRank`, above, on the membership rows.
 */
export type UserRole = 'ADMIN' | 'OFFICER' | 'MEMBER' | 'GUEST'

export type ApiUser = {
  id: string
  fullName: string
  email: string | null
  slug: string | null
  role: UserRole
  discordUsername: string | null
}

export type ApiSession = { user: ApiUser | null }

/**
 * Dues, mirroring `server/src/routes/dues.ts`.
 *
 * Every date here is an ISO string and every amount is in cents, because that
 * is the unit Stripe charges in and converting anywhere but the point of
 * display is where rounding bugs live.
 */

export type Season = 'SPRING' | 'SUMMER' | 'FALL'

export type DuesPlan = 'SEMESTER' | 'YEAR'

/**
 * A UCF term. `fromCalendar` is false when calendar.ucf.edu could not be read
 * and the server fell back to fixed dates — the page says so rather than
 * printing an approximate date as though it were the real one.
 */
export type ApiTerm = {
  year: number
  season: Season
  startsAt: string
  endsAt: string
  fromCalendar: boolean
}

/**
 * Where a member stands today.
 *
 * Four statuses rather than a boolean, because they call for four different
 * things on the page. `ACTIVE` is paid. `TRIAL` is inside the free fortnight at
 * the start of a term and about to not be — the one that needs a deadline in
 * front of it. `FREE` is summer or the gap between terms, where nobody owes
 * anything. `EXPIRED` is the only one that is a problem.
 */
/**
 * Mirrors `MembershipStatus` in `server/src/semester.ts`. Only `ACTIVE` is
 * access: `FREE` means the club is charging nobody *and this person has not
 * claimed it*, which is one press away from cover rather than cover itself.
 */
export type MembershipStatus = 'ACTIVE' | 'FREE' | 'EXPIRED'

export type ApiMembership = {
  status: MembershipStatus
  hasAccess: boolean
  duesRequired: boolean
  paidThrough: string | null
  /** When free access runs out. Null once dues are actually owed. */
  freeThrough: string | null
  term: ApiTerm
  /** The term a payment made now would buy — differs from `term` only in summer. */
  billable: ApiTerm
  /**
   * `ACTIVE` because a free window was claimed rather than because dues were
   * paid — so the panel can avoid telling somebody their dues are paid when
   * they have not paid anything.
   */
  freeActive: boolean
  /** A free window is running and this person has not claimed it yet. */
  canActivate: boolean
}

/** One purchasable plan, priced and dated by the server. Never by this code. */
export type ApiDuesPlan = {
  plan: DuesPlan
  amountCents: number
  /** Every term the plan covers: one for a semester, two for a year. */
  covers: ApiTerm[]
  through: string
}

export type ApiDuesPayment = {
  id: string
  plan: DuesPlan
  amountCents: number
  termYear: number
  termSeason: Season
  coversThrough: string
  paidAt: string | null
  /**
   * Stripe's hosted receipt page, or null if there is none to link to.
   *
   * This is the receipt, not a copy of one that was emailed. Stripe sends an
   * automatic email only in live mode and only when the account has
   * "Successful payments" switched on — never for a test payment — so the page
   * links to this rather than telling anybody to check their inbox. Stripe
   * expires these links after 30 days and offers to mail a fresh one.
   */
  receiptUrl: string | null
  /**
   * The officer who comped this term, and null for everything Stripe collected.
   *
   * A zero-amount row with nothing beside it reads as a bug in the price
   * column, so the name is what makes it a record instead.
   */
  grantedBy: string | null
}

export type ApiDuesStatus = {
  membership: ApiMembership
  plans: ApiDuesPlan[]
  /** False when the club has no Stripe keys configured yet. */
  paymentsEnabled: boolean
  history: ApiDuesPayment[]
}

export type ApiCheckout = {
  clientSecret: string
  paymentIntentId: string
  plan: DuesPlan
  amountCents: number
  covers: ApiTerm[]
  through: string
}

export type ApiDuesSync = {
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'REFUNDED'
  paidThrough: string | null
  receiptUrl: string | null
}
