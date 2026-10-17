import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from 'obscenity'
import { prisma } from '../core/db.js'
import { stripInvisible } from '../core/validate.js'
import {
  OfficerPosition,
  ProjectMemberRank,
  UserRole,
} from '../generated/prisma/enums.js'

/**
 * What a title may say. Both kinds: `User.title`, the line under a name on `/members`, and
 * `ProjectMember.title`, the one beside it on a project's roster.
 *
 * Three refusals, checked when a title is written and never on read, so one written before
 * these rules stays until somebody edits it:
 *
 *   - Nothing obscene. `obscenity`'s English set rather than a word list in this public repo;
 *     it reads leetspeak, and the few club words it trips on are whitelisted below.
 *   - An office is the board's. Any seat's name, and the usual ways of claiming one ("VP",
 *     "Pres", "chair", "officer", "director"), need officer standing: `OFFICER` or `ADMIN`, or
 *     an open officer term, which is how the faculty advisor sits on the board as a plain
 *     member. A former officer may name a seat they held with its years ("Treasurer,
 *     2022–2023") as their club title, checked against their closed terms. Not on a project
 *     roster, where a past office means nothing.
 *   - "Lead", "captain", "head", "chief" need somebody who leads. For a club title that's a
 *     project or team lead anywhere, the same union the Discord lead roles use; for a project
 *     title, that rank on that project. Officers may use them too.
 *
 * The rules judge the person the title describes, not whoever types it, so an officer on the
 * roles desk can't hand a member "President" and a project lead can't hand a crew member
 * "Team Lead". Clearing is always allowed.
 */

const dataset = englishDataset.build()

const matcher = new RegExpMatcher({
  ...dataset,
  // Real words and parts the English set reads as something else.
  whitelistedTerms: [
    ...(dataset.whitelistedTerms ?? []),
    'cockpit',
    'asst',
    'cum laude',
    'dickinson',
    'shiitake',
    'cumming',
  ],
  ...englishRecommendedTransformers,
})

/** Digits and symbols that stand in for letters, so "Pr3sident" is still a claim. */
const LOOKALIKES: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'i',
}

/** Cyrillic and Greek letters drawn the same as Latin ones, so "Prеsident" with a Cyrillic
    е is still President. Lowercase only; the title is lowercased first. */
const CONFUSABLES: Record<string, string> = {
  а: 'a',
  в: 'b',
  е: 'e',
  ё: 'e',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  у: 'y',
  х: 'x',
  і: 'i',
  ї: 'i',
  ј: 'j',
  ѕ: 's',
  ԁ: 'd',
  α: 'a',
  β: 'b',
  ε: 'e',
  η: 'n',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
}

/** Lowercase words, with runs of single letters joined so "V.P." reads as `vp`. */
function wordsIn(text: string): string[] {
  const words: string[] = []
  let letters = ''

  for (const word of text.split(/[^a-z]+/).filter(Boolean)) {
    if (word.length === 1) {
      letters += word
      continue
    }
    if (letters) words.push(letters)
    letters = ''
    words.push(word)
  }
  if (letters) words.push(letters)

  return words
}

/**
 * The title as words, read two ways. Once with digits and symbols as the letters they stand
 * in for ("Pr3sident"), once as the punctuation they also are ("Lead!", "Lead1"). Reading
 * them only one way let a trailing "!" turn "Lead" into "leadi". A claim in either counts.
 */
function readingsOf(title: string): string[][] {
  const plain = [
    ...stripInvisible(title).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase(),
  ]
    .map((char) => CONFUSABLES[char] ?? char)
    .join('')

  const swapped = [...plain].map((char) => LOOKALIKES[char] ?? char).join('')

  return [wordsIn(swapped), wordsIn(plain)]
}

/**
 * Seats whose name is an ordinary word on its own ("Marketing", "Outreach"). They claim the
 * seat only as the whole title or beside a word of rank, so "Marketing team" stays free.
 * President, Treasurer and Secretary are one word too, but say nothing else and match
 * anywhere.
 */
const PLAIN_SEATS = new Set(
  Object.values(OfficerPosition)
    .filter((seat) => !seat.includes('_'))
    .map((seat) => seat.toLowerCase())
    .filter((seat) => !['president', 'treasurer', 'secretary'].includes(seat)),
)

