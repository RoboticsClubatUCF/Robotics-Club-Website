/**
 * Thin client for the content API.
 *
 * The API is a separate origin, so every request needs an absolute base URL.
 * There's deliberately no `/api` proxy in `vite.config.ts`; if that changes,
 * this is the only file that has to know.
 */

/**
 * Where the API lives. Exported because `<img src>` and download links pointing
 * at `/api/files/<id>` need the same origin in front of them — see `storedFiles.ts`.
 */
export const apiBaseUrl = (
  import.meta.env.VITE_API_URL ?? 'http://localhost:4000'
).replace(/\/+$/, '')

const baseUrl = apiBaseUrl

/**
 * An https page can't call an http API, and the failure looks like nothing: the
 * browser blocks it as mixed content before it is sent, so every fetch here
 * rejects exactly as it would if the API were down. `VITE_API_URL` is baked in
 * at build time, so say which value once and let the error states do the rest.
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
 * `status` is 0 when the request never reached the server — a form has to say
 * something different about that than about a 429.
 */
export class ApiError extends Error {
  readonly status: number

  /**
   * The sentence the server sent, when it sent one. Signup has refusals only the
   * server can phrase — which unique field was taken, whether a link expired — so
   * the form shows these rather than paraphrasing.
   *
   * Null when the body wasn't JSON or was a zod report; that's a debugging aid,
   * not something to put in front of anyone.
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
 * out of it if there is one. This consumes the body, which is fine.
 */
async function failure(method: string, path: string, response: Response) {
  let detail: string | null = null

  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string') detail = body.error
  } catch {
    // Not JSON — a proxy's error page, or an empty body. The status is enough.
  }

  return new ApiError(
    response.status,
    `${method} ${path} failed: ${response.status} ${response.statusText}`,
    { detail },
  )
}

// `fetch` only rejects on a network failure, and in development that's nearly
// always the API not running. Say so; the alternative is a bare "Failed to
// fetch". Starting the frontend alone isn't enough — the API is a separate
// package and needs Postgres up first.
const unreachable = (cause: unknown) =>
  new ApiError(
    0,
    `Could not reach the API at ${baseUrl}. Is it running? (\`npm run db:up && npm run dev\` in server/)`,
    { cause },
  )

/**
 * The session cookie won't cross an origin without this. Left off, the failure
 * is silent both ways: signing in appears to work and every page after it says
 * nobody is signed in. On the reads too — `/auth/me` and `/dues/status` are GETs.
 *
 * The server half is `credentials: true` on its CORS middleware. Neither is any
 * use alone.
 */
const withCredentials = { credentials: 'include' } as const

/**
 * @param fresh Bypass the browser's HTTP cache for this one read.
 *
 * The public content routes answer with `Cache-Control: max-age=…`, so a read
 * taken straight after a write can be served the pre-write copy for up to a
 * minute. On the project editor that looks exactly like the save failed.
 *
 * `reload` rather than `no-store`: both skip the cache on the way out, but only
 * `reload` writes what comes back into it. With `no-store` the stale entry
 * survives, so the page is right and the cache behind it is still wrong.
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
      ...(fresh ? { cache: 'reload' as const } : {}),
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
 * The shared shape of every write. All are rate limited, so the status matters
 * to the caller: a 429 wants a different sentence from a 400. Anything specific
 * the server has to say comes back on `ApiError.detail`.
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
      // A DELETE carries no body, so don't claim it sends JSON.
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
 * The one caller is the term override, an upsert keyed on the term: a second
 * press with the same dates has to land in the same place as the first.
 */
export function putJson<T>(path: string, body: unknown, signal?: AbortSignal) {
  return sendJson<T>('PUT', path, body, signal)
}

/**
 * `body` is optional and almost always left off — a DELETE names what it is
 * removing in its path.
 *
 * The exception is deleting an account, which asks for the password first. That
 * can't go in the path, where it would land in browser history and in every
 * access log on the way.
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
 * No `Content-Type` header on purpose: a multipart body needs the boundary the
 * browser generates, and setting the header by hand replaces the whole value,
 * so the server gets a body it can't split.
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
 * The server is a separate package and Prisma's types can't be imported into
 * browser code, so these are written by hand to mirror the `select` blocks in
 * `server/src/routes/public/content.ts`. Nothing enforces it. Dates arrive as
 * ISO strings.
 */

export type ApiStats = {
  projects: number
  members: number
  events: number
}

