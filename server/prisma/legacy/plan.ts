import { normaliseHandle } from '../../src/discord/discord.js'
import {
  OfficerPosition,
  ProjectStatus,
  Season,
  SponsorTier,
  UserRole,
} from '../../src/generated/prisma/enums.js'
import { type Row, type Tables, parseArray, parseTimestamp } from './dump.js'

/**
 * Turning the old club database into rows this schema can hold.
 *
 * Split from the runner on purpose: everything here is a pure function of the
 * dump, so what the import is going to do can be printed and argued with before
 * anything is written. `import-legacy.ts` is the half that touches Postgres.
 *
 * The two databases disagree about more than column names. The old one decided
 * what somebody could do from a numeric `permissionLevel` on a `Role` row; this
 * one decides access from `duesPaidThrough` and says so in `membership.md`. The
 * old survey was fifteen fixed columns; this one is rows an officer edits. Most
 * of this file is those two arguments, written down.
 *
 * **Anything ambiguous is refused rather than guessed.** `specialCases` finds
 * the rows where a wrong guess would merge two people, publish a spam account
 * or invent an officer, and the runner will not write until each one has an
 * answer in `DECISIONS`.
 */

// ---------------------------------------------------------------- decisions

/**
 * The answers to the special cases, filled in as they are worked through.
 *
 * Deliberately a table in the source rather than a prompt or a CSV: the club
 * will run this import once, and a year from now the only record of *why*
 * Brandon Stile has one account instead of two needs to be somewhere a person
 * reads. Every entry names the person it is about.
 */
export interface Decisions {
  /** Legacy `Member.id`s that do not come across at all. */
  readonly drop: readonly string[]
  /**
   * Rows that were flagged, looked at, and are coming across unchanged.
   *
   * An explicit note rather than an absence, because the flag that raised them
   * is "this address is on a domain no member uses" — which is true of a typo
   * and of a real person's work address alike. Silence would mean nobody
   * checked; this means somebody did.
   */
  readonly keep: readonly string[]
  /**
   * Duplicate accounts: the id on the left is folded into the one on the right
   * and does not get a row of its own. `mergeUsers` decides what survives.
   */
  readonly mergeInto: Readonly<Record<string, string>>
  /** A corrected Discord handle, or `null` to import without one. */
  readonly handles: Readonly<Record<string, string | null>>
  /**
   * Which seat somebody holds: one of the eight, `null` for a term with no
   * named chair, or `NO_TERM` for somebody whose old title was not an office at
   * all and who should not appear on the board.
   */
  readonly seats: Readonly<Record<string, OfficerPosition | null | typeof NO_TERM>>
  /** Straight field corrections, applied last. */
  readonly overrides: Readonly<Record<string, Partial<MappedUser>>>
  /**
   * Where an existing `DuesPayment` belongs once its payer has been reimported.
   *
   * Two people paid the club through this site before the import, and their
   * payments are matched back onto the imported accounts by email — which works
   * for everybody whose address is the same on both sides and fails silently
   * for anybody whose is not. Keyed on the address the payment was made under,
   * valued with the address the imported account signs in with.
   */
  readonly paymentEmails: Readonly<Record<string, string>>
}

/** Answered, and the answer is that no `OfficerTerm` is created. */
export const NO_TERM = 'NO_TERM'

// ------------------------------------------------------------------ helpers