/**
 * Seat names distinctive enough to find anywhere in the squashed title, so "Co-President"
 * counts. In this order: Vice President is taken out before President is looked for.
 */
const SEAT_FRAGMENTS: [string, OfficerPosition][] = [
  ['vicepresident', OfficerPosition.VICE_PRESIDENT],
  ['president', OfficerPosition.PRESIDENT],
  ['treasurer', OfficerPosition.TREASURER],
  ['secretary', OfficerPosition.SECRETARY],
]

const FRAGMENT_SEATS = new Set(SEAT_FRAGMENTS.map(([, seat]) => seat))

/**
 * Short names for seats. These, and every seat's own name, are matched against whole words
 * and two neighbouring words run together, so "Lab Manager", "LabManager" and "Vice-Pres"
 * count but "Collab manager" doesn't.
 */
const SEAT_ALIASES: Record<string, OfficerPosition> = {
  vp: OfficerPosition.VICE_PRESIDENT,
  veep: OfficerPosition.VICE_PRESIDENT,
  vicepres: OfficerPosition.VICE_PRESIDENT,
  pres: OfficerPosition.PRESIDENT,
  prez: OfficerPosition.PRESIDENT,
  copres: OfficerPosition.PRESIDENT,
  treas: OfficerPosition.TREASURER,
  secy: OfficerPosition.SECRETARY,
}

/** Office words that name no particular seat, matched the same way. "Director" as a word,
    so "Directory" is free. */
const UNNAMED_OFFICE_WORDS = new Set([
  'exec',
  'eboard',
  'executiveboard',
  'boardmember',
  'chair',
  'cochair',
  'director',
  'directors',
  'codirector',
  'admin',
  'advisor',
  'adviser',
])

/** The same, found anywhere in the squashed title. */
const UNNAMED_OFFICE_FRAGMENTS = [
  'chairman',
  'chairwoman',
  'chairperson',
  'administrator',
]

const LEAD_WORDS = new Set([
  'lead',
  'leader',
  'leaders',
  'colead',
  'coleader',
  'captain',
  'cocaptain',
  'head',
  'chief',
])

/** "TeamLead" and "SWLead" typed as one word. Not "leader": that's "cheerleader". */
const LEAD_SUFFIXES = ['lead', 'captain']

/** Words that end like a claim and aren't one. */
const NOT_LEAD = new Set(['plead', 'mislead'])

/** A word that isn't a claim beside these: "lead screw", "lead-free", "gear head",
    "peer advisor". */
const NOT_A_CLAIM_BEFORE: Record<string, Set<string>> = {
  lead: new Set(['screw', 'screws', 'free', 'acid', 'paint', 'pipe', 'solder']),
}
const NOT_A_CLAIM_AFTER: Record<string, Set<string>> = {
  head: new Set(['gear', 'bone', 'hot', 'egg', 'pin']),
  advisor: new Set(['peer']),
  adviser: new Set(['peer']),
}

const excused = (words: string[], at: number) =>
  (NOT_A_CLAIM_BEFORE[words[at]]?.has(words[at + 1] ?? '') ?? false) ||
  (NOT_A_CLAIM_AFTER[words[at]]?.has(words[at - 1] ?? '') ?? false)

const RANK_WORDS = new Set([
  ...LEAD_WORDS,
  'manager',
  'coordinator',
  'officer',
  'director',
  'chair',
])

type Offices = {
  /** Every seat the title names. */
  seats: Set<OfficerPosition>
  /** Office words that name no seat: "chair", "director", "admin". */
  unnamed: boolean
  /** "Officer" itself, which is what the board calls somebody with no seat. */
  officer: boolean
}