/**
 * One photograph in the landing page's slideshow, from `GET /api/hero-slides`.
 *
 * Same six fields as `ApiProjectImage` but a separate type: different tables,
 * different desks, and the day a field is added to one is the day an alias would
 * have been the wrong shape.
 *
 * An empty list is a supported answer — the hero draws its rings instead.
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
 * One question on the front page's FAQ. `steps` is the one answer shape that
 * isn't a paragraph — becoming a member is a procedure and the section numbers
 * it. Empty is the ordinary case.
 */
export type ApiFaq = {
  id: string
  question: string
  answer: string
  steps: string[]
}

/**
 * One partner program, for somebody who can't join the club itself. `imageUrl`
 * is an external address or `/api/files/<id>`, so it goes through `imageSrc`.
 * Null draws the hatch well.
 */
export type ApiPartnerProgram = {
  id: string
  name: string
  audience: string
  blurb: string
  href: string
  linkLabel: string
  imageUrl: string | null
}

/**
 * Everything the landing page says, from `GET /api/front-page`.
 *
 * One read for the whole page's copy, made by `HomePage` and handed down: the
 * hero's lede and the FAQ are one document, and three routes would be three
 * round trips and three loading states. Sections still fetch their own data.
 *
 * The copy fields are never empty — the route falls back to the wording the site
 * shipped with. Both lists may be empty and both sections are built for it.
 */
export type ApiFrontPage = {
  /** The first line of the hero, in the page's own ink. */
  headline: string
  /** The second line, in gold. Split in two because the break between them is a
      `<br>` the type scale is tuned around. */
  headlineAccent: string
  lede: string
  /** The line above the partner cards, saying who those programs are for. */
  partnersIntro: string
  faqs: ApiFaq[]
  partners: ApiPartnerProgram[]
}

/** One line on the about page's timeline. `when` is free text — "1972", a span,
    or a season — because the page prints it as one. */
export type ApiMilestone = {
  id: string
  when: string
  what: string
}

/**
 * The whole of `/about`, from `GET /api/about`.
 *
 * `storyNotice` is the club's admission that the history below it is placeholder
 * text, and null is what finishing it looks like. It was hardcoded until officers
 * could edit this page, so retiring it used to need a deploy.
 *
 * The lab's four fields are null as a set: a club between homes prints no address
 * rather than half of one.
 */
export type ApiAboutPage = {
  heading: string
  lede: string
  storyNotice: string | null
  story: string[]
  labBuilding: string | null
  labStreet: string | null
  labCity: string | null
  labMapUrl: string | null
  onlineBlurb: string
  milestones: ApiMilestone[]
}

/**
 * Whether the lab is open, from `GET /api/lab`.
 *
 * `changedAt` is null when nobody has ever set it, which is not the same as
 * "closed a long time ago" — the two pages drawing this say so differently.
 *
 * No name on it, on purpose. Discord says who opened the lab; an endpoint anybody
 * can read only needs the state and the time.
 */
export type ApiLabStatus = {
  /**
   * Already masked by the building's hours, so act on this rather than the row.
   * An officer who forgets to close up doesn't leave a green sign up all night.
   */
  open: boolean
  changedAt: string | null
  /**
   * Whether the building is open at all — 8am to 10pm, Orlando time.
   *
   * Sent rather than mirrored in `lib/`, unlike most server rules: this is a
   * question about a wall clock in a specific timezone, and a second
   * implementation here would be a second timezone to get wrong.
   *
   * It buys the pages the difference between a switch that is off and one that
   * is disabled.
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
   * The term this project is built for — what tells last semester's rover from
   * this semester's. `Season` is declared in calendar order, so
   * `(termYear, termSeason)` sorts chronologically.
   */
  termYear: number
  termSeason: Season
  competition: string | null
  status: ProjectStatus
  /**
   * The one picture that stands for this project in a list. External address or
   * `/api/files/<id>`, so it goes through `imageSrc`.
   */
  coverUrl: string | null
  /**
   * Whether the cover is simply the gallery's first picture. Neither side falls
   * back to the other — see `coverOf` in `lib/projects/projectCover.ts`.
   */
  coverFromGallery: boolean
  /** How the cover sits in the card's 16:10 frame. `frameStyle`'s three numbers,
      on the project rather than on a gallery row. */
  coverFocalX: number
  coverFocalY: number
  coverZoom: number
  /**
   * What this project calls its own sections, or null for the standing label.
   * The `/ ` and the mono capitals are the page's; these are the words after it.
   */
  galleryHeading: string | null
  resourcesHeading: string | null
  teamHeading: string | null
  featured: boolean
  startedAt: string | null
  completedAt: string | null
}

