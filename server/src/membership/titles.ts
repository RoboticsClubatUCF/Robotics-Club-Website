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
 *     member.
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

/** Seat names as one squashed word: `vicepresident`, `labmanager`. Read from the enum so a
    new seat is reserved the day it's added. */
const SEATS = Object.values(OfficerPosition).map((seat) =>
  seat.toLowerCase().replace(/_/g, ''),
)

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

/** Found anywhere in the squashed title, so "Co-President" and "VicePresident" count. */
const OFFICE_FRAGMENTS = [
  'president',
  'treasurer',
  'secretary',
  'officer',
  'chairman',
  'chairwoman',
  'chairperson',
  'administrator',
]

/**
 * Matched against whole words and against two neighbouring words run together, so
 * "Lab Manager", "LabManager" and "E-Board" count but "Collab manager" and "Directory"
 * don't.
 */
const OFFICE_WORDS = new Set([
  ...SEATS.filter((seat) => !PLAIN_SEATS.has(seat)),
  'vp',
  'pres',
  'prez',
  'veep',
  'vicepres',
  'copres',
  'treas',
  'secy',
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

function officeIn(words: string[]): boolean {
  const squashed = words.join('')
  const pairs = words.slice(1).map((word, at) => words[at] + word)

  if (OFFICE_FRAGMENTS.some((fragment) => squashed.includes(fragment))) return true
  if (pairs.some((pair) => OFFICE_WORDS.has(pair))) return true
  if (words.some((word, at) => OFFICE_WORDS.has(word) && !excused(words, at))) {
    return true
  }

  return (
    PLAIN_SEATS.has(squashed) ||
    (words.some((word) => PLAIN_SEATS.has(word)) &&
      words.some((word) => RANK_WORDS.has(word)))
  )
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
  office: boolean
  lead: boolean
}

/** What a title says about its holder, before anybody's standing is looked up. */
export function claimsOf(title: string): TitleClaims {
  const readings = readingsOf(title)

  return {
    obscene:
      matcher.hasMatch(stripInvisible(title)) ||
      readings.some((words) => matcher.hasMatch(words.join(' '))),
    office: readings.some(officeIn),
    lead: readings.some(leadIn),
  }
}

export const TITLE_REFUSALS = {
  obscene: 'That title isn’t allowed. Try different words.',
  office: 'Officer titles are only for officers.',
  clubLead: 'Lead titles are only for project and team leads.',
  projectLead: 'Lead titles are only for this project’s leads.',
} as const

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
  if (claims.office && !officer) return TITLE_REFUSALS.office
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
