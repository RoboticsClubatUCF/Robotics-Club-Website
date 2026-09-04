import { prisma } from '../src/core/db.js'
import {
  OfficerTermSource,
  ProjectMemberRank,
  Season,
} from '../src/generated/prisma/enums.js'
import { DECISIONS } from './legacy/decisions.js'
import { parseDump } from './legacy/dump.js'
import {
  type MappedUser,
  type Question,
  type SpecialCase,
  assignSlugs,
  indexes,
  mapProject,
  mapSurvey,
  mapUser,
  mergeUsers,
  slugify,
  specialCases,
  sponsorLogoOf,
  sponsorTierOf,
  unresolved,
  NO_TERM,
} from './legacy/plan.js'

/**
 * Moving the club's previous database into this one.
 *
 *   npx tsx prisma/import-legacy.ts                 # say what would happen
 *   npx tsx prisma/import-legacy.ts --apply         # do it
 *
 * This is not the seed and it isn't idempotent. The seed upserts on unique keys and can be run
 * any number of times; this clears the destination and writes 700 people into it once. Running
 * it twice means clearing twice, which is why `--apply` has to be asked for.
 *
 * Everything is one transaction. Half-importing a club is worse than not importing it: the
 * failure would show up as a roster with some people on it, which nobody would read as an error.
 *
 * Fourteen pairs of rows share an email address or a Discord handle, both unique here.
 * Twenty-odd accounts are on domains no member uses. Nine people hold an office that has to
 * become a seat. None of those have a default that can't be wrong, so the run stops until
 * `legacy/decisions.ts` has an answer for each.
 */

const DUMP = process.env.LEGACY_DUMP ?? 'C:/Users/caich/Downloads/rccf_backup.sql'

const apply = process.argv.includes('--apply')

/**
 * The clock every "is this current" question is asked against, pinned once.
 *
 * Dues standing, whether a project is still running and who lands on the public
 * roster all read it, and an import that took four minutes would otherwise be
 * answering them at four different moments.
 */
const NOW = new Date()

/** The people who genuinely sit on the board — `NO_TERM` entries excluded. */
const seatedIds = (): string[] =>
  Object.keys(DECISIONS.seats).filter((id) => DECISIONS.seats[id] !== NO_TERM)

// ---------------------------------------------------------------- the report

function report(cases: SpecialCase[], users: MappedUser[]): void {
  const byKind = new Map<string, SpecialCase[]>()

  for (const c of cases) {
    byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c])
  }

  console.log('\n=== special cases ===\n')

  for (const [kind, list] of [...byKind].sort()) {
    console.log(`  ${kind} (${list.length})`)

    for (const c of list) {
      console.log(`    - ${c.detail}`)
    }

    console.log('')
  }

  const roles = new Map<string, number>()

  for (const user of users) {
    roles.set(user.role, (roles.get(user.role) ?? 0) + 1)
  }

  console.log('=== users as they would land ===\n')
  console.log(`  total            ${users.length}`)
  console.log(`  roles            ${[...roles].map(([r, n]) => `${r}=${n}`).join(' ')}`)
  console.log(`  on the roster    ${users.filter((u) => u.slug !== null).length}`)
  console.log(`  can sign in      ${users.filter((u) => u.passwordHash && u.email).length}`)
  console.log(`  dues on file     ${users.filter((u) => u.duesPaidThrough).length}`)
  console.log(`  survey answered  ${users.filter((u) => u.surveyCompletedAt).length}`)
  console.log(`  discord handle   ${users.filter((u) => u.discordUsername).length}`)
}

// ----------------------------------------------------------------- clearing

/**
 * A real payment, rescued from the rows that are about to be deleted.
 *
 * Two people paid the club through this site before the import, both `SUCCEEDED` with a Stripe
 * intent behind them. `dues_payments.user_id` cascades, so clearing the users table would take
 * the record of two real transactions with it — and the treasurer's history isn't seed data.
 * They're read out before the clear and written back against the imported accounts afterwards.
 */
interface RescuedPayment {
  email: string
  amountCents: number
  currency: string
  plan: string
  status: string
  termYear: number
  termSeason: string
  coversThrough: Date
  stripePaymentIntentId: string
  receiptUrl: string | null
  createdAt: Date
  updatedAt: Date
  paidAt: Date | null
}