/**
 * One person on a project, as `GET /api/projects/:slug` lists them.
 *
 * `rank` is the only label here that means anything — every permission on this
 * project is decided by it. `title` is free text somebody typed ("Software
 * Lead") and grants nothing; it's what a plain member's row falls back to.
 *
 * No user ids, on purpose — this is an anonymous payload. Anything that needs
 * one reads `GET /projects/:id/team`.
 */
export type ApiProjectMember = {
  title: string | null
  rank: ProjectMemberRank
  /** The project team they sit on, when they sit on one. Printed beside
      TEAM LEAD, which is meaningless without it. */
  team: { name: string } | null
  user: {
    slug: string | null
    fullName: string
    photoUrl: string | null
  }
}

/**
 * One picture in a project's gallery. `url` is an external address or
 * `/api/files/<id>`; the prefix is only ever read on the server, where deleting
 * the bytes is decided. `caption` doubles as the `alt` when set.
 */
export type ApiProjectImage = {
  id: string
  url: string
  caption: string | null
  /**
   * How the picture sits in the gallery's fixed frame — `object-position`
   * percentages plus a zoom, applied as CSS and never baked into the file.
   * 50/50/1 is a plain centred crop. See `lib/media/imageFraming.ts`.
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
 * `fileId` rather than a URL, unlike every image column: a document is always
 * ours, so `storedFileUrl` turns the id into an address.
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
   * When its file was last replaced — renaming a document deliberately leaves
   * this alone. Equals `uploadedAt` until the first revision, which is how the
   * page knows whether there are two dates worth printing or one.
   */
  updatedAt: string
}

/**
 * The single-project answer: the list row plus the long form, the people, the
 * gallery, the links and the documentation. Every list comes back in display
 * order, which is why none of them carries a sort key.
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
 * The heavy columns are opt-in because that route answers up to a hundred rows.
 * `/projects` no longer asks for this one; the list prints `summary` only. The
 * type stays because the flag does.
 */
export type ApiListedProject = ApiProject & { description: string | null }

/**
 * A card's row — `GET /api/projects?cover=true`, the gallery capped at one.
 *
 * It answers on `images` rather than a `cover` key of its own, so `coverOf` reads
 * the same field here as on the detail payload. At most one element; a project
 * whose cover is `coverUrl` may still have one, and `coverOf` decides.
 */
export type ApiCardProject = ApiProject & { images: ApiProjectImage[] }

/**
 * Somebody's project role, mirroring `ProjectMemberRank` in `schema.prisma`.
 *
 * The only thing that decides who can manage a project, and it means nothing
 * outside the membership row it sits on — the lead of one project is a plain
 * member on the next. `UserRole` says nothing about any project; it used to carry
 * lookalike values that granted nothing, which is why the two are worth telling
 * apart on sight.
 */
export type ProjectMemberRank = 'PROJECT_LEAD' | 'TEAM_LEAD' | 'MEMBER'

/** A project as its members and leads see it: the public row plus the meeting
    schedule, mirroring `managedProjectSelect` in `server/src/routes/officer/officer.ts`. */