/**
 * A URL-safe slug.
 *
 * Dots are dropped rather than turned into separators, so `S.T.O.R.M.` becomes
 * `storm` and not `s-t-o-r-m`. Everything outside ASCII is stripped by the
 * `NFKD` fold, which is what turns `🌩Project S.T.O.R.M.` into `project-storm`
 * — the emoji is kept in the title, where it belongs, and left out of the URL.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    // The combining marks `NFKD` just split off, so `José` slugs as `jose`.
    .replace(/[̀-ͯ]/g, '')
    .replace(/\./g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

/** Collapse the runs of whitespace 41 of the old name columns carry. */
function tidy(value: string | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function fullNameOf(member: Row): string {
  return tidy(`${member.firstName ?? ''} ${member.lastName ?? ''}`)
}

/**
 * The address as the login route will look for it.
 *
 * Lowercased, because `POST /api/auth/login` lowercases what is typed before
 * the lookup (`routes/account/auth.ts`) and `email` is a plain unique column — a stored
 * capital is an address that can never be matched, which is a locked-out member
 * rather than a cosmetic difference.
 */
function emailOf(member: Row): string | null {
  const value = (member.email ?? '').trim().toLowerCase()

  return value === '' ? null : value
}

/**
 * The Discord handle shape this site accepts, from `src/discord/discord.ts`.
 *
 * Repeated as a constant rather than exported from there because that copy is
 * the *inbound* check on a handle somebody types, and coupling an import
 * decision to a validation rule would mean tightening the rule silently
 * rewrites history. They happen to agree today, and that is all.
 */
const HANDLE_SHAPE = /^[a-z0-9._]{2,32}$/

function handleOf(member: Row): string | null {
  const raw = member.discordProfileName ?? ''

  if (raw.trim() === '') return null

  const normalised = normaliseHandle(raw)

  return HANDLE_SHAPE.test(normalised) ? normalised : null
}

// -------------------------------------------------------------------- dues

/**
 * The old `membershipExpDate`, or `null` for somebody who never paid.
 *
 * The old column was `@default(now())`, so a row nobody ever touched carries a
 * date equal to `joinedAt` to the millisecond — 188 of them, every one a guest.
 * Imported literally that reads as "paid up until the second they signed up",
 * which `membershipSweep` would then treat as a lapsed member and demote,
 * writing a lapse that never happened into the club's records.
 *
 * Null is the truer value and the schema says so: `duesPaidThrough` null means
 * *never paid*, and the sweep singles it out on purpose. Equality on the
 * millisecond rather than a tolerance, because a default and a payment are
 * never that close by accident.
 */
export function duesPaidThroughOf(member: Row): Date | null {
  if (member.membershipExpDate === member.joinedAt) return null

  return parseTimestamp(member.membershipExpDate)
}

function duesCurrent(member: Row, now: Date): boolean {
  const through = duesPaidThroughOf(member)

  return through !== null && through > now
}

// -------------------------------------------------------------------- roles

/**
 * The old seven roles onto this schema's four.
 *
 * The old ladder had `committee`, `team lead` and `project lead` on it as
 * global labels — a permission level everybody carried everywhere. This schema
 * does not have that idea: leading a project is a `ProjectMember.rank` against
 * one project, and `membership.md` is emphatic that the two must not be
 * confused. So all three collapse to `MEMBER` here, and the leadership they
 * described is carried over separately as project rows.
 *
 * **`admin` and `officer` are the only ones read off the old role at all.**
 * Everyone else is decided by dues, which is what this site decides membership
 * from — a `guest` whose dues ran to next May was a paying member the old site
 * happened to label badly, and 451 of them are in that state.
 */
export function roleOf(member: Row, roleNames: Map<string, string>, now: Date): UserRole {
  const old = roleNames.get(member.roleId ?? '') ?? 'guest'

  if (old === 'admin') return UserRole.ADMIN

  // A `position` is the old site's officer board, and it disagrees with the
  // role column twice: Dwight Howard is `admin`, Crystal Maraj is `admin`, and
  // both sat on the board. The seats are resolved in `DECISIONS.seats`.
  if (old === 'officer') return UserRole.OFFICER

  if (duesCurrent(member, now)) return UserRole.MEMBER

  return old === 'member' || old === 'committee' || old === 'team lead' || old === 'project lead'
    ? UserRole.MEMBER
    : UserRole.GUEST
}

// ------------------------------------------------------------------- photos

/**
 * `profilePictureUrl`, which is a URL on eleven rows and a JSON object on one.
 *
 * The old site grew per-image framing late and stored it by JSON-encoding the
 * whole thing into the existing string column. This schema has real columns for
 * it — `photo_focal_x`, `photo_focal_y`, `photo_zoom` — so the blob unpacks
 * into them exactly. `fit` has no column and no meaning here: every avatar on
 * this site is a square `object-cover` by design (`Avatar.tsx`), which is what
 * the focal point and zoom are *for*.
 */
export function photoOf(member: Row): {
  photoUrl: string | null
  photoFocalX: number
  photoFocalY: number
  photoZoom: number
} {
  const raw = member.profilePictureUrl

  const plain = { photoUrl: raw, photoFocalX: 50, photoFocalY: 50, photoZoom: 1 }

  if (raw === null || !raw.trimStart().startsWith('{')) return plain

  try {
    const blob = JSON.parse(raw) as Record<string, unknown>
    const num = (value: unknown, fallback: number) =>
      typeof value === 'number' && Number.isFinite(value) ? value : fallback

    return {
      photoUrl: typeof blob.src === 'string' && blob.src !== '' ? blob.src : null,
      photoFocalX: num(blob.focalX, 50),
      photoFocalY: num(blob.focalY, 50),
      photoZoom: num(blob.scale, 1),
    }
  } catch {
    return plain
  }
}

// -------------------------------------------------------------------- users

export interface MappedUser {
  legacyId: string
  slug: string | null
  fullName: string
  email: string | null
  discordUsername: string | null
  passwordHash: string | null
  role: UserRole
  title: string | null
  photoUrl: string | null
  photoFocalX: number
  photoFocalY: number
  photoZoom: number
  active: boolean
  joinedAt: Date | null
  acknowledgementAcceptedAt: Date | null
  duesPaidThrough: Date | null
  surveyCompletedAt: Date | null
  createdAt: Date
  updatedAt: Date
  /** The old `Survey.id` this person answered, if any. */
  legacySurveyId: string | null
}

export function mapUser(
  member: Row,
  roleNames: Map<string, string>,
  surveys: Map<string, Row>,
  now: Date,
): MappedUser {
  const survey = surveys.get(member.surveyId ?? '')
  const joinedAt = parseTimestamp(member.joinedAt)

  return {
    legacyId: member.id!,
    // Filled in by `assignSlugs`, which needs to see the whole roster to break
    // a tie between two people with the same name.
    slug: null,
    fullName: fullNameOf(member),
    email: emailOf(member),
    discordUsername: handleOf(member),
    // Carried across as-is. It is bcrypt, and `verifyPassword` reads bcrypt so
    // that these still open; the login route rewrites each one in scrypt the
    // first time its owner signs in. An empty string is not a hash.
    passwordHash: member.passwordHash === '' ? null : member.passwordHash,
    role: roleOf(member, roleNames, now),
    // Free text on both sides — "Lab Manager", "The Robot Man". The *seat* is a
    // separate fact and lives on an `OfficerTerm`.
    title: member.position,
    ...photoOf(member),
    active: true,
    joinedAt,
    acknowledgementAcceptedAt: parseTimestamp(member.acknowledgedAt),
    duesPaidThrough: duesPaidThroughOf(member),
    // The gate. Stamped from the moment the old survey was filled in rather
    // than from now, because it is a record of when they answered — and it must
    // be set for everybody who did, or 440 people meet a form they have already
    // completed on their first sign-in.
    surveyCompletedAt: survey ? parseTimestamp(survey.DateCreated) : null,
    createdAt: joinedAt ?? now,
    updatedAt: parseTimestamp(member.updatedAt) ?? now,
    legacySurveyId: survey ? survey.id : null,
  }
}

/**
 * Who gets a public profile URL.
 *
 * A slug and a role above `GUEST` are jointly what put somebody on the roster
 * (`routes/public/content.ts`), so this is the decision to publish a real person's
 * name and photograph. It is limited to the officer board and to members whose
 * dues are current — everybody else imports with `slug` null and is invisible
 * on the public site until an officer puts them there by hand, which is how the
 * roster is meant to work.
 *
 * Collisions get the surname-less form first and a numeric suffix only if that
 * is still taken, so two unrelated people never quietly swap URLs.
 */
export function assignSlugs(
  users: MappedUser[],
  officers: ReadonlySet<string>,
  now: Date,
): void {
  const taken = new Set<string>()

  for (const user of users) {
    // Dues *covering today*, not merely a date on file. Somebody whose
    // membership ran out in 2024 never asked to be on next year's roster, and
    // the demotion sweep would take them off it within ten minutes anyway —
    // publishing them for those ten minutes is the wrong way round.
    const eligible =
      officers.has(user.legacyId) ||
      (user.role !== UserRole.GUEST &&
        user.duesPaidThrough !== null &&
        user.duesPaidThrough > now)

    if (!eligible) continue

    const base = slugify(user.fullName)

    if (base === '') continue

    let slug = base
    let n = 2

    while (taken.has(slug)) {
      slug = `${base}-${n}`
      n += 1
    }

    taken.add(slug)
    user.slug = slug
  }
}

/**
 * Fold a duplicate account into the one that is being kept.
 *
 * The rule is "the truest value of each field wins", not "the newer row wins",
 * because the two accounts are usually the same person signing up twice with a
 * personal address and then a `@ucf.edu` one — and which of those has the
 * survey, which has the later dues date and which was acknowledged are three
 * independent questions with three different answers.
 */
export function mergeUsers(keep: MappedUser, drop: MappedUser): MappedUser {
  const later = (a: Date | null, b: Date | null) =>
    a === null ? b : b === null ? a : a > b ? a : b
  const earlier = (a: Date | null, b: Date | null) =>
    a === null ? b : b === null ? a : a < b ? a : b

  return {
    ...keep,
    // One of the duplicate pairs has a blank name on the row with the better
    // dues date. Whichever half of a person's two signups actually carries
    // their name is the one worth keeping.
    fullName: keep.fullName !== '' ? keep.fullName : drop.fullName,
    // Whichever record exists. A password is only replaced if the kept row has
    // none, so nobody's working sign-in is swapped for the other account's.
    passwordHash: keep.passwordHash ?? drop.passwordHash,
    email: keep.email ?? drop.email,
    discordUsername: keep.discordUsername ?? drop.discordUsername,
    title: keep.title ?? drop.title,
    photoUrl: keep.photoUrl ?? drop.photoUrl,
    // Dues only ever move forward — the same rule the three writers in
    // `routes/member/dues.ts` follow. Taking the earlier one would un-pay somebody.
    duesPaidThrough: later(keep.duesPaidThrough, drop.duesPaidThrough),
    // Answered once is answered. So is agreed-to-once.
    surveyCompletedAt: earlier(keep.surveyCompletedAt, drop.surveyCompletedAt),
    acknowledgementAcceptedAt: earlier(
      keep.acknowledgementAcceptedAt,
      drop.acknowledgementAcceptedAt,
    ),
    legacySurveyId: keep.legacySurveyId ?? drop.legacySurveyId,
    // The club has known them since the first signup, whichever row that was.
    joinedAt: earlier(keep.joinedAt, drop.joinedAt),
    createdAt: earlier(keep.createdAt, drop.createdAt) ?? keep.createdAt,
    // The higher standing of the two: a `MEMBER` row and a `GUEST` row for one
    // person means they are a member.
    role: rank(keep.role) <= rank(drop.role) ? keep.role : drop.role,
  }
}

const ORDER: readonly UserRole[] = [
  UserRole.ADMIN,
  UserRole.OFFICER,
  UserRole.MEMBER,
  UserRole.GUEST,
]

const rank = (role: UserRole) => ORDER.indexOf(role)

// ----------------------------------------------------------------- projects

export interface MappedProject {
  legacyId: string
  slug: string
  title: string
  description: string | null
  termYear: number
  termSeason: Season
  season: string
  status: ProjectStatus
  coverUrl: string | null
  /**
   * The old `docsLink`, as the one resource row it becomes.
   *
   * It used to map to a `Project.repoUrl` column, which the site does not have
   * any more: the repository printed as a fixed row above the resource list and
   * drew a fixed box in the editor, so `/ RESOURCES` could never be empty on a
   * club where most builds have no repository. It is an ordinary `ProjectLink`
   * now, and this is null for the rows that carried no link at all.
   */
  docsUrl: string | null
  createdAt: Date
  updatedAt: Date
}

const SEASONS: Record<string, Season> = {
  Spring: Season.SPRING,
  Summer: Season.SUMMER,
  Fall: Season.FALL,
}

/**
 * One new project per old row, term and all.
 *
 * The old schema had no slug and no uniqueness: a build that ran for three
 * semesters was three `Project` rows sharing a title, and 53 rows are 23
 * distinct projects that way. This schema's `slug` is unique and each project
 * carries exactly one `(termYear, termSeason)`, so the term goes into the slug
 * and every old row keeps its own page — `tapemeasure-fall-2025` and
 * `tapemeasure-spring-2026` are separate builds, which is what they were.
 *
 * `season` — the free-text one the page prints — gets the readable form of the
 * same pair. `termYear`/`termSeason` are what anything compares on.
 */
export function mapProject(project: Row, pictures: Map<string, Row>, now: Date): MappedProject {
  const season = SEASONS[project.season ?? 'Fall'] ?? Season.FALL
  const year = Number.parseInt(project.year ?? '0', 10)
  const picture = pictures.get(project.pictureId ?? '')
  const created = parseTimestamp(project.createdAt) ?? now

  return {
    legacyId: project.id!,
    slug: `${slugify(project.title ?? 'project')}-${season.toLowerCase()}-${year}`,
    // The emoji stays. It is on the club's own project and the title is what
    // the page prints; only the URL has to be ASCII.
    title: (project.title ?? '').trim(),
    description: project.description === '' ? null : project.description,
    termYear: year,
    termSeason: season,
    season: `${season.charAt(0)}${season.slice(1).toLowerCase()} ${year}`,
    // Nothing in the old row says whether a build finished, so the term does.
    // Anything from a year the club has finished is done by definition;
    // anything current is still going. Wrong for an abandoned project, and an
    // officer can correct one — inventing `ARCHIVED` for 40 of them could not
    // be corrected, because nobody would know to look.
    status: year >= now.getUTCFullYear() ? ProjectStatus.IN_PROGRESS : ProjectStatus.COMPLETED,
    // Every one of the 48 old pictures is an external URL, so there is nothing
    // to upload and `imageSrc` passes them straight through.
    coverUrl: picture?.data ?? null,
    // The old `docsLink` is the club's wiki, and the only other URL on the row.
    // It lands as a resource link rather than a column — see `docsUrl`.
    docsUrl: project.docsLink === '' ? null : project.docsLink,
    createdAt: created,
    updatedAt: parseTimestamp(project.updatedAt) ?? created,
  }
}

/**
 * The old `WebSponsor.tier`, which was a lowercase word.
 *
 * Only `bolt` is in the dump; the rest are mapped anyway so a second sponsor
 * added before the import runs does not land on the default silently.
 */
export function sponsorTierOf(tier: string | null): SponsorTier {
  switch ((tier ?? '').trim().toLowerCase()) {
    case 'processor':
      return SponsorTier.PROCESSOR_PATRON
    case 'circuit':
      return SponsorTier.CIRCUIT_SUPPORTER
    case 'bolt':
      return SponsorTier.BOLT_BACKER
    default:
      return SponsorTier.ALUMINUM_ALLY
  }
}

/**
 * `WebSponsor.imageUrl`, which carries the same JSON blob as an avatar.
 *
 * `sponsors` has one column for it — `logo_url` — and no framing, so only
 * `src` survives. The old row's `fit: contain, scale: 1.95` is lost, which is
 * worth knowing rather than discovering: the logo may sit differently than it
 * did on the old site.
 */
export function sponsorLogoOf(imageUrl: string | null): string | null {
  if (imageUrl === null || imageUrl.trim() === '') return null
  if (!imageUrl.trimStart().startsWith('{')) return imageUrl

  try {
    const blob = JSON.parse(imageUrl) as Record<string, unknown>

    return typeof blob.src === 'string' && blob.src !== '' ? blob.src : null
  } catch {
    return imageUrl
  }
}

// ------------------------------------------------------------ special cases

export type CaseKind =
  | 'duplicate-email'
  | 'duplicate-handle'
  | 'spam-or-test'
  | 'officer-seat'
  | 'impossible-date'
  | 'unusable-handle'
  | 'no-password'
  | 'no-email'
  | 'json-photo'

export interface SpecialCase {
  kind: CaseKind
  /** Legacy `Member.id`s involved — more than one for a duplicate pair. */
  ids: string[]
  detail: string
}

/**
 * The cases that stop the import, versus the ones it merely reports.
 *
 * Blocking is not about severity, it is about whether a default exists that
 * cannot be wrong. An unusable Discord handle has one — import no handle, lose
 * nothing but a notification. Two accounts sharing an address do not: either
 * choice merges or discards somebody's history, and both are wrong half the
 * time.
 */
export const BLOCKING: ReadonlySet<CaseKind> = new Set<CaseKind>([
  'duplicate-email',
  'duplicate-handle',
  'spam-or-test',
  'officer-seat',
  'impossible-date',
])

/**
 * Email domains the club's members actually use.
 *
 * The list is an allow-list rather than a block-list of the throwaway domains,
 * because the throwaway ones are disposable by design — naming the thirteen in
 * this dump would catch this dump and nothing else. Anything unrecognised is
 * *reported*, not dropped: `deloitte.com` and `kdfrobotics.com` are on that
 * list too and both look like real people.
 */
const KNOWN_DOMAINS: ReadonlySet<string> = new Set([
  'ucf.edu',
  'knights.ucf.edu',
  'rccf.club',
  'gmail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'icloud.com',
  'me.com',
  'live.com',
  'aol.com',
  'msn.com',
  'proton.me',
  'protonmail.com',
  'comcast.net',
  'cox.net',
  'cfl.rr.com',
])

/** Every row that needs a person to look at it, in the order to work them. */
export function specialCases(
  members: Row[],
  roleNames: Map<string, string>,
  now: Date,
): SpecialCase[] {
  const cases: SpecialCase[] = []
  const byEmail = new Map<string, Row[]>()
  const byHandle = new Map<string, Row[]>()

  for (const member of members) {
    const email = emailOf(member)
    const handle = (member.discordProfileName ?? '').trim().toLowerCase()

    if (email !== null) {
      byEmail.set(email, [...(byEmail.get(email) ?? []), member])
    }
    if (handle !== '') {
      byHandle.set(handle, [...(byHandle.get(handle) ?? []), member])
    }
  }

  const describe = (member: Row) =>
    `${fullNameOf(member) || '(no name)'} <${member.email ?? ''}> @${
      member.discordProfileName ?? ''
    } ${roleNames.get(member.roleId ?? '') ?? '?'} dues=${
      duesPaidThroughOf(member)?.toISOString().slice(0, 10) ?? 'never'
    } survey=${member.surveyId ?? 'none'}`

  // Both columns are unique in the destination, so these cannot both land. The
  // old database allowed them because its unique index was case-sensitive.
  for (const [email, rows] of byEmail) {
    if (rows.length > 1) {
      cases.push({
        kind: 'duplicate-email',
        ids: rows.map((r) => r.id!),
        detail: `${email}\n      ${rows.map(describe).join('\n      ')}`,
      })
    }
  }

  for (const [handle, rows] of byHandle) {
    if (rows.length > 1) {
      cases.push({
        kind: 'duplicate-handle',
        ids: rows.map((r) => r.id!),
        detail: `@${handle}\n      ${rows.map(describe).join('\n      ')}`,
      })
    }
  }

  for (const member of members) {
    const email = emailOf(member)
    const domain = email?.split('@')[1] ?? ''

    if (email !== null && !KNOWN_DOMAINS.has(domain)) {
      cases.push({
        kind: 'spam-or-test',
        ids: [member.id!],
        detail: `${domain} — ${describe(member)}`,
      })
    }

    if (email === null) {
      cases.push({ kind: 'no-email', ids: [member.id!], detail: describe(member) })
    }

    if (member.position !== null) {
      cases.push({
        kind: 'officer-seat',
        ids: [member.id!],
        detail: `"${member.position}" — ${describe(member)}`,
      })
    }

    const dues = duesPaidThroughOf(member)

    if (dues !== null && dues.getUTCFullYear() > now.getUTCFullYear() + 5) {
      cases.push({
        kind: 'impossible-date',
        ids: [member.id!],
        detail: `dues through ${dues.toISOString()} — ${describe(member)}`,
      })
    }

    const raw = (member.discordProfileName ?? '').trim()

    if (raw !== '' && handleOf(member) === null) {
      cases.push({
        kind: 'unusable-handle',
        ids: [member.id!],
        detail: `${JSON.stringify(raw)} — ${describe(member)}`,
      })
    }

    if (member.passwordHash === '' || member.passwordHash === null) {
      cases.push({ kind: 'no-password', ids: [member.id!], detail: describe(member) })
    }

    if (member.profilePictureUrl?.trimStart().startsWith('{')) {
      cases.push({ kind: 'json-photo', ids: [member.id!], detail: describe(member) })
    }
  }

  return cases
}

/** Which blocking cases `DECISIONS` has not yet answered. */
export function unresolved(cases: SpecialCase[], decisions: Decisions): SpecialCase[] {
  const dropped = new Set(decisions.drop)
  const kept = new Set(decisions.keep)
  const merged = new Set(Object.keys(decisions.mergeInto))
  const seated = new Set(Object.keys(decisions.seats))
  const overridden = new Set(Object.keys(decisions.overrides))

  return cases.filter((c) => {
    if (!BLOCKING.has(c.kind)) return false

    // A row that is being dropped needs no further answer about anything.
    const live = c.ids.filter((id) => !dropped.has(id))

    if (live.length === 0) return false

    switch (c.kind) {
      case 'duplicate-email':
      case 'duplicate-handle':
        // Answered once only one of them is still standing on its own.
        return live.filter((id) => !merged.has(id)).length > 1
      case 'spam-or-test':
        // Answered by dropping it, merging it, or saying explicitly it stays.
        return !kept.has(live[0]!) && !overridden.has(live[0]!) && !merged.has(live[0]!)
      case 'officer-seat':
        return !seated.has(live[0]!)
      case 'impossible-date':
        return !overridden.has(live[0]!)
      default:
        return false
    }
  })
}

// ------------------------------------------------------------------ surveys

/** A live question from the destination database, with its options. */
export interface Question {
  id: string
  prompt: string
  kind: string
  options: { id: string; label: string; wantsText: boolean }[]
}

export interface MappedAnswer {
  questionId: string
  text: string | null
  optionIds: string[]
}

/**
 * A listed option by label, **never the free-text one**.
 *
 * The exclusion is the whole point. Both forms call their escape hatch "Other",
 * so a plain label match happily resolves the old `{Other}` to the new *Other*
 * — which is an option with `wantsText`, and picking it without filling the box
 * in is a state `routes/member/survey.ts` refuses and the member cannot re-save. The
 * old answer's own text lives in a different column, so an explicit "Other" has
 * to fall through to the branch that knows where to find it.
 */
const option = (question: Question | undefined, label: string) =>
  question?.options.find(
    (o) => !o.wantsText && o.label.toLowerCase() === label.trim().toLowerCase(),
  )

const otherOf = (question: Question | undefined) =>
  question?.options.find((o) => o.label.toLowerCase() === 'other')

/**
 * The old fifteen-column survey onto whatever the club is asking today.
 *
 * Matched on the **prompt text**, not on position or on an id, because the
 * questions are rows an officer can reorder and reword at
 * `/dashboard/officer/survey/questions` — and this import will run against
 * whatever is there on the day. A question that has been renamed past
 * recognition simply gets no answers rather than the wrong ones, which is why
 * every lookup below is allowed to come back empty.
 *
 * Four old columns have no question at all — `GitName`, `Year`, `PrevMem`,
 * `NumberofSemesters` — plus `Concerns` and `UCFemail`, and they are dropped.
 * One new question, dietary restrictions, has no old column and is left
 * unanswered: the old form never asked, and inventing "no restrictions" for 440
 * people is a claim about what is safe to feed them.
 */
export function mapSurvey(survey: Row, questions: Question[]): MappedAnswer[] {
  const find = (needle: string) =>
    questions.find((q) => q.prompt.toLowerCase().includes(needle))

  const major = find('major')
  const shirt = find('shirt')
  const allergies = find('allerg')
  const food = find('else about food')
  const found = find('find out')

  const answers: MappedAnswer[] = []

  // ---- Major. Multi-select then, single-choice now: the first recognised one
  // wins and a second major is lost, which is the cost of the question having
  // changed shape. Anything unrecognised goes to Other carrying its own text.
  if (major) {
    const listed = parseArray(survey.Major).map((m) => m.trim()).filter(Boolean)
    const matched = listed.map((l) => option(major, l)).find(Boolean)
    const other = otherOf(major)

    if (matched) {
      answers.push({ questionId: major.id, text: null, optionIds: [matched.id] })
    } else if (listed.length > 0 && other) {
      const written = (survey.OtherMajors ?? '').trim()
      answers.push({
        questionId: major.id,
        // `wantsText` makes the box mandatory, so a picked Other with nothing
        // in it would be a state the form cannot produce. The old label is the
        // honest fallback when they told us nothing more than "Other".
        text: capped(written !== '' ? written : listed.join(', '), major, 'Other'),
        optionIds: [other.id],
      })
    }
  }

  // ---- Shirt size. One relabelling: the old form said XXL, this one says 2XL.
  if (shirt && survey.ShirtSize !== null && survey.ShirtSize !== '') {
    const label = survey.ShirtSize === 'XXL' ? '2XL' : survey.ShirtSize
    const picked = option(shirt, label)

    if (picked) answers.push({ questionId: shirt.id, text: null, optionIds: [picked.id] })
  }

  // ---- Allergies. `{None}` is not an option here and must not become one:
  // this question is `allowNone`, and an empty tick set is precisely what that
  // means. `{}` — one row — is the same statement made by an older form.
  if (allergies) {
    const listed = parseArray(survey.Allergies)
      .map((a) => a.trim())
      .filter((a) => a !== '' && a.toLowerCase() !== 'none')
    const picked = listed.map((l) => option(allergies, l)).filter((o) => o !== undefined)

    answers.push({
      questionId: allergies.id,
      text: null,
      optionIds: picked.map((o) => o.id),
    })
  }

  // ---- The free-text food box. The old form had a box for allergies only;
  // this one is where the person ordering the food actually looks, so the old
  // text lands there rather than being lost to a question that no longer has a
  // text field of its own.
  if (food) {
    const written = (survey.OtherAllergies ?? '').trim()

    if (written !== '') {
      answers.push({ questionId: food.id, text: capped(written, food, ''), optionIds: [] })
    }
  }

  // ---- How they found the club. Multi then, single now, and three of the old
  // choices — Knight Connect, Posters, Events — plus a run of course codes have
  // no equivalent. Rather than dropping the answer, they go to Other with the
  // original words, so the club can still count them.
  if (found) {
    const listed = parseArray(survey.DiscoveredThrough).map((d) => d.trim()).filter(Boolean)
    const direct =
      listed.length === 1
        ? (option(found, listed[0]!) ??
          option(found, ALIASES[listed[0]!.toLowerCase()] ?? listed[0]!))
        : undefined
    const other = otherOf(found)

    if (direct) {
      answers.push({ questionId: found.id, text: null, optionIds: [direct.id] })
    } else if (listed.length > 0 && other) {
      answers.push({
        questionId: found.id,
        text: capped(listed.join(', '), found, 'Other'),
        optionIds: [other.id],
      })
    }
  }

  return answers
}

/** Old wording that says the same thing as a current option. */
const ALIASES: Readonly<Record<string, string>> = {
  'friend(s)': 'Friends',
  friends: 'Friends',
  'social media': 'Social media',
  google: 'Google',
  'class presentations fall': 'In class',
  'class presentations spring': 'In class',
}

/**
 * Text trimmed to what the question accepts.
 *
 * The caps are the officer's, set per question, and `routes/member/survey.ts` enforces
 * them on the way in. Nothing enforces them on a direct write, which is exactly
 * why it is done here: a stored answer longer than its own question's limit is
 * one the member cannot re-save without silently losing the tail.
 */
function capped(text: string, question: Question, fallback: string): string {
  const limit = question.kind === 'LONG_TEXT' ? 1000 : 200
  const value = text.slice(0, limit).trim()

  return value === '' ? fallback : value
}

// ------------------------------------------------------------------ indexes

/** The lookup tables the mapping functions want, built once. */
export function indexes(tables: Tables) {
  const rows = (name: string) => tables.get(name) ?? []
  const by = (name: string, key = 'id') =>
    new Map(rows(name).map((r) => [r[key] ?? '', r] as const))

  return {
    members: rows('Member'),
    roleNames: new Map(rows('Role').map((r) => [r.id ?? '', r.name ?? ''] as const)),
    surveys: by('Survey'),
    pictures: by('Picture'),
    projects: rows('Project'),
    links: by('Link'),
    linkToProject: rows('_LinkToProject'),
    memberToProject: rows('_MemberToProject'),
    memberRoles: rows('_MemberRoles'),
    sponsors: rows('WebSponsor'),
    articles: rows('Article'),
  }
}