async function rescuePayments(tx: typeof prisma): Promise<RescuedPayment[]> {
  const rows = await tx.duesPayment.findMany({
    where: { status: 'SUCCEEDED', user: { email: { not: null } } },
    select: {
      amountCents: true,
      currency: true,
      plan: true,
      status: true,
      termYear: true,
      termSeason: true,
      coversThrough: true,
      stripePaymentIntentId: true,
      // The Stripe receipt the member was shown. Dropping it would leave a
      // payment nobody can produce proof of, which is the one thing a payment
      // record is for.
      receiptUrl: true,
      createdAt: true,
      updatedAt: true,
      paidAt: true,
      user: { select: { email: true } },
    },
  })

  return rows.map((r) => ({
    // The address the payment belongs to *after* the import, which is not
    // always the one it was made under — see `paymentEmails`.
    email: DECISIONS.paymentEmails[r.user.email!] ?? r.user.email!,
    amountCents: r.amountCents,
    currency: r.currency,
    plan: String(r.plan),
    status: String(r.status),
    termYear: r.termYear,
    termSeason: String(r.termSeason),
    coversThrough: r.coversThrough,
    stripePaymentIntentId: r.stripePaymentIntentId,
    receiptUrl: r.receiptUrl,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    paidAt: r.paidAt,
  }))
}

/**
 * Emptying the destination of everything the seed invented.
 *
 * What stays is as considered as what goes. `survey_questions` and their options are created by
 * a hand-written migration rather than the seed, and they're what this import writes into —
 * deleting them would leave a survey with no questions on it. `equipment` stays because the old
 * database's equivalent is empty, so removing it deletes a working feature and replaces it with
 * nothing. `hero_slides` and the four uploads behind them are the officer's own photographs.
 */
async function clearSeedData(tx: typeof prisma): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}

  // First, because `project_documents.file_id` is the one `RESTRICT` in the
  // schema: the stored file cannot go while a document points at it.
  counts.projectDocuments = (await tx.projectDocument.deleteMany({})).count
  // Before the users they hang off — `userId` is `SetNull`, so deleting people
  // first would leave the invented officers on the public archive for ever,
  // detached from anything that says where they came from.
  counts.officerTerms = (await tx.officerTerm.deleteMany({})).count
  counts.posts = (await tx.post.deleteMany({})).count
  counts.sponsors = (await tx.sponsor.deleteMany({})).count
  // Cascades images, links, teams, tasks, task assignees, project members and
  // any project-scoped event.
  counts.projects = (await tx.project.deleteMany({})).count
  // The test rows only. The twelve seeded club events are dated onto the
  // current month and are the only calendar content there is.
  counts.testEvents = (await tx.event.deleteMany({
    where: { slug: { startsWith: 'open-house-' } },
  })).count
  // Cascades sessions, dues payments, member surveys and their answers,
  // password resets and email changes.
  counts.users = (await tx.user.deleteMany({})).count

  return counts
}

/** `/api/files/<id>` is the entire "is this one of ours" test — see `files.ts`. */
const STORED_PREFIX = '/api/files/'

const storedId = (url: string | null): string | null =>
  url?.startsWith(STORED_PREFIX) ? url.slice(STORED_PREFIX.length) : null

/**
 * Uploads nothing points at any more.
 *
 * Computed after the clear rather than before, so the files behind the rows just deleted are
 * included. Every image column holds either an external URL or `/api/files/<id>`, so the
 * references are found by reading the columns rather than by a join — there's no foreign key to
 * follow, which is exactly why these go stale.
 */
async function deleteOrphanFiles(tx: typeof prisma): Promise<number> {
  const referenced = new Set<string>()
  const note = (url: string | null) => {
    const id = storedId(url)

    if (id !== null) referenced.add(id)
  }

  for (const row of await tx.heroSlide.findMany({ select: { url: true } })) note(row.url)
  for (const row of await tx.projectImage.findMany({ select: { url: true } })) note(row.url)
  for (const row of await tx.project.findMany({ select: { coverUrl: true } })) {
    note(row.coverUrl)
  }
  for (const row of await tx.user.findMany({ select: { photoUrl: true } })) {
    note(row.photoUrl)
  }
  for (const row of await tx.sponsor.findMany({ select: { logoUrl: true } })) {
    note(row.logoUrl)
  }
  for (const row of await tx.post.findMany({ select: { coverUrl: true } })) {
    note(row.coverUrl)
  }
  for (const row of await tx.projectDocument.findMany({ select: { fileId: true } })) {
    referenced.add(row.fileId)
  }
  for (const row of await tx.printRequest.findMany({ select: { fileId: true } })) {
    if (row.fileId !== null) referenced.add(row.fileId)
  }

  const { count } = await tx.storedFile.deleteMany({
    where: { id: { notIn: [...referenced] } },
  })

  return count
}