export type ApiManagedProject = ApiProject & {
  /**
   * The days it meets — 0 = Sunday, matching `Date.getDay()`. Sorted and
   * deduplicated by the time it leaves the server. Empty means no schedule, which
   * is the only legal way for the two times below to be null.
   */
  meetingWeekdays: number[]
  /** Wall-clock "18:00" and "22:00", campus-local. Not moments — see
      `web/src/lib/events/meetings.ts` for why neither is ever put through `Date`. */
  meetingStartTime: string | null
  meetingEndTime: string | null
  meetingLocation: string | null
  /**
   * The lead's own note about the meeting, or null. The fields above are when and
   * where; this is the part they can't hold — bring a laptop, we skip home game
   * days. It's also the description each occurrence carries into a member's
   * calendar, and the site won't write one on their behalf.
   */
  meetingDescription: string | null
  /**
   * Whether the meetings reach the public calendar. An officer's switch, not a
   * lead's — the server refuses this field from anyone else.
   */
  meetingsPublic: boolean
  /**
   * The Discord role this project's crew carries, or null. Setting it hands the
   * role to everybody on the project and clearing it takes it back, so the form
   * editing this is editing people's Discord access rather than a label.
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
   * Whether this project's term is the one we're in, decided by the server
   * against UCF's calendar rather than by comparing dates here.
   *
   * Beside `rank` rather than inside `project` because everything in there is a
   * stored column and this is a fact about the clock.
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
 * the search matches on the name and on both, so a member with a Discord handle
 * and no email is still findable.
 */
/**
 * A seat on the board as the officer desk sees it: who the term belongs to, and
 * who opened it.
 *
 * `source` tells a seat the Discord sync handed out from one an officer gave by
 * hand, and only the second survives losing the Discord role.
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
 * One term's dates and where they came from, from
 * `GET /api/officer/semesters/:year`.
 *
 * `source` is why the desk is worth having: `fallback` means the site is guessing
 * from fixed dates in `semester.ts` because UCF's feed couldn't be read,
 * `calendar` means the feed answered, `override` means the club has said
 * otherwise. Only the first is a problem, and it used to be invisible.
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
   * Null is "nobody has said", not "there is no finals week" — nothing is paused
   * while it's null, and the desk says so in words, because a blank pair of dates
   * otherwise reads as a finals week of zero days. The server refuses to guess;
   * see `Term.finalsStartAt` in `server/src/membership/semester.ts`.
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
 * Where a 3D print request has got to. `DONE` and `REJECTED` are terminal, and
 * terminal means the uploaded model has been deleted. What survives is this row:
 * the name, the size, and how it ended.
 */
export type PrintRequestStatus = 'PENDING' | 'PRINTING' | 'DONE' | 'REJECTED'

/** The two machines. Everything else about a request pairs off this. */
export type PrintProcess = 'FDM' | 'SLA'

/**
 * What the club stocks. The pairing is the rule and the server enforces it: FDM
 * takes `PLA` or `PETG`, SLA takes `ABS_LIKE_RESIN` and nothing else.
 */
export type PrintMaterial = 'PLA' | 'PETG' | 'ABS_LIKE_RESIN'

export type InfillPattern =
  'GRID' | 'GYROID' | 'LINES' | 'TRIANGLES' | 'CUBIC' | 'HONEYCOMB' | 'CONCENTRIC'

/** A print request as its owner sees it, from `GET /api/me/print-requests`. */
export type ApiPrintRequest = {
  id: string
  fileName: string
  fileSize: number
  /** How many of it to print. Its own field rather than a line in `notes`,
      because it is the one thing in there that changes the arithmetic. */
  quantity: number
  /** The special requests — colour, brims, "no supports on the face". What's left
      once the fields have taken everything they can say. */
  notes: string | null
  status: PrintRequestStatus
  /**
   * When an officer put it on a printer, or null if nobody ever did. The only
   * thing that tells a cancelled print from a declined request — both land on
   * `REJECTED`. See `actionPhrase` in `lib/printing.ts`.
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
   * What actually came off the machine, when an officer said it differed — they
   * print in whatever is on the shelf. Null means "as asked", so every read is
   * `printedX ?? askedX`; `actualSettings` in `lib/printing.ts` does that once.
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
 * What a member has left to print this term, from `GET /api/me/print-allowance`.
 *
 * Never stored — counted from finished personal prints on each read.
 * `remainingGrams` can be negative: an officer may knowingly print past somebody's
 * allowance, and clamping at zero would hide exactly that.
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
  /** The requester's balance for this request's term, or null on a project print:
      those are uncapped, and a balance beside one would invite weighing it against
      a budget it doesn't come out of. */
  allowance: ApiPrintAllowance | null
}

/**
 * A loan's life. `APPROVED` and `CHECKED_OUT` both hold a unit — a thing set aside
 * for somebody who hasn't collected it is not available to anyone else, which is
 * the rule the availability count turns on.
 */
export type LoanStatus =
  'REQUESTED' | 'APPROVED' | 'CHECKED_OUT' | 'RETURNED' | 'DENIED' | 'CANCELED'

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
 * Mirrors `TaskStatus` in `schema.prisma`, and the order here is the order rows
 * come back in — Postgres sorts an enum by declaration order and the server orders
 * on it. Not alphabetised, and must not be.
 */
export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DELAYED' | 'DONE' | 'CANCELED'

/** The two labels that mean a task is settled: off the calendar, off the
    overview card, and never chased by the bot. */
export const SETTLED_TASK: readonly TaskStatus[] = ['DONE', 'CANCELED']

/**
 * A task, mirroring `taskSelect` + `wire()` in
 * `server/src/routes/projects/tasks.ts`.
 *
 * One type for both readers — the project board and `GET /api/me/tasks` — because
 * the server sends one shape. `project` is null for a task that belongs to a
 * person rather than a build; only officers can write one of those.
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
 * `GET /api/me/tasks` answers the same shape the board does. Kept as a name
 * because the overview card and the tasks page both read it.
 */
export type ApiMyTask = ApiTask

/**
 * An event as `GET /api/me/events` returns it: the public shape plus which project
 * and team it belongs to and whether the public site shows it. `published: false`
 * here is normal, not a draft — it's what every lead-created event looks like.
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
  'MEETING' | 'COMPETITION' | 'OUTREACH' | 'WORKSHOP' | 'FUNDRAISER' | 'SOCIAL'

/**
 * A project's whole meeting series, carried on each of its occurrences. Mirrors
 * `MeetingSeries` in `server/src/projects/meetings.ts`.
 *
 * Here so the add-to-calendar button can hand somebody the whole term in one press
 * rather than next Tuesday alone: a calendar app wants a rule and its exceptions,
 * and rebuilding those in the browser would be guessing at what the server already
 * worked out.
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
   * each in the .ics. Worked out server-side so the halt has one implementation.
   */
  skipDates: string[]
}