function officesIn(words: string[]): Offices {
  const pairs = words.slice(1).map((word, at) => words[at] + word)
  const tokens = new Set([
    ...words.filter((_word, at) => !excused(words, at)),
    ...pairs,
  ])
  const squashed = words.join('')
  let unclaimed = squashed
  const seats = new Set<OfficerPosition>()

  for (const [fragment, seat] of SEAT_FRAGMENTS) {
    if (!unclaimed.includes(fragment)) continue
    seats.add(seat)
    unclaimed = unclaimed.replaceAll(fragment, '')
  }

  for (const token of tokens) {
    const seat = SEAT_ALIASES[token]
    if (seat) seats.add(seat)
  }

  // Every other seat by its own name, read from the enum, so a new seat is reserved the
  // day it's added. Not the fragment seats again: "Vice President" has the word
  // "president" in it and names one seat.
  for (const seat of Object.values(OfficerPosition)) {
    if (FRAGMENT_SEATS.has(seat)) continue
    const name = seat.toLowerCase().replace(/_/g, '')
    const named = PLAIN_SEATS.has(name)
      ? squashed === name ||
        (words.includes(name) && words.some((word) => RANK_WORDS.has(word)))
      : tokens.has(name)
    if (named) seats.add(seat)
  }

  return {
    seats,
    unnamed:
      [...tokens].some((token) => UNNAMED_OFFICE_WORDS.has(token)) ||
      UNNAMED_OFFICE_FRAGMENTS.some((fragment) => squashed.includes(fragment)),
    officer: squashed.includes('officer'),
  }
}

function leadIn(words: string[]): boolean {
  return words.some((word, at) => {
    if (NOT_LEAD.has(word) || excused(words, at)) return false

    return (
      LEAD_WORDS.has(word) ||
      LEAD_SUFFIXES.some(
        (suffix) => word.length > suffix.length && word.endsWith(suffix),
      )
    )
  })
}

export type TitleClaims = {
  obscene: boolean
  /** Any office at all: a seat, an unnamed office word, or "officer". */
  office: boolean
  lead: boolean
  seats: OfficerPosition[]
  unnamedOffice: boolean
  officerWord: boolean
}

/** What a title says about its holder, before anybody's standing is looked up. */
export function claimsOf(title: string): TitleClaims {
  const readings = readingsOf(title)
  const offices = readings.map(officesIn)
  const seats = [...new Set(offices.flatMap((read) => [...read.seats]))]
  const unnamedOffice = offices.some((read) => read.unnamed)
  const officerWord = offices.some((read) => read.officer)

  return {
    obscene:
      matcher.hasMatch(stripInvisible(title)) ||
      readings.some((words) => matcher.hasMatch(words.join(' '))),
    office: seats.length > 0 || unnamedOffice || officerWord,
    lead: readings.some(leadIn),
    seats,
    unnamedOffice,
    officerWord,
  }
}

/**
 * The years a title names: "2022", "2022–2023", "2022-23". Four-digit years in this
 * century or the last, and the two-digit end of a range.
 */
export function yearsIn(title: string): number[] {
  const text = stripInvisible(title).normalize('NFKC')
  const years = new Set<number>()

  for (const [, first, end] of text.matchAll(
    /\b((?:19|20)\d{2})\s*[-–—/]\s*(\d{2})(?!\d)/g,
  )) {
    const start = Number(first)
    years.add(start)
    years.add(Math.floor(start / 100) * 100 + Number(end))
  }
  for (const [year] of text.matchAll(/\b(?:19|20)\d{2}\b/g)) {
    years.add(Number(year))
  }

  return [...years].sort((a, b) => a - b)
}

export const TITLE_REFUSALS = {
  obscene: 'That title isn’t allowed. Try different words.',
  office: 'Officer titles are only for officers.',
  pastOffice:
    'A past office needs the seat that was held and its years, like “Treasurer, 2022–2023”.',
  clubLead: 'Lead titles are only for project and team leads.',
  projectLead: 'Lead titles are only for this project’s leads.',
} as const

/**
 * Why a former officer can't carry an office title, or null when the title names only seats
 * they held, in years they held them: "Treasurer, 2022–2023" for somebody whose closed
 * Treasurer term ran through those years. Every seat named needs a term covering one of the
 * years, and every year a term of a seat named. "Officer, 2021" counts any closed term,
 * seated or not. An office word naming no seat ("Chair") stays a sitting officer's.
 */