/**
 * Every id in `decisions.ts` names somebody who is actually in the dump.
 *
 * A mistyped uuid is the worst kind of mistake this file can contain, because nothing goes
 * wrong: the drop doesn't happen, the merge doesn't happen, the seat isn't created, and the
 * import reports success. It's only visible as a spam account on the roster months later.
 */
function checkDecisionIds(known: string[]): void {
  const ids = new Set(known)
  const bad: string[] = []
  const check = (id: string, where: string) => {
    if (!ids.has(id)) bad.push(`${where}: ${id}`)
  }

  for (const id of DECISIONS.drop) check(id, 'drop')
  for (const id of DECISIONS.keep) check(id, 'keep')
  for (const [from, into] of Object.entries(DECISIONS.mergeInto)) {
    check(from, 'mergeInto (from)')
    check(into, 'mergeInto (into)')
  }
  for (const id of Object.keys(DECISIONS.handles)) check(id, 'handles')
  for (const id of Object.keys(DECISIONS.seats)) check(id, 'seats')
  for (const id of Object.keys(DECISIONS.overrides)) check(id, 'overrides')

  if (bad.length > 0) {
    throw new Error(`decisions.ts names ${bad.length} id(s) not in the dump:\n  ${bad.join('\n  ')}`)
  }
}

// ------------------------------------------------------------------ the run

async function main(): Promise<void> {
  const tables = parseDump(DUMP)
  const ix = indexes(tables)

  console.log(`read ${DUMP}`)
  console.log(
    `  ${[...tables].filter(([, r]) => r.length > 0).map(([n, r]) => `${n}=${r.length}`).join(' ')}`,
  )

  checkDecisionIds(ix.members.map((m) => m.id!))

  const cases = specialCases(ix.members, ix.roleNames, NOW)
  const dropped = new Set(DECISIONS.drop)
  const merged = new Map(Object.entries(DECISIONS.mergeInto))

  // Map everybody first, then fold the duplicates together, so a merge can see
  // both sides fully resolved rather than half a row.
  const mapped = new Map(
    ix.members
      .filter((m) => !dropped.has(m.id!))
      .map((m) => [m.id!, mapUser(m, ix.roleNames, ix.surveys, NOW)] as const),
  )

  for (const [from, into] of merged) {
    const source = mapped.get(from)
    const target = mapped.get(into)

    if (source === undefined || target === undefined) continue

    mapped.set(into, mergeUsers(target, source))
    mapped.delete(from)
  }

  for (const [id, patch] of Object.entries(DECISIONS.overrides)) {
    const user = mapped.get(id)

    if (user !== undefined) mapped.set(id, { ...user, ...patch })
  }

  for (const [id, handle] of Object.entries(DECISIONS.handles)) {
    const user = mapped.get(id)

    if (user !== undefined) mapped.set(id, { ...user, discordUsername: handle })
  }

  const users = [...mapped.values()]

  // Only people who actually sit on the board are published regardless of
  // dues. Dwight Howard's entry is `NO_TERM` — reviewed, and not an officer —
  // so he is on the roster only if his dues put him there, like anybody else.
  assignSlugs(users, new Set(seatedIds()), NOW)

  const blocking = unresolved(cases, DECISIONS)

  if (!apply) {
    report(cases, users)
    console.log(`\n${blocking.length} blocking case(s) still unanswered.`)
    console.log('Nothing was written. Pass --apply once decisions.ts is complete.')
    return
  }

  if (blocking.length > 0) {
    console.error(`\nRefusing to write: ${blocking.length} blocking case(s) unanswered.\n`)

    for (const c of blocking) console.error(`  ${c.kind}: ${c.detail}`)

    process.exitCode = 1
    return
  }

  await writeEverything(users, ix)
}