export type ApiEvent = {
  id: string
  slug: string
  title: string
  description: string | null
  /**
   * `'TASK'` is not a value of the `EventType` enum in Postgres and must not become
   * one. It's only ever set on a task deadline projected onto a member's own
   * calendar by `/api/me/events`; the public route validates `?type=` against the
   * real enum, so asking for it there is a 400 rather than an empty list.
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
   * Set only on a project meeting, which is generated rather than stored — its `id`
   * is `meeting:…` and nothing may edit or delete it.
   */
  meeting?: ApiMeetingSeries | null
  /**
   * Set only on a task deadline, the calendar's other generated entry — its `id` is
   * `task:…`, there's no row behind it, and it reaches only the assignee who asked.
   */
  task?: { id: string; status: TaskStatus } | null
}

/**
 * The sponsorship levels, highest first. Mirrors the `SponsorTier` enum in
 * `schema.prisma`, where the declaration order is the ranking. The wire format is
 * the enum name; the underscores come out for display.
 */
export type SponsorTier =
  'PROCESSOR_PATRON' | 'CIRCUIT_SUPPORTER' | 'BOLT_BACKER' | 'ALUMINUM_ALLY'

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
 * That one column is the whole difference: the public read filters on it and the
 * desk's doesn't, because a hidden sponsor missing from the desk as well would be
 * a row nobody could bring back.
 */
export type ApiManagedSponsor = ApiSponsor & {
  active: boolean
  /** ISO. Printed on the desk so two rows for the same company can be told
      apart by which one somebody added this week. */
  createdAt: string
}

/**
 * What a tier costs and what the club gives back, from `GET /api/sponsorship`.
 *
 * A tier with no offer is absent from the response, not present and empty. This
 * was four hardcoded PLACEHOLDER objects until officers got a desk for it, and an
 * unwritten tier being missing rather than defaulted is the point of the move —
 * nothing on that page is a figure the club didn't agree to.
 */
export type ApiTierOffer = {
  tier: SponsorTier
  /** Free text, not cents: "$5,000+", "UP TO $3,000", "In kind, by arrangement". */
  amount: string
  /**
   * Null on most of them, and that's the club's own sheet rather than an omission:
   * an amount over a list of what you get, with no sentence between.
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
   * tax-deductible note. One block of text with its newlines meaningful; null when
   * nobody has written any, which is what the grid drew before it existed.
   */
  footnotes: string | null
}

/**
 * Everything the sponsor desk draws, in one read.
 *
 * `tiers` carries one entry per level whether or not anybody has written it — an
 * unpublished tier is exactly the row an officer needs in order to publish it. How
 * many levels there are comes from the server, so a fifth tier in the schema draws
 * a fifth row with nothing edited here.
 */
export type ApiSponsorDesk = {
  sponsors: ApiManagedSponsor[]
  tiers: { tier: SponsorTier; offer: ApiTierOffer | null }[]
  inKind: ApiInKindOffer[]
  footnotes: string | null
}

/**
 * The eight seats on the officer board. Mirrors the `OfficerPosition` enum in
 * `schema.prisma`, where the declaration order is the display order.
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
 * A roster entry, as `rosterSelect` in `server/src/routes/public/content.ts`
 * returns it. It says nothing about the officer board — who sits on it is an
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
  /**
   * Where this person's photograph points — their LinkedIn, GitHub or the like —
   * or null for the great majority who haven't given one.
   *
   * The member writes it and the server decides what it may be: an allowlist of
   * known platforms in `server/src/core/validate.ts`. That's why a card can put it
   * straight in an `href`; nothing else here is a public address typed by an
   * ordinary member.
   *
   * Not `slug`, which is above and a different thing — a slug buys a profile page
   * on this site and is an officer's to set.
   */
  profileUrl: string | null
  active: boolean
  /**
   * Whether this person used to run the club, and what `?status=alumni` selects on.
   *
   * Two facts collapsed server-side: the club's Discord *Officer Alumni* role, and
   * a term in the club's own archive that has ended. Either is enough, so a board
   * typed in from 2011 files those people under ALUMNI without anybody touching
   * Discord. Collapsed because every reader wants the same OR.
   *
   * Not `active`, which is above and a different fact: that means "still around"
   * and every dues payment sets it back to true, so somebody can be both.
   * `rosterStatus` in `routes/public/content.ts` has the argument.
   */
  officerAlumnus: boolean
}