async function pastOfficeProblem(
  userId: string,
  title: string,
  claims: TitleClaims,
): Promise<string | null> {
  const terms = await prisma.officerTerm.findMany({
    where: { userId, endedAt: { not: null } },
    select: { position: true, startedAt: true, endedAt: true },
  })

  // Nobody who was never on the board needs to hear about past offices.
  if (terms.length === 0) return TITLE_REFUSALS.office
  if (claims.unnamedOffice) return TITLE_REFUSALS.pastOffice

  const years = yearsIn(title)
  if (years.length === 0) return TITLE_REFUSALS.pastOffice

  const covers = (term: (typeof terms)[number], year: number) =>
    term.startedAt.getUTCFullYear() <= year &&
    year <= (term.endedAt ?? term.startedAt).getUTCFullYear()

  for (const seat of claims.seats) {
    const held = terms.some(
      (term) => term.position === seat && years.some((year) => covers(term, year)),
    )
    if (!held) return TITLE_REFUSALS.pastOffice
  }

  const named = claims.officerWord
    ? terms
    : terms.filter(
        (term) => term.position !== null && claims.seats.includes(term.position),
      )
  if (!years.every((year) => named.some((term) => covers(term, year)))) {
    return TITLE_REFUSALS.pastOffice
  }

  return null
}

/** `OFFICER` or `ADMIN`, or sitting on the board right now. */
export async function hasOfficerStanding(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      officerTerms: { where: { endedAt: null }, select: { id: true }, take: 1 },
    },
  })

  if (!user) return false

  return (
    user.role === UserRole.ADMIN ||
    user.role === UserRole.OFFICER ||
    user.officerTerms.length > 0
  )
}

const LEAD_RANKS: ProjectMemberRank[] = [
  ProjectMemberRank.PROJECT_LEAD,
  ProjectMemberRank.TEAM_LEAD,
]

export const isLeadRank = (rank: ProjectMemberRank) => LEAD_RANKS.includes(rank)

/**
 * Why `userId` can't carry `title` as their club title, or null when they can. Standing is
 * only read when the title claims something, so an ordinary title costs no query.
 */
export async function clubTitleProblem(
  userId: string,
  title: string | null,
): Promise<string | null> {
  if (title === null) return null

  const claims = claimsOf(title)
  if (claims.obscene) return TITLE_REFUSALS.obscene
  if (!claims.office && !claims.lead) return null

  const officer = await hasOfficerStanding(userId)
  if (claims.office && !officer) {
    const problem = await pastOfficeProblem(userId, title, claims)
    if (problem) return problem
  }
  if (!claims.lead || officer) return null

  const leads = await prisma.projectMember.count({
    where: { userId, rank: { in: LEAD_RANKS } },
  })

  return leads > 0 ? null : TITLE_REFUSALS.clubLead
}

/** The same for a title on one project, where leading means `rank` on that project. */
export async function projectTitleProblem(
  userId: string,
  rank: ProjectMemberRank,
  title: string | null,
): Promise<string | null> {
  if (title === null) return null

  const claims = claimsOf(title)
  if (claims.obscene) return TITLE_REFUSALS.obscene
  if (!claims.office && !claims.lead) return null
  if (claims.lead && !claims.office && isLeadRank(rank)) return null

  const officer = await hasOfficerStanding(userId)
  if (claims.office && !officer) return TITLE_REFUSALS.office
  if (claims.lead && !officer && !isLeadRank(rank)) {
    return TITLE_REFUSALS.projectLead
  }

  return null
}

/**
 * Whether a project title has to go now that its holder is a plain member there. A lead
 * word goes with the rank: the roster prints a plain member's title where a lead's rank
 * would be, so "Software Lead" kept after a demotion reads as a lead who isn't one.
 * Anything else in the title stays, legacy offices included.
 */
export async function leadTitleLapses(
  userId: string,
  title: string | null,
): Promise<boolean> {
  if (title === null || !claimsOf(title).lead) return false
  return !(await hasOfficerStanding(userId))
}

/** `leadTitleLapses` for people a write has just demoted on one project. */
export async function clearLapsedLeadTitles(
  projectId: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return

  const rows = await prisma.projectMember.findMany({
    where: { projectId, userId: { in: userIds }, title: { not: null } },
    select: { userId: true, title: true, rank: true },
  })

  for (const row of rows) {
    if (isLeadRank(row.rank) || !(await leadTitleLapses(row.userId, row.title))) {
      continue
    }

    await prisma.projectMember.update({
      where: { projectId_userId: { projectId, userId: row.userId } },
      data: { title: null },
    })
  }
}