async function writeEverything(
  users: MappedUser[],
  ix: ReturnType<typeof indexes>,
): Promise<void> {
  const counts = await prisma.$transaction(
    async (tx) => {
      const rescued = await rescuePayments(tx as typeof prisma)
      const cleared = await clearSeedData(tx as typeof prisma)

      // ---- people
      await tx.user.createMany({
        data: users.map((u) => ({
          slug: u.slug,
          fullName: u.fullName,
          email: u.email,
          discordUsername: u.discordUsername,
          passwordHash: u.passwordHash,
          role: u.role,
          title: u.title,
          photoUrl: u.photoUrl,
          photoFocalX: u.photoFocalX,
          photoFocalY: u.photoFocalY,
          photoZoom: u.photoZoom,
          active: u.active,
          joinedAt: u.joinedAt,
          acknowledgementAcceptedAt: u.acknowledgementAcceptedAt,
          duesPaidThrough: u.duesPaidThrough,
          surveyCompletedAt: u.surveyCompletedAt,
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
        })),
      })

      // The ids are minted by the database, so the old-id-to-new-id map is
      // read back rather than assumed. Keyed on `fullName` + `createdAt`, which
      // is unique across this set — `email` would miss the rows that have none.
      const written = await tx.user.findMany({
        select: { id: true, fullName: true, createdAt: true },
      })
      const idOf = new Map<string, string>()
      const byKey = new Map(
        written.map((w) => [`${w.fullName}\u0000${w.createdAt.toISOString()}`, w.id] as const),
      )

      for (const u of users) {
        const id = byKey.get(`${u.fullName}\u0000${u.createdAt.toISOString()}`)

        if (id !== undefined) idOf.set(u.legacyId, id)
      }

      // A merged-away id still has to resolve. The join tables point at whichever of somebody's
      // two accounts they were signed into at the time, and the half that was folded in has no
      // row of its own any more — so without this, a project membership belonging to the losing
      // half is silently dropped. That's how Yaniel Petrovich came off DayDream and Kelly Breen
      // came off Knightmare on the first run.
      for (const [from, into] of Object.entries(DECISIONS.mergeInto)) {
        const id = idOf.get(into)

        if (id !== undefined) idOf.set(from, id)
      }

      // ---- the two real payments, put back against their new rows
      const emailToId = new Map(
        users.filter((u) => u.email !== null).map((u) => [u.email!, idOf.get(u.legacyId)!]),
      )
      const payments = rescued
        .map((p) => ({ ...p, userId: emailToId.get(p.email) }))
        .filter((p) => p.userId !== undefined)

      await tx.duesPayment.createMany({
        data: payments.map((p) => ({
          userId: p.userId!,
          amountCents: p.amountCents,
          currency: p.currency,
          plan: p.plan as 'SEMESTER' | 'YEAR',
          status: p.status as 'SUCCEEDED',
          termYear: p.termYear,
          termSeason: p.termSeason as Season,
          coversThrough: p.coversThrough,
          stripePaymentIntentId: p.stripePaymentIntentId,
          receiptUrl: p.receiptUrl,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          paidAt: p.paidAt,
        })),
      })

      if (payments.length !== rescued.length) {
        // Loud, because a payment that finds no home means somebody paid and
        // the club has no record of it — and the address it was matched on is a
        // decision in `decisions.ts` that has presumably changed.
        console.warn(
          `dues: ${rescued.length - payments.length} rescued payment(s) matched no imported account`,
        )
      }

      // ---- officer seats
      let terms = 0

      for (const legacyId of seatedIds()) {
        const position = DECISIONS.seats[legacyId]
        const user = users.find((u) => u.legacyId === legacyId)
        const id = idOf.get(legacyId)

        if (user === undefined || id === undefined || position === NO_TERM) continue

        await tx.officerTerm.create({
          data: {
            userId: id,
            // The record, not a cache of the user's name — a term is who held a
            // seat, and it must not change when somebody edits their profile.
            fullName: user.fullName,
            position: position ?? null,
            startedAt: user.joinedAt ?? NOW,
            // `MANUAL`, so the Discord sync never stands them down. The sync
            // only closes what the sync opened, and it did not open these.
            source: OfficerTermSource.MANUAL,
            photoUrl: user.photoUrl,
          },
        })
        terms += 1
      }

      // ---- surveys
      const questions: Question[] = (
        await tx.surveyQuestion.findMany({
          where: { archivedAt: null },
          orderBy: { position: 'asc' },
          select: {
            id: true,
            prompt: true,
            kind: true,
            options: {
              where: { archivedAt: null },
              orderBy: { position: 'asc' },
              select: { id: true, label: true, wantsText: true },
            },
          },
        })
      ).map((q) => ({ ...q, kind: String(q.kind) }))

      let surveys = 0
      let answers = 0

      for (const user of users) {
        if (user.legacySurveyId === null) continue

        const legacy = ix.surveys.get(user.legacySurveyId)
        const id = idOf.get(user.legacyId)

        if (legacy === undefined || id === undefined) continue

        const mappedAnswers = mapSurvey(legacy, questions)

        await tx.memberSurvey.create({
          data: {
            userId: id,
            submittedAt: user.surveyCompletedAt ?? NOW,
            updatedAt: user.surveyCompletedAt ?? NOW,
            answers: {
              create: mappedAnswers.map((a) => ({
                questionId: a.questionId,
                text: a.text,
                picked: { create: a.optionIds.map((optionId) => ({ optionId })) },
              })),
            },
          },
        })

        surveys += 1
        answers += mappedAnswers.length
      }

      // ---- projects
      const projectId = new Map<string, string>()

      for (const legacy of ix.projects) {
        const p = mapProject(legacy, ix.pictures, NOW)
        const created = await tx.project.create({
          data: {
            slug: p.slug,
            title: p.title,
            description: p.description,
            termYear: p.termYear,
            termSeason: p.termSeason as Season,
            season: p.season,
            status: p.status,
            coverUrl: p.coverUrl,
            // The old row's one link, as the resource row it is now rather than
            // the `repoUrl` column it used to be. Nested so a project and its
            // link land together, and skipped entirely for the rows with none —
            // which is what lets `/ RESOURCES` be empty.
            ...(p.docsUrl
              ? { links: { create: { label: 'Documentation', url: p.docsUrl } } }
              : {}),
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          },
          select: { id: true },
        })

        projectId.set(p.legacyId, created.id)
      }

      // ---- who was on them. The old database had no per-project rank: being a "project lead"
      // was a global label everybody carried everywhere, which is the confusion `membership.md`
      // exists to stop. So everyone lands as MEMBER and the leads are set per project afterwards,
      // by a person who knows which project they led.
      const memberships = ix.memberToProject
        .map((row) => ({
          userId: idOf.get(row.A ?? ''),
          projectId: projectId.get(row.B ?? ''),
        }))
        .filter((m): m is { userId: string; projectId: string } =>
          Boolean(m.userId && m.projectId),
        )

      await tx.projectMember.createMany({
        data: memberships.map((m) => ({ ...m, rank: ProjectMemberRank.MEMBER })),
        skipDuplicates: true,
      })

      // ---- project links
      const linkRows = ix.linkToProject
        .map((row, i) => {
          const link = ix.links.get(row.A ?? '')
          const project = projectId.get(row.B ?? '')

          return link && project
            ? {
                projectId: project,
                label: link.label ?? 'Link',
                url: link.url ?? '',
                sortOrder: i,
              }
            : null
        })
        .filter((r) => r !== null)

      await tx.projectLink.createMany({ data: linkRows })

      // ---- sponsors
      let sponsors = 0

      for (const row of ix.sponsors) {
        await tx.sponsor.create({
          data: {
            name: (row.name ?? '').trim(),
            tier: sponsorTierOf(row.tier),
            logoUrl: sponsorLogoOf(row.imageUrl),
            websiteUrl: row.link === '' ? null : row.link,
          },
        })
        sponsors += 1
      }

      // ---- the one article
      let posts = 0

      for (const row of ix.articles) {
        const title = (row.title ?? 'Untitled').trim()
        const published = row.createdAt ? new Date(row.createdAt.replace(' ', 'T') + 'Z') : NOW

        await tx.post.create({
          data: {
            slug: slugify(title),
            title,
            body: row.content ?? '',
            authorId: idOf.get(row.authorId ?? '') ?? null,
            publishedAt: published,
            createdAt: published,
          },
        })
        posts += 1
      }

      const orphanFiles = await deleteOrphanFiles(tx as typeof prisma)

      return {
        cleared,
        users: users.length,
        officerTerms: terms,
        surveys,
        answers,
        projects: projectId.size,
        projectMembers: memberships.length,
        projectLinks: linkRows.length,
        sponsors,
        posts,
        orphanFiles,
      }
    },
    // 700 users, 440 surveys and 53 projects in one transaction. The default
    // five seconds is nowhere near enough and a timeout here rolls the whole
    // thing back, which is the right behaviour but a slow way to find out.
    { timeout: 600_000, maxWait: 30_000 },
  )

  console.log('\nImported:', counts)
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