/**
 * A tenure on the officer board, as `GET /api/officers` and `GET /api/officers/past`
 * both return it — one table split on `endedAt`, so one shape and the page decides.
 *
 * `endedAt` null is what "currently on the board" means. Deliberately not `role`:
 * `UserRole` has one slot per person with `ADMIN` above `OFFICER`, so it can't say
 * "an admin who is also an officer", and a club always has one.
 *
 * `position` is null for somebody holding no named seat, which is a real state:
 * Discord decides that somebody is an officer, the roles desk decides which chair.
 *
 * `photoUrl` is already resolved server-side against the linked roster entry, and
 * the account's photograph wins — so an officer who changes their picture changes
 * it on the board. `profileUrl` comes off the same account and is null for every
 * term with nobody behind it, which is most of the archive. Dates are ISO strings;
 * `academicYear` in `lib/officerTerms.ts` makes the heading the archive groups by.
 */
export type ApiOfficerTerm = {
  id: string
  position: OfficerPosition | null
  startedAt: string
  endedAt: string | null
  fullName: string
  photoUrl: string | null
  profileUrl: string | null
}

/**
 * Today's board, from `GET /api/officers`.
 *
 * `officers` is one entry per sitting officer, not one per seat, so the page draws
 * as many cards as the club has officers. `seats` is every seat there is, in board
 * order, from the `OfficerPosition` enum — sent so the page can also show the
 * chairs nobody is in without keeping a list of its own.
 */
export type ApiOfficerBoard = {
  seats: OfficerPosition[]
  officers: ApiOfficerTerm[]
}

/**
 * The archive, from `GET /api/officers/past`.
 *
 * A window rather than the whole thing: two academic years by default, because a
 * fifty-year club is a few hundred rows and every one carries a headshot the page
 * then asks for. `older` is how many terms fall outside it — a count rather than
 * the rows, because the answer it feeds is a button.
 */
export type ApiOfficerArchive = {
  terms: ApiOfficerTerm[]
  older: number
  /** The seats this window used, in board order — the chip row, from the data
      rather than from a list the page keeps. */
  seats: OfficerPosition[]
}

/**
 * One term as the officers desk sees it, from `GET /api/officer/archive`:
 * `ApiOfficerTerm` plus the three things a public page has no use for.
 *
 * A term whose `source` is `DISCORD` was opened by the role sync and will be
 * reopened by it if it's closed or deleted while the person still carries the
 * role, so the desk warns rather than letting an officer press the same button
 * twice and conclude the site is broken. `endedReason` is the archive's own memory
 * of why a tenure finished.
 *
 * `photoUrl` here is the term's own and is not coalesced against the account,
 * unlike on `ApiOfficerTerm`: this is the page that sets and clears that column, so
 * a fallback would make an empty one look filled and REMOVE look broken.
 */
export type ApiArchivedTerm = {
  id: string
  position: OfficerPosition | null
  startedAt: string
  endedAt: string | null
  endedReason: string | null
  source: 'DISCORD' | 'MANUAL'
  fullName: string
  photoUrl: string | null
  user: { id: string; fullName: string; photoUrl: string | null } | null
}

/**
 * The whole table, from `GET /api/officer/archive`: every tenure the club has
 * recorded, open ones included.
 *
 * Unpaginated, and searched and filtered in the browser with `lib/officerTerms.ts`
 * — the same functions as the public archive this desk writes. `seats` comes from
 * the database rather than from a list here.
 */
export type ApiOfficerArchiveDesk = {
  seats: OfficerPosition[]
  terms: ApiArchivedTerm[]
}

/**
 * Whether this visitor may still write to the club, from `GET /api/contact`.
 *
 * Mirrors `server/src/routes/public/forms.ts`. The one read on the site whose
 * answer is about the caller rather than the club, so it is never cached — a stale
 * one would be wrong in the direction that costs somebody the message they typed.
 *
 * `message` is the server's own sentence for a refusal, null when there's nothing
 * to refuse. The number is the route's to change.
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
 * Nothing about the account comes back from any of these: there's no session yet,
 * and the address and the password hash are exactly the two fields every other
 * route is careful never to return.
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
 * Five states rather than a boolean, because they call for five different things
 * from the person filling the form. `not_found` sends them to the QR code, `taken`
 * doesn't; `unchecked` means no bot is configured and nothing was asked;
 * `unavailable` means Discord didn't answer, which is no evidence either way.
 */
