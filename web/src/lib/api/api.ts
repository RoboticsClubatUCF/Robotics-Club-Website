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
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
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

/**
 * For a write that sets a thing to a value rather than nudging one that exists.
 *
 * The one caller is the term override, which is an upsert keyed on the term: a
 * second press with the same dates has to leave the club in the same place as
 * the first, and `PUT` is the verb that says so. Hono's CORS defaults already
 * allow it.
 */
export function putJson<T>(path: string, body: unknown, signal?: AbortSignal) {
  return sendJson<T>('PUT', path, body, signal)
}

/**
 * `body` is optional and almost always left off — a DELETE names what it is
 * removing in its path.
 *
 * The one caller that passes one is deleting an *account*, which asks for the
 * password first. That cannot go in the path, where it would land in browser
 * history and in every access log between here and the server, and a query
 * string is the same mistake spelled differently.
 */
export function deleteJson<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
) {
  return sendJson<T>('DELETE', path, body, signal)
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
 * `select` blocks in `server/src/routes/public/content.ts`. Keep them in step with
 * those — nothing enforces it. Dates arrive as ISO strings, not `Date`.
 */

export type ApiStats = {
  projects: number
  members: number
  events: number
}

/**
 * One photograph in the landing page's slideshow, from `GET /api/hero-slides`.
 *
 * The same six fields as `ApiProjectImage`, and the same rules — `url` is either
 * an external address or `/api/files/<id>`, `caption` doubles as the `alt`, and
 * the three numbers are framing applied as CSS rather than baked into the file.
 * Two types rather than one alias because they are answered by different tables
 * and written from different desks; the day a field is added to one of them is
 * the day an alias would have been the wrong shape.
 *
 * **An empty list is a supported answer**, not an empty state to apologise for:
 * the hero draws its rings and the wireframe trace when nothing is here, which
 * is what the right half of it was before officers could put photographs there.
 */
export type ApiHeroSlide = {
  id: string
  url: string
  caption: string | null
  focalX: number
  focalY: number
  zoom: number
}

/**
 * Whether the lab is open, from `GET /api/lab`.
 *
 * `changedAt` is null when nobody has ever set it — a fresh database, or a club
 * that has not started using the button. That is **not** the same as "closed a
 * long time ago", and both pages that draw this say so differently: one has a
 * time to print and the other has nothing to say beyond the state.
 *
 * Deliberately no name on it. The club's Discord channel says who opened the
 * lab, because that is the room where somebody asks; an endpoint anybody can
 * read is a different thing, and the pages only need the state and the time.
 */
export type ApiLabStatus = {
  /**
   * **Already masked by the building's hours**, so this is the answer to act
   * on rather than the row. An officer who forgets to close up at midnight
   * does not leave a green sign on the front page all night.
   */
  open: boolean
  changedAt: string | null
  /**
   * Whether the building is open at all — 8am to 10pm, Orlando time.
   *
   * Sent rather than mirrored in `lib/`, which is the exception to how this
   * codebase usually handles a server rule. A mirror exists so a form does not
   * offer what the route will reject; this one is a question about a wall clock
   * in a specific timezone, the server answers it on every read, and a second
   * implementation in the browser would be a second timezone to get wrong.
   *
   * What it buys the pages is the difference between "nobody has opened it" and
   * "nobody can" — a switch that is off, and one that is disabled.
   */
  buildingOpen: boolean
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
   * `lib/media/imageFraming.ts`.
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
 * One document on a project's documentation page, mirroring `wireDocument` in
 * `server/src/routes/projects/projectManage.ts`.
 *
 * `fileId` rather than a URL, and that is the difference between this and every
 * image on the site. An image column holds either an upload of ours or an
 * address somebody typed, which is what `imageSrc` exists to sort out; a
 * document is always ours, so what comes back is an id and `storedFileUrl`
 * turns it into an address.
 */
export type ApiProjectDocument = {
  id: string
  title: string
  description: string | null
  /** The name frozen on at upload. Not read through the account — somebody who
      graduates and deletes theirs still wrote it. */
  authorName: string
  fileId: string
  /** What it was called on the uploader's machine, and what a download saves
      as. The extension is also how the page tells a PDF from a DOCX. */
  fileName: string
  fileSize: number
  /** When it was first published. Never moves. */
  uploadedAt: string
  /**
   * When its **file** was last replaced, which is not the same as when the row
   * was last touched — renaming a document deliberately leaves this alone. It
   * equals `uploadedAt` until the first revision, and that is how the page
   * knows whether there are two dates worth printing or one.
   */
  updatedAt: string
}

/**
 * The single-project answer: the list row plus the long form, the people, the
 * gallery, the resource links and the documentation. All of the lists come back
 * already in display order, which is why none of them carries a sort key.
 */
export type ApiProjectDetail = ApiProject & {
  description: string | null
  members: ApiProjectMember[]
  images: ApiProjectImage[]
  links: ApiProjectLink[]
  documents: ApiProjectDocument[]
}

/**
 * A listing row that asked for the write-up — `GET /api/projects?description=true`.
 *
 * Both heavy columns are opt-in on that route, on purpose: it answers up to a
 * hundred rows and most callers want neither. `/projects` is the caller that
 * does, and it prints the write-up because `summary` — the field the schema
 * calls the one-liner for cards — has never been filled in on any project the
 * club has created.
 */
export type ApiListedProject = ApiProject & { description: string | null }

/**
 * And one that asked for its gallery as well — `&images=true`, which only the
 * current-term half of `/projects` does, because it is the only list that draws
 * every picture it is sent.
 */
export type ApiCardProject = ApiListedProject & { images: ApiProjectImage[] }

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
    schedule, mirroring `managedProjectSelect` in `server/src/routes/officer/officer.ts`. */
export type ApiManagedProject = ApiProject & {
  /**
   * The days it meets — 0 = Sunday … 6 = Saturday, matching `Date.getDay()`.
   * Sorted and free of duplicates by the time it leaves the server. Empty means
   * no schedule, which is the only legal way for the two times below to be null.
   */
  meetingWeekdays: number[]
  /** Wall-clock "18:00" and "22:00", campus-local. Not moments — see
      `web/src/lib/events/meetings.ts` for why neither is ever put through `Date`. */
  meetingStartTime: string | null
  meetingEndTime: string | null
  meetingLocation: string | null
  /**
   * Whether the meetings reach the public calendar. An officer's switch, not a
   * lead's: the server refuses this field from anyone else.
   */
  meetingsPublic: boolean
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
/**
 * A seat on the board as the officer desk sees it, which is more than the
 * public one gets: who the term belongs to, and who opened it.
 *
 * `source` is the difference between a seat the Discord sync handed out and one
 * an officer gave by hand, and it matters to the desk because only the second
 * kind survives losing the Discord role.
 */
/** The roles desk's view: every seat there is, and who is in one. */
export type ApiOfficerDesk = {
  seats: OfficerPosition[]
  board: ApiBoardSeat[]
}

export type ApiBoardSeat = {
  id: string
  position: OfficerPosition | null
  startedAt: string
  source: 'DISCORD' | 'MANUAL'
  fullName: string
  user: {
    id: string
    fullName: string
    email: string | null
    role: UserRole
  } | null
  /** Only on the answer to a seat write, and only when `takeOver` displaced
      somebody: who was succeeded, so the page can say so. */
  succeeded?: string | null
}

/**
 * One term's dates and where they came from, as
 * `GET /api/officer/semesters/:year` returns it.
 *
 * `source` is the whole reason the desk is worth having: `fallback` means the
 * site is guessing from fixed dates in `semester.ts` because UCF's feed could
 * not be read, `calendar` means the feed answered, and `override` means the
 * club has said otherwise. Only the first is a problem, and until now there was
 * no way to see it and no way to fix it without a deploy.
 */
export type ApiSemesterTerm = {
  year: number
  season: Season
  startsAt: string
  endsAt: string
  source: 'override' | 'calendar' | 'fallback'
  /**
   * When the club puts every project on halt, and where that answer came from.
   *
   * **Null is "nobody has said", not "there is no finals week."** Nothing is
   * paused while it is null, and the desk prints that in words — a blank pair of
   * dates otherwise reads as a finals week of zero days rather than as a
   * question still outstanding. The server refuses to guess these; see
   * `Term.finalsStartAt` in `server/src/membership/semester.ts` for why.
   *
   * All three are null together.
   */
  finalsStartAt: string | null
  finalsEndAt: string | null
  finalsSource: 'override' | 'calendar' | null
  note: string | null
}

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

/** What a new item needs, mirroring `equipmentBody` in `routes/officer/officer.ts`. */
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

/**
 * Mirrors the `TaskStatus` enum in `schema.prisma`, **and the order here is the
 * order rows come back in** — Postgres sorts an enum by declaration order and
 * the server orders on it, so this list is not alphabetised and must not be.
 */
export type TaskStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'DELAYED'
  | 'DONE'
  | 'CANCELED'

/** The two labels that mean a task is settled: off the calendar, off the
    overview card, and never chased by the bot. */
export const SETTLED_TASK: readonly TaskStatus[] = ['DONE', 'CANCELED']

/**
 * A task, mirroring `taskSelect` + `wire()` in
 * `server/src/routes/projects/tasks.ts`.
 *
 * One type for both readers — the project board and `GET /api/me/tasks` —
 * because the server sends one shape. `project` is null for a task that belongs
 * to a person rather than to a build; only officers can write one of those.
 */
export type ApiTask = {
  id: string
  projectId: string | null
  teamId: string | null
  title: string
  details: string | null
  dueAt: string | null
  status: TaskStatus
  completedAt: string | null
  completedByName: string | null
  createdById: string | null
  createdAt: string
  project: { slug: string; title: string } | null
  team: { name: string } | null
  /** `onCalendar` is that person's own opt-in, not a property of the task. */
  assignees: { userId: string; fullName: string; onCalendar: boolean }[]
}

/**
 * `GET /api/me/tasks` answers the same shape the board does.
 *
 * Kept as a name rather than deleted, because the overview card and the tasks
 * page both read it and "my tasks" is what they are asking for.
 */
export type ApiMyTask = ApiTask

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

/**
 * A project's whole meeting series, carried on each of its occurrences.
 *
 * Mirrors `MeetingSeries` in `server/src/projects/meetings.ts`. It is here so the
 * add-to-calendar button can hand somebody the entire term in one press rather
 * than next Tuesday alone — a calendar app wants a rule and its exceptions, and
 * reconstructing those in the browser from a list of occurrences would be
 * guessing at what the server already worked out.
 */
export type ApiMeetingSeries = {
  projectSlug: string
  projectTitle: string
  /** 0-6, Sunday first, sorted. */
  weekdays: number[]
  /** Campus wall-clock, "18:00". */
  startTime: string
  endTime: string
  location: string | null
  /** The last day the series runs: the end of the project's term, as ISO. */
  untilDate: string
  /** Finals week, which the series skips, or null when nobody has set one. */
  skip: { from: string; to: string } | null
  /**
   * The exact occurrences finals week eats, as ISO instants — one `EXDATE` line
   * each in the .ics. Worked out by the server so the halt has one
   * implementation; see `MeetingSeries` in `server/src/projects/meetings.ts`.
   */
  skipDates: string[]
}

export type ApiEvent = {
  id: string
  slug: string
  title: string
  description: string | null
  /**
   * `'TASK'` is **not** a value of the `EventType` enum in Postgres and must
   * not become one. No stored row can carry it: it is only ever set on a task
   * deadline projected onto the member's own calendar by `/api/me/events`, and
   * the public route validates `?type=` against the real enum, so asking for it
   * there is a 400 rather than an empty list.
   */
  type: EventType | 'TASK'
  location: string | null
  /** ISO. Parse with `new Date(...)` and read it in the visitor's local zone. */
  startsAt: string
  endsAt: string | null
  /** When true the clock times are filler and only the dates mean anything. */
  allDay: boolean
  registrationUrl: string | null
  /**
   * Set only on a project meeting, which is a *generated* row rather than one
   * the server stores — its `id` is `meeting:…` and nothing may edit or delete
   * it. Absent on every stored `Event`.
   */
  meeting?: ApiMeetingSeries | null
  /**
   * Set only on a task deadline, the calendar's other generated entry — its
   * `id` is `task:…`, there is no row behind it to edit, and it reaches only
   * the calendar of the assignee who asked for it. Absent on everything else.
   */
  task?: { id: string; status: TaskStatus } | null
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
 * The same sponsor as the officer desk sees it — `active` and nothing else new.
 *
 * That one column is the whole difference between the two lists: the public read
 * filters on it and the desk's does not, because a hidden sponsor that vanished
 * from the desk as well would be a row nobody could ever bring back.
 */
export type ApiManagedSponsor = ApiSponsor & {
  active: boolean
  /** ISO. Printed on the desk so two rows for the same company can be told
      apart by which one somebody added this week. */
  createdAt: string
}

/**
 * What a tier costs and what the club gives back, as
 * `GET /api/sponsorship` answers it.
 *
 * **A tier with no offer is absent from that response**, not present and empty.
 * This copy was four hardcoded objects marked PLACEHOLDER until officers got a
 * desk for it, and an unwritten tier being missing rather than defaulted is the
 * point of the move — nothing on that page is a figure the club did not agree to.
 */
export type ApiTierOffer = {
  tier: SponsorTier
  /** Free text, not cents: "$5,000+", "UP TO $3,000", "In kind, by arrangement". */
  amount: string
  /**
   * Null on most of them, and that is the club's own sheet rather than an
   * omission: an amount over a list of what you get, with no sentence between.
   */
  blurb: string | null
  /** In print order. May be empty — an amount alone is a real offer. */
  benefits: string[]
}

/** A way to help that is not money, in the order the officers put them in. */
export type ApiInKindOffer = {
  id: string
  title: string
  blurb: string
}

/** The pitch half of `/sponsors`, in one read. */
export type ApiSponsorship = {
  tiers: ApiTierOffer[]
  inKind: ApiInKindOffer[]
  /**
   * The fine print under the tier grid — what a `*` on a benefit means, and the
   * club's note about the sponsorship being tax-deductible. One block of text
   * with its newlines meaningful; null when nobody has written any, which is
   * what the grid drew before it existed.
   */
  footnotes: string | null
}

/**
 * Everything the sponsor desk draws, in one read.
 *
 * `tiers` carries **one entry per level whether or not anybody has written it**,
 * because an unpublished tier is exactly the row an officer needs to see in
 * order to publish it. How many levels there are comes from the server for the
 * reason `ApiOfficerBoard.seats` does: it is the enum's answer, not the
 * frontend's, so a fifth tier added to the schema draws a fifth row here with
 * nothing edited in `web/`.
 */
export type ApiSponsorDesk = {
  sponsors: ApiManagedSponsor[]
  tiers: { tier: SponsorTier; offer: ApiTierOffer | null }[]
  inKind: ApiInKindOffer[]
  footnotes: string | null
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
 * A club subteam, as `GET /api/subteams` answers it.
 *
 * The standing groups somebody belongs to all year — mechanical, software,
 * electrical — which are deliberately a different thing from a project's
 * `ApiTeam`: this one says what a member *does*, that one says which
 * build they turn up to. A member has at most one, and `null` is a real state.
 *
 * `memberCount` counts the active roster only, so it agrees with what
 * `/members?subteam=…` actually returns rather than with the table.
 */
export type ApiSubteam = {
  id: string
  slug: string
  name: string
  description: string | null
  /** A hex literal out of the database. It is data, not a theme token — the
      one legitimate reason a component writes a colour into a `style`. */
  color: string | null
  memberCount: number
}

/**
 * A roster entry, as `rosterSelect` in `server/src/routes/public/content.ts` returns
 * it. It says nothing about the officer board any more: who sits on it is an
 * `ApiOfficerTerm` below, a different table entirely.
 */
export type ApiMember = {
  id: string
  slug: string | null
  fullName: string
  role: string
  title: string | null
  gradYear: number | null
  bio: string | null
  photoUrl: string | null
  active: boolean
  /**
   * Whether the club's Discord **Officer Alumni** role says this person used to
   * run it. What `?status=alumni` selects on and what the card's badge is drawn
   * from.
   *
   * **Not `active`, which is the field above and a different fact.** `active`
   * is "still around" and is set back to true by every dues payment, so it can
   * never be made to mean this; somebody can be both. The server's
   * `rosterStatus` in `routes/public/content.ts` has the full argument.
   */
  officerAlumnus: boolean
  subteam: { slug: string; name: string; color: string | null } | null
}

/**
 * A tenure on the officer board, as both `GET /api/officers` and
 * `GET /api/officers/past` return it — they are one table split on `endedAt`,
 * so they answer with one shape and the page decides what to do with it.
 *
 * **`endedAt` null is what "currently on the board" means.** Deliberately not
 * `role`: `UserRole` has one slot per person with `ADMIN` above `OFFICER`, so
 * it cannot say "an admin who is also an officer" — and a club always has one.
 *
 * `position` is null for somebody who holds no named seat, which is a real
 * state: Discord decides *that* somebody is an officer and the roles desk
 * decides *which chair*, so there is a gap between the two.
 *
 * `photoUrl` has already been resolved server-side against the linked roster
 * entry, so the page has one field to draw rather than a fallback to work out.
 * Dates are ISO strings; `academicYear` in `lib/officerTerms.ts` turns them into
 * the heading the archive groups by.
 */
export type ApiOfficerTerm = {
  id: string
  position: OfficerPosition | null
  startedAt: string
  endedAt: string | null
  fullName: string
  photoUrl: string | null
}

/**
 * Today's board, as `GET /api/officers` answers it.
 *
 * **`officers` is one entry per sitting officer, not one per seat**, so the
 * page draws as many cards as the club has officers. `seats` is every seat
 * there is, in board order, from the `OfficerPosition` enum — sent so the page
 * can also show the chairs nobody is in without holding a list of its own.
 * Neither number is decided in the frontend any more.
 */
export type ApiOfficerBoard = {
  seats: OfficerPosition[]
  officers: ApiOfficerTerm[]
}

/**
 * The archive, as `GET /api/officers/past` answers it.
 *
 * A window rather than the whole thing: two academic years by default, because
 * a fifty-year club is a few hundred rows and every one carries a headshot the
 * page then asks for. `older` is how many terms fall outside it — a count
 * rather than the rows, because the answer it feeds is a button.
 */
export type ApiOfficerArchive = {
  terms: ApiOfficerTerm[]
  older: number
  /** The seats this window used, in board order — the chip row, from the data
      rather than from a list the page keeps. */
  seats: OfficerPosition[]
}

/**
 * Whether this visitor may still write to the club, from `GET /api/contact`.
 *
 * Mirrors `server/src/routes/public/forms.ts`, and it is the one read on the site whose
 * answer is about the caller rather than the club — so it is never cached, and
 * a stale one would be wrong in the direction that costs somebody the message
 * they typed.
 *
 * `message` is the server's own sentence for a refusal and null when there is
 * nothing to refuse. Carried rather than written here for the same reason the
 * dues refusals are: the number is the route's to change.
 */
export type ApiContactSent = {
  id: string
  status: 'received'
  /** How many are left after this one — what takes the form off the page when
      it reaches zero, without the browser keeping its own tally. */
  remaining: number
}

export type ApiContactAvailability = {
  allowed: boolean
  remaining: number
  /** Seconds until the daily window closes. Zero when none is open. */
  retryAfter: number
  message: string | null
}

/**
 * Signup, mirroring `server/src/routes/account/signup.ts`.
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
 * Signing in, mirroring `server/src/routes/account/auth.ts`.
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
  /**
   * Their profile photo, or null. On the session rather than only on the
   * account read because the nav bar and the dashboard rail both draw an
   * `Avatar` from `session.user` and have nothing else to go on.
   *
   * Either an upload's `/api/files/<id>` or an external address, so it goes
   * through `imageSrc` like every other image column — see `storedFiles.ts`.
   */
  photoUrl: string | null
  /**
   * How that photo sits inside the avatar's square, mirroring the three columns
   * on `User`. The same meaning as `ApiProjectImage`'s, but chosen against a
   * **square** frame rather than the gallery's 16:10 — the two are not
   * interchangeable, and a photo framed for one is framed wrongly in the other.
   *
   * On the session because the avatar is drawn wherever the session reaches,
   * and one drawn without these is a plain centred crop — which is the first
   * thing somebody who has just framed their photo would notice.
   */
  photoFocalX: number
  photoFocalY: number
  photoZoom: number
}

export type ApiSession = { user: ApiUser | null }

/**
 * The account as its owner manages it, from `GET /api/account` — mirroring
 * `profileSelect` in `server/src/routes/account/account.ts`.
 *
 * A superset of `ApiUser` with the two fields nothing else on the site needs.
 * `bio` and `gradYear` are deliberately *not* on the session: they are the
 * profile page's business, and putting them there would mean every page load
 * carrying a paragraph the nav has no use for.
 */
export type ApiAccount = ApiUser & {
  bio: string | null
  gradYear: number | null
  /** When the member agreement was accepted, or null for every roster entry
      that predates the signup form. */
  acknowledgementAcceptedAt: string | null
  /**
   * Whether there is a password to change, rather than the hash. False for a
   * roster entry an officer created by hand — the page then offers to *set*
   * one rather than asking for a current one that does not exist.
   */
  passwordSet: boolean
  /** An address waiting on its confirmation link, or null. Without it the page
      has nothing to show between asking and following the link. */
  pendingEmail: string | null
}

/** What every account write answers with, so the page can adopt it straight
    into the session rather than making a second round trip. */
export type ApiAccountUser = { user: ApiUser }

/** `POST /api/account/email` — the link is out and nothing has moved yet. */
export type ApiEmailChangeStarted = {
  status: 'sent'
  email: string
  expiresInMinutes: number
}

/**
 * `POST /api/auth/password/forgot` — 202 whatever it found.
 *
 * The message is the server's, and it is phrased about what *would* happen
 * rather than what did: an answer that differed for an unknown address would
 * turn the form into a way to ask whether somebody is a member.
 */
export type ApiPasswordResetSent = { status: 'sent'; message: string }

/**
 * Dues, mirroring `server/src/routes/member/dues.ts`.
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
  /**
   * False only when the dates are the server's fixed fallbacks. **True for a
   * term the club has set by hand on the semesters desk**, deliberately: the
   * sweeps stand down on fallback dates because a guess must not cost anybody
   * their membership, and a date an officer typed is the opposite of a guess.
   *
   * The server also sends `overridden` and `overrideNote` beside this, saying
   * which of the three sources answered. Nothing on the dues pages reads them —
   * `ApiSemesterTerm` is where that distinction is typed, for the one desk that
   * shows it — so they are deliberately not mirrored here.
   */
  fromCalendar: boolean
}

/**
 * Where a member stands today.
 *
 * Four statuses rather than a boolean, because they call for four different
 * things on the page. `ACTIVE` is paid. `TRIAL` is inside the free weeks at
 * the start of a term and about to not be — the one that needs a deadline in
 * front of it. `FREE` is summer or the gap between terms, where nobody owes
 * anything. `EXPIRED` is the only one that is a problem.
 */
/**
 * Mirrors `MembershipStatus` in `server/src/membership/semester.ts`. Only `ACTIVE` is
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
  /**
   * The one-time member survey has not been answered, so nothing is open —
   * including the dues page itself.
   *
   * **Not a fact about dues**, and it rides on this object anyway. `accessLock`
   * in `lib/dues/dues.ts` is the single place the browser decides what is locked,
   * and this is what that function already reads; putting the flag anywhere
   * else would mean a second fetch and a changed signature at thirteen call
   * sites. Mirrors `requireSurvey` in `server/src/auth/authz.ts`, `ADMIN` exemption
   * included — an admin always reads false here.
   */
  surveyRequired: boolean
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

/**
 * The member survey, mirroring `routes/member/survey.ts` and the tables in
 * `schema.prisma`.
 *
 * **What the survey asks is data, not types.** It used to be five string unions
 * here and five Postgres enums there, and the club could not add a question
 * without a migration and a deploy. Officers write the questions now, so the
 * only fixed thing left is the *shape* of one — which is what `kind` names.
 */
export type SurveyQuestionKind =
  | 'SHORT_TEXT'
  | 'LONG_TEXT'
  | 'SINGLE_CHOICE'
  | 'MULTI_CHOICE'

export type ApiSurveyOption = {
  id: string
  label: string
  /** "Other": picking it asks for a line in the question's text box. */
  wantsText: boolean
  /**
   * An option the club has stopped offering that this member picked before it
   * went. It is on the form for them and for nobody else — a write replaces
   * every answer, so an option the form could not draw would be dropped on the
   * way past. See `questionsFor` in `server/src/routes/member/survey.ts`.
   */
  retired: boolean
}

export type ApiSurveyQuestion = {
  id: string
  /** The question, in the club's words. Drawn as the field's label. */
  prompt: string
  /** The smaller line under it, which is where the *reason* goes. */
  help: string | null
  kind: SurveyQuestionKind
  required: boolean
  /**
   * `MULTI_CHOICE` only: the form offers a NONE box, and an empty set of ticks
   * is what pressing it stores. **There is no NONE option** — the reasoning is
   * on `SurveyQuestion.allowNone` in `schema.prisma`, and `answered()` in
   * `lib/survey.ts` is the half of it this side owns.
   */
  allowNone: boolean
  /** Already resolved to a number by the server, so the input's cap and the
      route's cap are the same one. */
  maxLength: number
  options: ApiSurveyOption[]
}

/**
 * One answer. Uniform across all four kinds — a set of ticks and a line of text
 * — because which of the two a question uses is the question's business.
 *
 * **The answer existing is what "answered" means.** A tick-any question with a
 * NONE box is answered by an *empty* `optionIds`, so there is nothing in the
 * answer itself that could tell it from a question somebody scrolled past.
 */
export type ApiSurveyAnswer = {
  questionId: string
  optionIds: string[]
  text: string | null
}

export type ApiSurvey = {
  /** When it was first answered. Never moves, even when the answers change. */
  submittedAt: string
  updatedAt: string
  answers: ApiSurveyAnswer[]
}

/**
 * `GET /api/survey`, and — minus the questions — what both writes answer with.
 *
 * `gradYear` sits beside the answers rather than among them because it is
 * `User.gradYear` — the same column the profile page edits and the public
 * roster prints. The survey asks for it and writes it there rather than keeping
 * a second copy, so the form pre-fills from this.
 */
export type ApiSurveyState = {
  questions: ApiSurveyQuestion[]
  survey: ApiSurvey | null
  gradYear: number | null
}

/** `GET /api/officer/survey` — what the club learned, as counts. */
export type ApiSurveySummary = {
  responded: number
  /** Active members who still owe one. Guests and admins are not counted. */
  outstanding: number
  questions: ApiSurveyQuestionTally[]
  /** Sparse and ascending: the years members actually typed, and nothing else. */
  gradYears: { value: number; count: number }[]
}

export type ApiSurveyQuestionTally = {
  id: string
  prompt: string
  kind: SurveyQuestionKind
  /** How many of the people who answered the survey answered this question. */
  answered: number
  /** How many pressed NONE, or null where there is no NONE to press. */
  none: number | null
  /** Every live option including the zeroes, plus any retired one people
      picked — a column that drops those does not add up to `answered`. */
  options: { id: string; label: string; archived: boolean; count: number }[]
}

/**
 * `GET /api/officer/survey/questions` — the same questions, as their editor
 * sees them: the removed ones included, and with the counts that decide what
 * REMOVE is going to do.
 */
export type ApiSurveyEditorOption = {
  id: string
  label: string
  wantsText: boolean
  archived: boolean
  /** How many members picked it, which is why removing it retires it. */
  picked: number
}

export type ApiSurveyEditorQuestion = {
  id: string
  prompt: string
  help: string | null
  kind: SurveyQuestionKind
  required: boolean
  allowNone: boolean
  /** Null where the officer never set one; the server applies its own. */
  maxLength: number | null
  position: number
  archived: boolean
  answered: number
  options: ApiSurveyEditorOption[]
}