export type ApiDiscordCheck =
  | { status: 'connected'; username: string; id: string }
  | { status: 'not_found' | 'taken' | 'unchecked' | 'unavailable' }

/**
 * Signing in, mirroring `server/src/routes/account/auth.ts`.
 *
 * `GET /api/auth/me` answers `{ user: null }` with a 200 rather than a 401 —
 * nobody being signed in is the ordinary state of the front page, and treating it
 * as a failure puts a red line in the console on every load.
 */
/**
 * Somebody's standing in the club, mirroring `UserRole` in `schema.prisma`.
 *
 * On the client this only shows and hides officer navigation. It never grants
 * access — every officer route re-checks server-side — and it says nothing about
 * any project. Who runs which project is `ProjectMemberRank`, above.
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
   * Their profile photo, or null. On the session because the nav bar and the
   * dashboard rail both draw an `Avatar` from `session.user` and have nothing else
   * to go on.
   *
   * An upload's `/api/files/<id>` or an external address, so it goes through
   * `imageSrc` — see `storedFiles.ts`.
   */
  photoUrl: string | null
  /**
   * How that photo sits inside the avatar's square, mirroring the three columns on
   * `User`. Chosen against a square frame rather than the gallery's 16:10 — the two
   * aren't interchangeable, and a photo framed for one is framed wrongly in the
   * other.
   *
   * On the session because the avatar is drawn wherever the session reaches, and
   * one drawn without these is a plain centred crop.
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
 * A superset of `ApiUser`. `bio` and `gradYear` are deliberately not on the
 * session: they're this page's business, and putting them there would mean every
 * page load carrying a paragraph the nav has no use for.
 */
export type ApiAccount = ApiUser & {
  bio: string | null
  gradYear: number | null
  /**
   * Where their photograph points on the public pages, or null. Here rather than on
   * the session for the reason `bio` is: the nav bar's avatar goes to the dashboard
   * and always will.
   */
  profileUrl: string | null
  /** When the member agreement was accepted, or null for every roster entry
      that predates the signup form. */
  acknowledgementAcceptedAt: string | null
  /**
   * Whether there is a password to change, rather than the hash. False for a roster
   * entry an officer created by hand — the page then offers to set one rather than
   * asking for a current one that doesn't exist.
   */
  passwordSet: boolean
  /** An address waiting on its confirmation link, or null. Without it the page
      has nothing to show between asking and following the link. */
  pendingEmail: string | null
}

/** What every account write answers with, so the page can adopt it straight
    into the session rather than making a second round trip. */
export type ApiAccountUser = { user: ApiUser }

/**
 * `PATCH /api/account/profile-link` — the stored address, or null once cleared.
 *
 * The one account write that doesn't answer with a user: it touches nothing the
 * session draws. What comes back is the address as the server normalised it, a
 * scheme added or `http` upgraded, which is why the panel takes this rather than
 * keeping what was typed.
 */
export type ApiProfileLink = { profileUrl: string | null }

/** `POST /api/account/email` — the link is out and nothing has moved yet. */
export type ApiEmailChangeStarted = {
  status: 'sent'
  email: string
  expiresInMinutes: number
}

/**
 * `POST /api/auth/password/forgot` — 202 whatever it found.
 *
 * The message is phrased about what would happen rather than what did: an answer
 * that differed for an unknown address would turn the form into a way to ask
 * whether somebody is a member.
 */
export type ApiPasswordResetSent = { status: 'sent'; message: string }

/**
 * Dues, mirroring `server/src/routes/member/dues.ts`.
 *
 * Every date is an ISO string and every amount is in cents — the unit Stripe
 * charges in, and converting anywhere but the point of display is where rounding
 * bugs live.
 */

export type Season = 'SPRING' | 'SUMMER' | 'FALL'

export type DuesPlan = 'SEMESTER' | 'YEAR'

/**
 * A UCF term. `fromCalendar` is false when calendar.ucf.edu couldn't be read and
 * the server fell back to fixed dates — the page says so rather than printing an
 * approximate date as though it were the real one.
 */
export type ApiTerm = {
  year: number
  season: Season
  startsAt: string
  endsAt: string
  /**
   * False only when the dates are the server's fixed fallbacks. True for a term the
   * club has set by hand on the semesters desk: the sweeps stand down on fallback
   * dates because a guess mustn't cost anybody their membership, and a date an
   * officer typed is the opposite of a guess.
   *
   * The server also sends `overridden` and `overrideNote`. Nothing on the dues pages
   * reads them, so they're deliberately not mirrored here.
   */
  fromCalendar: boolean
}

/**
 * Where a member stands today.
 *
 * Four statuses rather than a boolean, because they call for four different things
 * on the page. `ACTIVE` is paid. `TRIAL` is inside the free weeks at the start of a
 * term and about to not be — the one that needs a deadline in front of it. `FREE`
 * is summer or the gap between terms. `EXPIRED` is the only one that's a problem.
 */
/**
 * Mirrors `MembershipStatus` in `server/src/membership/semester.ts`. Only `ACTIVE`
 * is access: `FREE` means the club is charging nobody and this person hasn't
 * claimed it, which is one press away from cover rather than cover itself.
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
   * `ACTIVE` because a free window was claimed rather than because dues were paid —
   * so the panel doesn't tell somebody their dues are paid when they haven't paid
   * anything.
   */
  freeActive: boolean
  /** A free window is running and this person has not claimed it yet. */
  canActivate: boolean
  /**
   * The one-time member survey hasn't been answered.
   *
   * It locks nothing, and the name says so: it was `surveyRequired` while a
   * `requireSurvey` gate stood behind it and five pages drew a padlock from it. The
   * survey is an invitation now, so this is only what the dashboard reads to decide
   * whether it still has something to offer.
   *
   * Not a fact about dues, and it rides on this object anyway because `/dues/status`
   * is the one call the rail already makes on every page — a prompt with its own
   * fetch would arrive a beat late, under somebody's pointer.
   *
   * No `ADMIN` exemption, unlike everything else here: there's no lock left to be
   * exempt from.
   */
  surveyPending: boolean
  /**
   * They ticked *don't ask me again*, so the prompt stays down.
   *
   * Separate from the flag above: the prompt reads both, and the two panels that
   * offer the form read only the first. A dismissal silences the nag, it doesn't
   * hide the survey.
   */
  surveyPromptDismissed: boolean
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
   * Stripe's hosted receipt page, or null if there's none to link to.
   *
   * This is the receipt, not a copy of one that was emailed — Stripe only mails one
   * in live mode with "Successful payments" switched on, never for a test payment.
   * It expires these after 30 days and offers to send a fresh one.
   */
  receiptUrl: string | null
  /**
   * The officer who comped this term, null for everything Stripe collected. A
   * zero-amount row with nothing beside it reads as a bug in the price column, so
   * the name is what makes it a record instead.
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
 * What the survey asks is data, not types. It used to be five string unions here
 * and five Postgres enums there, so the club couldn't add a question without a
 * migration and a deploy. The only fixed thing left is the shape of one, which is
 * what `kind` names.
 */
export type SurveyQuestionKind =
  'SHORT_TEXT' | 'LONG_TEXT' | 'SINGLE_CHOICE' | 'MULTI_CHOICE'

export type ApiSurveyOption = {
  id: string
  label: string
  /** "Other": picking it asks for a line in the question's text box. */
  wantsText: boolean
  /**
   * An option the club has stopped offering that this member already picked. On the
   * form for them and for nobody else — a write replaces every answer, so an option
   * the form couldn't draw would be dropped on the way past.
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
   * `MULTI_CHOICE` only: the form offers a NONE box, and an empty set of ticks is
   * what pressing it stores. There is no NONE option — see `SurveyQuestion.allowNone`
   * in `schema.prisma` and `answered()` in `lib/survey.ts`.
   */
  allowNone: boolean
  /** Already resolved to a number by the server, so the input's cap and the
      route's cap are the same one. */
  maxLength: number
  options: ApiSurveyOption[]
}

/**
 * One answer. Uniform across all four kinds — a set of ticks and a line of text —
 * because which of the two a question uses is the question's business.
 *
 * The answer existing is what "answered" means: a tick-any question with a NONE box
 * is answered by an empty `optionIds`, so nothing in the answer itself could tell it
 * from a question somebody scrolled past.
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
 * `gradYear` sits beside the answers rather than among them because it's
 * `User.gradYear`, the same column the profile page edits and the public roster
 * prints. The survey writes there rather than keeping a second copy, so the form
 * pre-fills from this.
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
 * `GET /api/officer/survey/questions` — the same questions as their editor sees
 * them: the removed ones included, and with the counts that decide what REMOVE is
 * going to do.
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
