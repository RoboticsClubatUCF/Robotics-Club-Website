import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../app.js'
import { prisma } from '../db.js'
import { env } from '../env.js'
import {
  FileKind,
  ProjectMemberRank,
  ProjectStatus,
  Season,
  UserRole,
} from '../generated/prisma/enums.js'
import { notifyOfficers } from '../officerNotify.js'
import { clearCalendarCache } from '../semester.js'
import { createSession } from '../session.js'

// Mocked outright, for the reason `print.test.ts` and `equipment.test.ts` mock
// `../discord.js`: the officers in the development database are real people
// with real Discord ids, and an unmocked run would message them about a fixture
// walking out of a fixture project.
vi.mock('../officerNotify.js', () => ({
  notifyOfficers: vi.fn(() => Promise.resolve()),
}))

// And the same again, one step further: joining, leaving, being ranked and
// having a project deleted all push Discord roles now. That is not a message a
// real person can ignore — it changes what they can see in the club's server —
// and the dev `.env` carries a live bot token. Nothing in this file may reach
// the guild.
vi.mock('../discord.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../discord.js')>()),
  memberRoleId: null,
  projectLeadRoleId: null,
  teamLeadRoleId: null,
  addGuildRole: vi.fn(() => Promise.resolve({ status: 'done' as const })),
  removeGuildRole: vi.fn(() => Promise.resolve({ status: 'done' as const })),
  guildRoster: vi.fn(() => Promise.resolve({ status: 'unchecked' as const })),
  guildRoles: vi.fn(() => Promise.resolve({ status: 'unchecked' as const })),
}))

/**
 * Project lifecycle, against the live database: officers making projects,
 * leads building teams, members joining behind the dues gate.
 *
 * The clock is pinned to **fall 2035**, for the same reason `trialNotice.test.ts`
 * pins its fixtures there: the join gate runs through `membershipStanding`,
 * whose answer depends on today's date — run against the real clock this suite
 * would pass all summer (summer is free) and start failing the day term
 * starts. The calendar fetch is stubbed to fail, so the fixed fallback dates
 * make every term boundary deterministic. Only `Date` is faked; the timers
 * stay real or every await against Postgres would hang.
 */

const PREFIX = 'test-projmgmt-'
const email = (name: string) => `${PREFIX}${name}@ucf.edu`

/** Mid-fall 2035: term running, trial fortnight long over. */
const MID_FALL = new Date(2035, 9, 15, 12, 0, 0)
/** Fall 2035's fallback end is 31 December — paid through covers the term. */
const PAID_THROUGH = new Date(2035, 11, 31)

const clearWindows = () =>
  prisma.rateLimit.deleteMany({
    where: {
      OR: [
        { key: { startsWith: 'manage:' } },
        { key: { startsWith: 'officer:' } },
        { key: { startsWith: 'join:' } },
        { key: { startsWith: 'gallery:' } },
      ],
    },
  })

const clearRows = async () => {
  await prisma.project.deleteMany({ where: { slug: { startsWith: PREFIX } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
}

async function cookieFor(userId: string): Promise<string> {
  const { token } = await createSession(userId)
  return `${env.SESSION_COOKIE_NAME}=${token}`
}

let officerCookie: string
let leadCookie: string
let paidCookie: string
let unpaidCookie: string
let officerId: string
let leadId: string
let paidId: string
let unpaidId: string
let projectId: string
/** A second project the same lead runs, for the cross-project isolation rows. */
let otherProjectId: string

beforeEach(async () => {
  // Pin the clock before anything is created, so the sessions minted below
  // expire in 2035's future rather than 2026's past.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(MID_FALL)

  clearCalendarCache()
  // Offline, deterministically: every term answers with its fallback dates.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('nope', { status: 503 }))),
  )

  await clearWindows()
  await clearRows()

  const [officer, lead, paid, unpaid] = await Promise.all([
    // Both paid up, because running a project needs current dues now — see
    // `requireCurrentDues`. Without a date these two would be locked out of
    // every management route in this file, which is the *right* behaviour and
    // has its own matrix in `authz.test.ts`.
    prisma.user.create({
      data: {
        fullName: 'PM Officer',
        email: email('officer'),
        role: UserRole.OFFICER,
        duesPaidThrough: PAID_THROUGH,
      },
    }),
    prisma.user.create({
      data: {
        fullName: 'PM Lead',
        email: email('lead'),
        role: UserRole.MEMBER,
        duesPaidThrough: PAID_THROUGH,
      },
    }),
    prisma.user.create({
      data: {
        fullName: 'PM Paid',
        email: email('paid'),
        role: UserRole.MEMBER,
        duesPaidThrough: PAID_THROUGH,
      },
    }),
    prisma.user.create({
      data: { fullName: 'PM Unpaid', email: email('unpaid'), role: UserRole.GUEST },
    }),
  ])

  officerId = officer.id
  leadId = lead.id
  paidId = paid.id
  unpaidId = unpaid.id

  const project = await prisma.project.create({
    data: {
      slug: `${PREFIX}rover`,
      title: 'PM Rover',
      // Every project needs a term now. A year nothing real uses, so a
      // fixture can never collide with the club's own rows.
      termYear: 2035,
      termSeason: Season.FALL,
      status: ProjectStatus.IN_PROGRESS,
      members: {
        create: { userId: lead.id, rank: ProjectMemberRank.PROJECT_LEAD },
      },
    },
  })
  projectId = project.id

  const other = await prisma.project.create({
    data: {
      slug: `${PREFIX}rover-two`,
      title: 'PM Rover II',
      termYear: 2035,
      termSeason: Season.FALL,
      status: ProjectStatus.IN_PROGRESS,
      members: {
        create: { userId: lead.id, rank: ProjectMemberRank.PROJECT_LEAD },
      },
    },
  })
  otherProjectId = other.id

  officerCookie = await cookieFor(officer.id)
  leadCookie = await cookieFor(lead.id)
  paidCookie = await cookieFor(paid.id)
  unpaidCookie = await cookieFor(unpaid.id)

  // The officer DM is asserted on by call count, so it has to start each test
  // at zero rather than carrying the previous one's.
  vi.mocked(notifyOfficers).mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  clearCalendarCache()
})

afterAll(async () => {
  await clearWindows()
  await clearRows()
  await prisma.$disconnect()
})

const request = (method: string, path: string, cookie: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      cookie,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

describe('the officer desk', () => {
  /**
   * Creating makes the project and nothing else.
   *
   * The route used to take a `leadUserId` and seat the lead inside the same
   * write; appointing moved to the roles desk so there is one route that grants
   * that rank instead of two. An empty roster is the correct outcome, not a
   * missing step — the board agrees to run something before it has settled who
   * runs it.
   */
  it('creates a project with nobody on it', async () => {
    const response = await request('POST', '/api/officer/projects', officerCookie, {
      slug: `${PREFIX}new-build`,
      title: 'New Build',
      summary: 'A thing',
    })

    expect(response.status).toBe(201)
    const project = (await response.json()) as { id: string }

    expect(
      await prisma.projectMember.count({ where: { projectId: project.id } }),
    ).toBe(0)
  })

  it('refuses a slug that is already a project', async () => {
    const response = await request('POST', '/api/officer/projects', officerCookie, {
      slug: `${PREFIX}rover`,
      title: 'Duplicate',
      summary: 'A thing',
    })

    expect(response.status).toBe(409)
  })

  /**
   * The summary is the one line the projects list prints under a title, so a
   * project without one is an empty row on the page people read before they
   * decide to join. Required at the schema, which is why this is a 400 and not
   * something the handler has to remember.
   */
  it('refuses a project with no summary', async () => {
    const response = await request('POST', '/api/officer/projects', officerCookie, {
      slug: `${PREFIX}no-summary`,
      title: 'Nameless',
      leadUserId: paidId,
    })

    expect(response.status).toBe(400)
  })

  /**
   * The write-up and the repository go up *with* the project, because neither
   * needs it to exist first — unlike a gallery picture or a resource link,
   * which hang off its id. That is what lets the desk put the whole form on one
   * page and gate only the two things that genuinely cannot be filled in yet.
   */
  it('stores the write-up and the repository given at creation', async () => {
    const response = await request('POST', '/api/officer/projects', officerCookie, {
      slug: `${PREFIX}written`,
      title: 'Written Up',
      summary: 'A thing',
      description: 'Two years of chassis work.\n\nAnd a second paragraph.',
      repoUrl: 'https://github.com/rccf/rover',
    })

    expect(response.status).toBe(201)
    const project = (await response.json()) as { id: string }

    const stored = await prisma.project.findUnique({ where: { id: project.id } })
    expect(stored?.description).toBe(
      'Two years of chassis work.\n\nAnd a second paragraph.',
    )
    expect(stored?.repoUrl).toBe('https://github.com/rccf/rover')
  })

  /**
   * A project with no lead yet is a normal state. The board agreeing to run
   * something and the board settling who runs it are two decisions, often a
   * week apart, and making the first wait on the second gets a project a lead
   * who was picked to unblock a form.
   */
  it('creates a project with no lead at all', async () => {
    const response = await request('POST', '/api/officer/projects', officerCookie, {
      slug: `${PREFIX}unled`,
      title: 'Waiting On A Lead',
      summary: 'A thing',
    })

    expect(response.status).toBe(201)
    const project = (await response.json()) as { id: string }
    expect(
      await prisma.projectMember.count({ where: { projectId: project.id } }),
    ).toBe(0)
  })

  /**
   * Seating a lead is a fact about the membership row and nothing else.
   *
   * It used to also stamp a matching `PROJECT_LEAD` label on `User.role`, which
   * is the duplication the two-role-systems refactor removed. This test is what
   * would catch somebody rebuilding it.
   */
  it('seats the lead without touching what they are in the club', async () => {
    const response = await request('POST', '/api/officer/projects', officerCookie, {
      slug: `${PREFIX}seating`,
      title: 'Seating',
      summary: 'A thing',
    })

    const project = (await response.json()) as { id: string }

    await request(
      'PATCH',
      `/api/officer/projects/${project.id}/members/${paidId}/rank`,
      officerCookie,
      { rank: 'PROJECT_LEAD' },
    )

    const after = await prisma.user.findUnique({ where: { id: paidId } })
    expect(after?.role).toBe(UserRole.MEMBER)
  })

  /**
   * The case that would once have been a quiet disaster: an officer taking a
   * build on themselves and being demoted off the board by the act of doing it.
   * Nothing here writes `User.role` at all now, so it holds by construction
   * rather than by a guard — and this is the test that says so.
   */
  it('does not demote an officer who makes themselves the lead', async () => {
    const response = await request('POST', '/api/officer/projects', officerCookie, {
      slug: `${PREFIX}mine`,
      title: 'My Own Build',
      summary: 'A thing',
    })

    expect(response.status).toBe(201)
    const project = (await response.json()) as { id: string }

    await request(
      'PATCH',
      `/api/officer/projects/${project.id}/members/${officerId}/rank`,
      officerCookie,
      { rank: 'PROJECT_LEAD' },
    )

    const seat = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: officerId } },
    })
    expect(seat?.rank).toBe(ProjectMemberRank.PROJECT_LEAD)

    const after = await prisma.user.findUnique({ where: { id: officerId } })
    expect(after?.role).toBe(UserRole.OFFICER)
  })

  it('keeps an officer an officer when appointed lead of an existing project', async () => {
    await request(
      'PATCH',
      `/api/officer/projects/${projectId}/members/${officerId}/rank`,
      officerCookie,
      { rank: 'PROJECT_LEAD' },
    )

    const after = await prisma.user.findUnique({ where: { id: officerId } })
    expect(after?.role).toBe(UserRole.OFFICER)
  })

  it('stands somebody down without touching what they are in the club', async () => {
    await request(
      'PATCH',
      `/api/officer/projects/${otherProjectId}/members/${paidId}/rank`,
      officerCookie,
      { rank: 'PROJECT_LEAD' },
    )
    expect((await prisma.user.findUnique({ where: { id: paidId } }))?.role).toBe(
      UserRole.MEMBER,
    )

    await request(
      'PATCH',
      `/api/officer/projects/${otherProjectId}/members/${paidId}/rank`,
      officerCookie,
      { rank: 'MEMBER' },
    )

    expect((await prisma.user.findUnique({ where: { id: paidId } }))?.role).toBe(
      UserRole.MEMBER,
    )
  })
})

/**
 * A project has one lead.
 *
 * The rule is enforced by this route rather than by a database index — Prisma
 * cannot express a partial unique index, so one would live in the database and
 * not in `schema.prisma`, and the next generated migration would emit a DROP
 * for it. That makes these tests the only thing holding the invariant up.
 */
describe('one project lead per project', () => {
  it('refuses a second, and names the one already sitting there', async () => {
    const response = await request(
      'PATCH',
      `/api/officer/projects/${projectId}/members/${paidId}/rank`,
      officerCookie,
      { rank: 'PROJECT_LEAD' },
    )

    expect(response.status).toBe(409)
    // Named, because standing that particular person down is the next thing
    // the officer has to do and a generic refusal would not say who.
    expect(((await response.json()) as { error: string }).error).toMatch(
      /PM Lead already leads this project/i,
    )

    expect(
      await prisma.projectMember.count({
        where: { projectId, rank: ProjectMemberRank.PROJECT_LEAD },
      }),
    ).toBe(1)
  })

  /** Nobody conflicts with themselves. */
  it('lets the sitting lead be re-appointed', async () => {
    const response = await request(
      'PATCH',
      `/api/officer/projects/${projectId}/members/${leadId}/rank`,
      officerCookie,
      { rank: 'PROJECT_LEAD' },
    )

    expect(response.status).toBe(200)
    expect(
      await prisma.projectMember.count({
        where: { projectId, rank: ProjectMemberRank.PROJECT_LEAD },
      }),
    ).toBe(1)
  })

  /** The two-step the 409's wording tells an officer to take has to work. */
  it('appoints once the incumbent is stood down', async () => {
    await request(
      'PATCH',
      `/api/officer/projects/${projectId}/members/${leadId}/rank`,
      officerCookie,
      { rank: 'MEMBER' },
    )

    const response = await request(
      'PATCH',
      `/api/officer/projects/${projectId}/members/${paidId}/rank`,
      officerCookie,
      { rank: 'PROJECT_LEAD' },
    )
    expect(response.status).toBe(200)

    const leads = await prisma.projectMember.findMany({
      where: { projectId, rank: ProjectMemberRank.PROJECT_LEAD },
      select: { userId: true },
    })
    expect(leads).toEqual([{ userId: paidId }])
  })

  /** Two projects, two leads. The cap is per project, not per person. */
  it('does not stop somebody leading a second project', async () => {
    const response = await request(
      'PATCH',
      `/api/officer/projects/${otherProjectId}/members/${paidId}/rank`,
      officerCookie,
      { rank: 'PROJECT_LEAD' },
    )

    // `lead` already holds the seat on `otherProjectId` from the fixtures, so
    // this is the ordinary conflict — swap them and the point still stands.
    expect(response.status).toBe(409)

    await request(
      'PATCH',
      `/api/officer/projects/${otherProjectId}/members/${leadId}/rank`,
      officerCookie,
      { rank: 'MEMBER' },
    )
    const retry = await request(
      'PATCH',
      `/api/officer/projects/${otherProjectId}/members/${paidId}/rank`,
      officerCookie,
      { rank: 'PROJECT_LEAD' },
    )
    expect(retry.status).toBe(200)

    // `lead` still runs the first project. Losing one seat is not losing both.
    const stillLeads = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: leadId } },
    })
    expect(stillLeads?.rank).toBe(ProjectMemberRank.PROJECT_LEAD)
  })
})

/**
 * Creating a project is officer business and nothing else opens that door.
 *
 * A `PROJECT_LEAD` roster label used to buy the right to start a single project
 * of your own — the one place a `UserRole` value said anything about projects.
 * The label is not a role any more and the delegation went with it.
 */
describe('creating a project', () => {
  const ownProject = {
    slug: `${PREFIX}my-build`,
    title: 'My Build',
    summary: 'A thing I want to run.',
  }

  it.each([
    ['a project lead, on their own project', () => leadCookie],
    ['a plain member', () => paidCookie],
  ])('refuses %s', async (_who, cookie) => {
    const response = await request(
      'POST',
      '/api/officer/projects',
      cookie(),
      ownProject,
    )

    expect(response.status).toBe(403)
  })

  /**
   * The field is gone, and a body still carrying it seats nobody.
   *
   * Zod strips what it does not declare rather than refusing it, so an old
   * client — or a hand-written request copied from the previous shape — gets a
   * 201 and an empty roster. That is the right answer and worth pinning: the
   * failure this guards against is somebody re-adding `leadUserId` to the
   * schema and quietly restoring a second route that grants `PROJECT_LEAD`.
   */
  it('ignores a lead named at creation', async () => {
    const response = await request(
      'POST',
      '/api/officer/projects',
      officerCookie,
      { ...ownProject, leadUserId: paidId },
    )

    expect(response.status).toBe(201)
    const project = (await response.json()) as { id: string }

    expect(
      await prisma.projectMember.count({ where: { projectId: project.id } }),
    ).toBe(0)
  })
})

/** The appointment panel, and the picker that feeds it. */
describe('appointing a project lead', () => {
  /**
   * The upsert arm: somebody an officer appoints has often never joined through
   * the site, and appointing them *is* how they land on the project. Run against
   * a project with the seat free, since a project has one lead and appointing
   * over a sitting one is its own test.
   */
  it('appoints a lead who was never a member, by making them one', async () => {
    const empty = await prisma.project.create({
      data: {
        slug: `${PREFIX}unled`,
        title: 'PM Unled',
        termYear: 2035,
        termSeason: Season.FALL,
        status: ProjectStatus.IN_PROGRESS,
      },
    })

    const response = await request(
      'PATCH',
      `/api/officer/projects/${empty.id}/members/${paidId}/rank`,
      officerCookie,
      { rank: 'PROJECT_LEAD' },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ rank: 'PROJECT_LEAD' })
  })

  /**
   * Discord is where the club actually talks, and an account may carry a handle
   * and no email at all — until this arm existed those people could not be
   * found by the picker that appoints project leads.
   */
  it('finds a member by their Discord handle as well as their name', async () => {
    const handle = `${PREFIX}rowan_c`
    await prisma.user.update({
      where: { id: paidId },
      data: { discordUsername: handle },
    })

    const byHandle = await request(
      'GET',
      `/api/officer/members?query=${encodeURIComponent(handle)}`,
      officerCookie,
    )

    expect(byHandle.status).toBe(200)
    const hits = (await byHandle.json()) as {
      id: string
      discordUsername: string | null
    }[]
    expect(hits.map((hit) => hit.id)).toContain(paidId)
    // And the handle comes back, so the picker can print it under the email.
    expect(hits.find((hit) => hit.id === paidId)?.discordUsername).toBe(handle)
  })

  it('matches a handle case-insensitively, on part of it', async () => {
    await prisma.user.update({
      where: { id: paidId },
      data: { discordUsername: `${PREFIX}Rowan_C` },
    })

    const response = await request(
      'GET',
      `/api/officer/members?query=${encodeURIComponent(`${PREFIX}rowan`)}`,
      officerCookie,
    )

    expect(((await response.json()) as { id: string }[]).map((h) => h.id)).toContain(
      paidId,
    )
  })

  it('demotes a lead back to member', async () => {
    const response = await request(
      'PATCH',
      `/api/officer/projects/${projectId}/members/${leadId}/rank`,
      officerCookie,
      { rank: 'MEMBER' },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ rank: 'MEMBER' })
  })
})

describe('joining a project', () => {
  it('lets a paid-up member in', async () => {
    const response = await request(
      'POST',
      `/api/projects/${projectId}/join`,
      paidCookie,
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ rank: 'MEMBER' })
  })

  it('turns away somebody whose dues have lapsed, in words about dues', async () => {
    const response = await request(
      'POST',
      `/api/projects/${projectId}/join`,
      unpaidCookie,
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('dues'),
    })
  })

  /**
   * And *not* in words about dues while the club is charging nothing.
   *
   * This route used to read `hasAccess` itself and throw its own sentence,
   * which was fine while "no cover" meant one thing. It means three now, and
   * the hardcoded one told somebody inside a free window to settle dues they
   * did not owe for a thing that was one free press away. It defers to
   * `requireCurrentDues`, so the sentence follows the date — asserted by moving
   * the clock into the August gap rather than by moving the fixture, because
   * the window is a property of the calendar.
   */
  it('tells somebody inside a free window to claim it instead', async () => {
    vi.setSystemTime(new Date(2035, 7, 15, 12, 0, 0))

    try {
      const response = await request(
        'POST',
        `/api/projects/${projectId}/join`,
        unpaidCookie,
      )

      expect(response.status).toBe(403)
      const { error } = (await response.json()) as { error: string }
      expect(error).toMatch(/free right now/i)
      expect(error).not.toMatch(/lapsed/i)
    } finally {
      vi.setSystemTime(MID_FALL)
    }
  })

  it('answers a second join with a conflict, not a duplicate row', async () => {
    await request('POST', `/api/projects/${projectId}/join`, paidCookie)
    const again = await request('POST', `/api/projects/${projectId}/join`, paidCookie)

    expect(again.status).toBe(409)
    expect(
      await prisma.projectMember.count({
        where: { projectId, userId: paidId },
      }),
    ).toBe(1)
  })

  it('refuses a project that is not in progress', async () => {
    await prisma.project.update({
      where: { id: projectId },
      data: { status: ProjectStatus.COMPLETED },
    })

    const response = await request(
      'POST',
      `/api/projects/${projectId}/join`,
      paidCookie,
    )

    expect(response.status).toBe(409)
  })

  it('lets a member leave', async () => {
    await request('POST', `/api/projects/${projectId}/join`, paidCookie)

    const response = await request(
      'DELETE',
      `/api/projects/${projectId}/members/me`,
      paidCookie,
    )

    expect(response.status).toBe(200)
    expect(
      await prisma.projectMember.count({ where: { projectId, userId: paidId } }),
    ).toBe(0)
  })

  /**
   * This used to be a 409 telling the only lead to ask an officer to appoint
   * another first — an instruction nobody can follow now a project has exactly
   * one lead, because there is no second seat to appoint anybody into while
   * they still hold the first. So they go, and the project is left leaderless,
   * which is a state the board sits in anyway between agreeing to run something
   * and settling who runs it.
   */
  it('lets the only lead walk out, leaving the project leaderless', async () => {
    const response = await request(
      'DELETE',
      `/api/projects/${projectId}/members/me`,
      leadCookie,
    )

    expect(response.status).toBe(200)
    expect(
      await prisma.projectMember.count({
        where: { projectId, rank: ProjectMemberRank.PROJECT_LEAD },
      }),
    ).toBe(0)
  })
})

/**
 * Leaving a project changes what you *run*, never what you *are*.
 *
 * This block used to be called "leaving, and what it costs", and it cost a
 * roster label: walking out of your last lead seat rewrote `User.role`. Two
 * enums spelled the same thing and a whole file existed to keep them in step.
 * Now nothing about a project touches that column, and these rows are what
 * would catch it coming back.
 */
describe('leaving, and what it does not cost', () => {
  /**
   * Straight to the database rather than through the appointment route, and the
   * existing lead is stood down first — otherwise seating a second one would
   * build a state the site itself refuses, which is not a state worth asserting
   * anything about.
   */
  const seat = async (
    userId: string,
    rank: ProjectMemberRank,
    project = projectId,
  ) => {
    if (rank === ProjectMemberRank.PROJECT_LEAD) {
      await prisma.projectMember.updateMany({
        where: {
          projectId: project,
          rank: ProjectMemberRank.PROJECT_LEAD,
          userId: { not: userId },
        },
        data: { rank: ProjectMemberRank.MEMBER },
      })
    }

    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project, userId } },
      update: { rank },
      create: { projectId: project, userId, rank },
    })
  }

  const roleOf = async (userId: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).role

  const leave = (cookie: string, project = projectId) =>
    request('DELETE', `/api/projects/${project}/members/me`, cookie)

  it.each([
    ['a project lead', ProjectMemberRank.PROJECT_LEAD],
    ['a team lead', ProjectMemberRank.TEAM_LEAD],
    ['a plain member', ProjectMemberRank.MEMBER],
  ])('leaves %s a MEMBER of the club', async (_who, rank) => {
    await seat(paidId, rank, otherProjectId)

    const response = await leave(paidCookie, otherProjectId)

    expect(response.status).toBe(200)
    expect(await roleOf(paidId)).toBe(UserRole.MEMBER)
  })

  /** A lapsed account is the sweep's business and not this route's. */
  it('leaves a lapsed leaver exactly as lapsed as they were', async () => {
    await seat(unpaidId, ProjectMemberRank.PROJECT_LEAD, otherProjectId)

    const response = await leave(unpaidCookie, otherProjectId)

    expect(response.status).toBe(200)
    expect(await roleOf(unpaidId)).toBe(UserRole.GUEST)
  })

  /**
   * The row that mattered most when leaving *did* write roles, and still worth
   * keeping: an officer holds their role for reasons that have nothing to do
   * with any project.
   */
  it('never touches an officer who was running a build', async () => {
    await seat(officerId, ProjectMemberRank.PROJECT_LEAD, otherProjectId)

    await leave(officerCookie, otherProjectId)

    expect(await roleOf(officerId)).toBe(UserRole.OFFICER)
  })

  /**
   * The whole lifecycle in one row, which is the clearest single statement of
   * the model: join, be made a lead, be stood down, walk out — and be a club
   * `MEMBER` at every one of those points, because none of it is about the club.
   */
  it('keeps the club role inert across the whole lifecycle', async () => {
    const expectMember = async () =>
      expect(await roleOf(paidId)).toBe(UserRole.MEMBER)

    await request('POST', `/api/projects/${otherProjectId}/join`, paidCookie)
    await expectMember()

    await request(
      'PATCH',
      `/api/officer/projects/${otherProjectId}/members/${leadId}/rank`,
      officerCookie,
      { rank: 'MEMBER' },
    )
    await request(
      'PATCH',
      `/api/officer/projects/${otherProjectId}/members/${paidId}/rank`,
      officerCookie,
      { rank: 'PROJECT_LEAD' },
    )
    await expectMember()

    await request(
      'PATCH',
      `/api/officer/projects/${otherProjectId}/members/${paidId}/rank`,
      officerCookie,
      { rank: 'MEMBER' },
    )
    await expectMember()

    await leave(paidCookie, otherProjectId)
    await expectMember()
  })

  /** The response carried the new role for the browser to refresh. It has none. */
  it('answers with nothing but the fact that they left', async () => {
    await seat(paidId, ProjectMemberRank.PROJECT_LEAD, otherProjectId)

    const response = await leave(paidCookie, otherProjectId)

    expect(await response.json()).toEqual({ left: true })
  })

  /**
   * Nobody but an officer can run a leaderless project, so somebody has to be
   * told. Best-effort on purpose — the DM is fired and not awaited, because a
   * member's departure must not depend on Discord being up — which is why these
   * assertions wait on the mock rather than on the response.
   */
  describe('when it leaves the project with no lead', () => {
    it('tells the officers, naming the project', async () => {
      await leave(leadCookie)

      await vi.waitFor(() => {
        expect(notifyOfficers).toHaveBeenCalledTimes(1)
      })
      expect(vi.mocked(notifyOfficers).mock.calls[0][0]).toContain('PM Rover')
    })

    it.each([
      ['a plain member', ProjectMemberRank.MEMBER],
      ['a team lead', ProjectMemberRank.TEAM_LEAD],
    ])('says nothing when %s leaves', async (_who, rank) => {
      await seat(paidId, rank)

      await leave(paidCookie)

      expect(notifyOfficers).not.toHaveBeenCalled()
      // And the lead is still where they were.
      expect(
        await prisma.projectMember.count({
          where: { projectId, rank: ProjectMemberRank.PROJECT_LEAD },
        }),
      ).toBe(1)
    })
  })
})

describe('the gallery', () => {
  const addImage = (cookie: string, url = 'https://example.test/a.png') =>
    request('POST', `/api/projects/${projectId}/images`, cookie, { url })

  it('lets the project lead add a picture by URL', async () => {
    const response = await addImage(leadCookie)

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      url: 'https://example.test/a.png',
      caption: null,
    })
  })

  /**
   * A gallery assembled on the create page is framed before there is a project
   * to attach it to, so the framing arrives *with* the picture. Otherwise
   * publishing that draft would be two requests each, the second of which could
   * fail alone and leave a photo sitting visibly wrong.
   */
  it('takes framing given at the moment a picture is added', async () => {
    const response = await request(
      'POST',
      `/api/projects/${projectId}/images`,
      leadCookie,
      { url: 'https://example.test/framed.png', focalX: 20, focalY: 80, zoom: 2 },
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ focalX: 20, focalY: 80, zoom: 2 })
  })

  /** Left off means the column defaults, not zeroes written over them. */
  it('centres a picture that arrives without framing', async () => {
    expect(await (await addImage(leadCookie)).json()).toMatchObject({
      focalX: 50,
      focalY: 50,
      zoom: 1,
    })
  })

  /** Officers pass on the role alone — no membership row on this project. */
  it('lets an officer add to a project they are not on', async () => {
    const response = await addImage(officerCookie)
    expect(response.status).toBe(201)
  })

  it('refuses a paid-up member who is not a lead', async () => {
    await request('POST', `/api/projects/${projectId}/join`, paidCookie)

    const response = await addImage(paidCookie)
    expect(response.status).toBe(403)
  })

  it('refuses a lead whose dues have lapsed, in words about dues', async () => {
    await prisma.user.update({
      where: { id: leadId },
      data: { duesPaidThrough: new Date(2035, 0, 31) },
    })

    const response = await addImage(leadCookie)

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/dues have lapsed/i),
    })
  })

  /** The cap is the club's, and the refusal says the number rather than "too many". */
  it('refuses the thirteenth picture', async () => {
    await prisma.projectImage.createMany({
      data: Array.from({ length: 12 }, (_, index) => ({
        projectId,
        url: `https://example.test/${index}.png`,
        sortOrder: index,
      })),
    })

    const response = await addImage(leadCookie)

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('12'),
    })
  })

  it('appends new pictures to the end', async () => {
    await addImage(leadCookie, 'https://example.test/first.png')
    await addImage(leadCookie, 'https://example.test/second.png')

    const images = await prisma.projectImage.findMany({
      where: { projectId },
      orderBy: { sortOrder: 'asc' },
    })
    expect(images.map((image) => image.url)).toEqual([
      'https://example.test/first.png',
      'https://example.test/second.png',
    ])
  })

  it('rewrites the order, and the public page reads back in it', async () => {
    const created = await Promise.all(
      ['a', 'b', 'c'].map(async (name) => {
        const response = await addImage(leadCookie, `https://example.test/${name}.png`)
        return (await response.json()) as { id: string; url: string }
      }),
    )

    const reversed = created.map((image) => image.id).reverse()
    const response = await request(
      'PATCH',
      `/api/projects/${projectId}/images/order`,
      leadCookie,
      { ids: reversed },
    )

    expect(response.status).toBe(200)
    expect(((await response.json()) as { id: string }[]).map((i) => i.id)).toEqual(
      reversed,
    )

    const detail = await app.request(`/api/projects/${PREFIX}rover`)
    const body = (await detail.json()) as { images: { id: string }[] }
    expect(body.images.map((image) => image.id)).toEqual(reversed)
  })

  /**
   * The lost-update guard. Without it, a tab that loaded the gallery before a
   * second picture was added would quietly drop it on the next reorder.
   */
  it('refuses an order whose ids are not exactly the gallery', async () => {
    const first = (await (await addImage(leadCookie, 'https://example.test/1.png')).json()) as {
      id: string
    }
    await addImage(leadCookie, 'https://example.test/2.png')

    const response = await request(
      'PATCH',
      `/api/projects/${projectId}/images/order`,
      leadCookie,
      { ids: [first.id] },
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/changed while you were editing/i),
    })
  })

  it('edits a caption', async () => {
    const image = (await (await addImage(leadCookie)).json()) as { id: string }

    const response = await request(
      'PATCH',
      `/api/projects/${projectId}/images/${image.id}`,
      leadCookie,
      { caption: 'Chassis, week four' },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ caption: 'Chassis, week four' })
  })

  /** A new picture is framed the way `object-cover` already framed it. */
  it('starts centred and unzoomed', async () => {
    const response = await addImage(leadCookie)

    expect(await response.json()).toMatchObject({
      focalX: 50,
      focalY: 50,
      zoom: 1,
    })
  })

  it('saves the framing, and the public page reads it back', async () => {
    const image = (await (await addImage(leadCookie)).json()) as { id: string }

    const response = await request(
      'PATCH',
      `/api/projects/${projectId}/images/${image.id}`,
      leadCookie,
      { focalX: 25.5, focalY: 12, zoom: 2.5 },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      focalX: 25.5,
      focalY: 12,
      zoom: 2.5,
    })

    const detail = await app.request(`/api/projects/${PREFIX}rover`)
    const body = (await detail.json()) as {
      images: { id: string; focalX: number; zoom: number }[]
    }
    expect(body.images.find((row) => row.id === image.id)).toMatchObject({
      focalX: 25.5,
      zoom: 2.5,
    })
  })

  /**
   * The one that would go wrong quietly: a caption edit must not re-centre a
   * picture somebody framed, and a framing edit must not wipe their caption.
   * That is only true because no field in the schema carries a `.default()`.
   */
  it('leaves the fields a patch did not mention alone', async () => {
    const image = (await (await addImage(leadCookie)).json()) as { id: string }
    const path = `/api/projects/${projectId}/images/${image.id}`

    await request('PATCH', path, leadCookie, { focalX: 10, focalY: 90, zoom: 3 })
    await request('PATCH', path, leadCookie, { caption: 'Only the caption' })

    const after = await prisma.projectImage.findUniqueOrThrow({
      where: { id: image.id },
    })
    expect(after).toMatchObject({
      caption: 'Only the caption',
      focalX: 10,
      focalY: 90,
      zoom: 3,
    })

    await request('PATCH', path, leadCookie, { zoom: 1 })

    const later = await prisma.projectImage.findUniqueOrThrow({
      where: { id: image.id },
    })
    expect(later).toMatchObject({ caption: 'Only the caption', focalX: 10, zoom: 1 })
  })

  it('refuses framing outside the frame', async () => {
    const image = (await (await addImage(leadCookie)).json()) as { id: string }
    const path = `/api/projects/${projectId}/images/${image.id}`

    for (const body of [{ focalX: -1 }, { focalY: 101 }, { zoom: 0.5 }, { zoom: 9 }]) {
      const response = await request('PATCH', path, leadCookie, body)
      expect(response.status, JSON.stringify(body)).toBe(400)
    }
  })

  it('removes a picture', async () => {
    const image = (await (await addImage(leadCookie)).json()) as { id: string }

    const response = await request(
      'DELETE',
      `/api/projects/${projectId}/images/${image.id}`,
      leadCookie,
    )

    expect(response.status).toBe(200)
    expect(await prisma.projectImage.count({ where: { projectId } })).toBe(0)
  })

  /**
   * Matched on the pair, not on the id alone — otherwise the lead of one
   * project could aim a delete at another project's gallery and the id would be
   * the only thing standing in the way.
   */
  it('404s an image id that belongs to another project', async () => {
    const stray = await prisma.projectImage.create({
      data: { projectId: otherProjectId, url: 'https://example.test/stray.png' },
    })

    const response = await request(
      'DELETE',
      `/api/projects/${projectId}/images/${stray.id}`,
      leadCookie,
    )

    expect(response.status).toBe(404)
    expect(
      await prisma.projectImage.count({ where: { id: stray.id } }),
    ).toBe(1)
  })
})

describe('the resource links', () => {
  const setLinks = (cookie: string, links: { label: string; url: string }[]) =>
    request('PATCH', `/api/projects/${projectId}/links`, cookie, { links })

  it('replaces the whole set, in the order it was given', async () => {
    const response = await setLinks(leadCookie, [
      { label: 'Design doc', url: 'https://example.test/doc' },
      { label: 'CAD', url: 'https://example.test/cad' },
    ])

    expect(response.status).toBe(200)
    expect(((await response.json()) as { label: string }[]).map((l) => l.label)).toEqual(
      ['Design doc', 'CAD'],
    )
  })

  it('replaces rather than appends', async () => {
    await setLinks(leadCookie, [{ label: 'Old', url: 'https://example.test/old' }])
    await setLinks(leadCookie, [{ label: 'New', url: 'https://example.test/new' }])

    const links = await prisma.projectLink.findMany({ where: { projectId } })
    expect(links.map((link) => link.label)).toEqual(['New'])
  })

  it('clears the list on an empty array', async () => {
    await setLinks(leadCookie, [{ label: 'Doc', url: 'https://example.test/doc' }])

    const response = await setLinks(leadCookie, [])

    expect(response.status).toBe(200)
    expect(await prisma.projectLink.count({ where: { projectId } })).toBe(0)
  })

  it('refuses the eleventh link', async () => {
    const response = await setLinks(
      leadCookie,
      Array.from({ length: 11 }, (_, index) => ({
        label: `Link ${index}`,
        url: `https://example.test/${index}`,
      })),
    )

    expect(response.status).toBe(400)
    expect(await prisma.projectLink.count({ where: { projectId } })).toBe(0)
  })

  it('refuses a member who is not a lead', async () => {
    await request('POST', `/api/projects/${projectId}/join`, paidCookie)

    const response = await setLinks(paidCookie, [
      { label: 'Doc', url: 'https://example.test/doc' },
    ])

    expect(response.status).toBe(403)
  })
})

describe('teams, through their lifecycle', () => {
  it('creates, renames, and refuses a name collision', async () => {
    const created = await request(
      'POST',
      `/api/projects/${projectId}/teams`,
      leadCookie,
      { name: 'Chassis' },
    )
    expect(created.status).toBe(201)
    const team = (await created.json()) as { id: string }

    const renamed = await request('PATCH', `/api/teams/${team.id}`, leadCookie, {
      name: 'Chassis & Drive',
    })
    expect(renamed.status).toBe(200)

    const second = await request(
      'POST',
      `/api/projects/${projectId}/teams`,
      leadCookie,
      { name: 'Chassis & Drive' },
    )
    expect(second.status).toBe(409)
  })

  /**
   * Deleting a team is the delicate one: the composite FK is RESTRICT, so the
   * route has to detach the seated members itself — and a TEAM_LEAD rank left
   * behind with no team would quietly attach to whatever team its holder
   * joined next.
   */
  it('deleting a team detaches its members and retires its lead rank', async () => {
    const team = await prisma.team.create({
      data: { projectId, name: 'Doomed' },
    })
    await prisma.projectMember.createMany({
      data: [
        { projectId, userId: paidId, rank: ProjectMemberRank.TEAM_LEAD, teamId: team.id },
        { projectId, userId: unpaidId, teamId: team.id },
      ],
    })

    const response = await request('DELETE', `/api/teams/${team.id}`, leadCookie)
    expect(response.status).toBe(200)

    const rows = await prisma.projectMember.findMany({
      where: { projectId, userId: { in: [paidId, unpaidId] } },
    })
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.teamId).toBeNull()
      expect(row.rank).not.toBe(ProjectMemberRank.TEAM_LEAD)
    }
  })
})

describe('deleting a project', () => {
  it('takes its teams and memberships with it, and nothing else', async () => {
    const team = await prisma.team.create({ data: { projectId, name: 'Along' } })
    await prisma.projectMember.create({
      data: { projectId, userId: paidId, teamId: team.id },
    })

    const response = await request('DELETE', `/api/projects/${projectId}`, leadCookie)
    expect(response.status).toBe(200)

    expect(await prisma.project.findUnique({ where: { id: projectId } })).toBeNull()
    expect(await prisma.team.count({ where: { projectId } })).toBe(0)
    expect(await prisma.projectMember.count({ where: { projectId } })).toBe(0)
    // The people themselves are untouched.
    expect(await prisma.user.findUnique({ where: { id: paidId } })).not.toBeNull()
  })
})

/**
 * `PATCH /api/projects/:id` is what the public page's editor saves through, and
 * that editor does not re-read the project afterwards — `/projects/:slug` is a
 * publicly cached route, so a read taken straight after a write can honestly
 * answer with the copy from before it. What comes back from the write *is* the
 * editor's new state, which makes the response shape part of this route's
 * contract rather than an implementation detail.
 */
describe('editing the writing', () => {
  it('answers with every column it was given, the write-up included', async () => {
    const response = await request('PATCH', `/api/projects/${projectId}`, leadCookie, {
      title: 'PM Rover Renamed',
      summary: 'A rover, described in one line.',
      description: 'Two years of chassis work.\n\nAnd a second paragraph.',
      season: '2035-2036',
      competition: 'UNIVERSITY ROVER CHALLENGE',
      repoUrl: 'https://github.com/rccf/rover',
    })

    expect(response.status).toBe(200)
    // `description` is the one that has been missing: absent from the response,
    // it lands in the editor as `undefined`, blanks the write-up on screen and
    // leaves the form permanently dirty — a save that looks like it failed.
    expect(await response.json()).toMatchObject({
      title: 'PM Rover Renamed',
      summary: 'A rover, described in one line.',
      description: 'Two years of chassis work.\n\nAnd a second paragraph.',
      season: '2035-2036',
      competition: 'UNIVERSITY ROVER CHALLENGE',
      repoUrl: 'https://github.com/rccf/rover',
    })
  })

  /**
   * Not every project is built for a competition, so the column is nullable and
   * emptying the box has to clear it — in the row *and* in the answer, or the
   * editor puts the old name straight back on screen.
   */
  it('clears the competition when the box is emptied', async () => {
    await prisma.project.update({
      where: { id: projectId },
      data: { competition: 'UNIVERSITY ROVER CHALLENGE', season: '2035-2036' },
    })

    const response = await request('PATCH', `/api/projects/${projectId}`, leadCookie, {
      competition: null,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      competition: null,
      // Untouched: a patch says nothing about the columns it leaves out.
      season: '2035-2036',
    })

    const stored = await prisma.project.findUnique({ where: { id: projectId } })
    expect(stored?.competition).toBeNull()
  })

  it('creates a project with no competition at all', async () => {
    const response = await request('POST', '/api/officer/projects', officerCookie, {
      slug: `${PREFIX}no-comp`,
      title: 'Not A Competition',
      summary: 'A club build, for its own sake.',
    })

    expect(response.status).toBe(201)
    const created = (await response.json()) as { id: string }
    const stored = await prisma.project.findUnique({ where: { id: created.id } })
    expect(stored?.competition).toBeNull()
  })
})

describe('the meeting schedule', () => {
  it('is set by the lead and read back by members', async () => {
    const response = await request('PATCH', `/api/projects/${projectId}`, leadCookie, {
      meetingWeekday: 4,
      meetingTime: '18:30',
      meetingLocation: 'ENG2 Lab',
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      meetingWeekday: 4,
      meetingTime: '18:30',
      meetingLocation: 'ENG2 Lab',
    })

    // Found by slug rather than by position: the lead runs more than one
    // project in these fixtures, and asserting on the whole array would make
    // this test about how many rather than about the schedule.
    const mine = await request('GET', '/api/me/projects', leadCookie)
    const rows = (await mine.json()) as { project: { slug: string; meetingTime: string | null } }[]
    expect(
      rows.find((row) => row.project.slug === `${PREFIX}rover`)?.project.meetingTime,
    ).toBe('18:30')
  })

  it('refuses a time that is not a wall-clock time', async () => {
    const response = await request('PATCH', `/api/projects/${projectId}`, leadCookie, {
      meetingTime: 'sixish',
    })

    expect(response.status).toBe(400)
  })
})

/**
 * `ProjectMember.title` is the free-text display string — "Software Lead" — and
 * it was called `role` until the two role systems were told apart, sitting
 * beside a `UserRole` it had nothing to do with.
 *
 * The rename is the kind that fails quietly. Zod strips unknown keys rather
 * than refusing them, so a caller still sending `role` gets a 200 and saves
 * nothing at all: a stale browser bundle against a new server would look like
 * display titles that simply stopped working. That is the second test here.
 */
describe('a member\'s display title', () => {
  const patch = (body: unknown) =>
    request(
      'PATCH',
      `/api/projects/${projectId}/members/${paidId}`,
      leadCookie,
      body,
    )

  beforeEach(async () => {
    await prisma.projectMember.create({ data: { projectId, userId: paidId } })
  })

  it('is set by the lead and read back off the roster', async () => {
    const response = await patch({ title: 'Software Lead' })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ title: 'Software Lead' })

    const team = await request('GET', `/api/projects/${projectId}/team`, leadCookie)
    const body = (await team.json()) as { members: { userId: string; title: string | null }[] }
    expect(body.members.find((m) => m.userId === paidId)?.title).toBe(
      'Software Lead',
    )
  })

  it('ignores the old `role` key rather than storing it', async () => {
    const response = await patch({ role: 'Software Lead' })

    // A 200 that wrote nothing, which is exactly why this test exists.
    expect(response.status).toBe(200)
    expect(
      (
        await prisma.projectMember.findUniqueOrThrow({
          where: { projectId_userId: { projectId, userId: paidId } },
        })
      ).title,
    ).toBeNull()
  })
})

describe('GET /api/me/projects', () => {
  it('returns rank, team and project in one row per membership', async () => {
    const team = await prisma.team.create({ data: { projectId, name: 'Mine' } })
    await prisma.projectMember.create({
      data: {
        projectId,
        userId: paidId,
        rank: ProjectMemberRank.TEAM_LEAD,
        teamId: team.id,
        title: 'Software Lead',
      },
    })

    const response = await request('GET', '/api/me/projects', paidCookie)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject([
      {
        rank: 'TEAM_LEAD',
        title: 'Software Lead',
        team: { name: 'Mine' },
        project: { slug: `${PREFIX}rover` },
      },
    ])
  })

  it('is empty for somebody on no projects, not an error', async () => {
    const response = await request('GET', '/api/me/projects', unpaidCookie)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })
})

/**
 * Running last term's project again this term.
 *
 * A build that carries across semesters is several rows now, one per term, and
 * this is how the next one gets made. What it copies is the writing; what it
 * deliberately does not copy is the people.
 */
describe('duplicating a project', () => {
  const duplicate = (body: Record<string, unknown>) =>
    request(
      'POST',
      `/api/officer/projects/${projectId}/duplicate`,
      officerCookie,
      body,
    )

  beforeEach(async () => {
    await prisma.project.update({
      where: { id: projectId },
      data: {
        summary: 'A rover',
        description: 'The long write-up',
        competition: 'UNIVERSITY ROVER CHALLENGE',
        repoUrl: 'https://example.com/repo',
        meetingWeekday: 4,
        meetingTime: '18:30',
        meetingLocation: 'ENG2 Lab',
        links: {
          create: { label: 'Docs', url: 'https://example.com', sortOrder: 0 },
        },
      },
    })
  })

  it('carries the writing across and stamps the new term', async () => {
    const response = await duplicate({
      slug: `${PREFIX}rover-2036`,
      termYear: 2036,
      termSeason: Season.SPRING,
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      slug: `${PREFIX}rover-2036`,
      title: 'PM Rover',
      summary: 'A rover',
      competition: 'UNIVERSITY ROVER CHALLENGE',
      repoUrl: 'https://example.com/repo',
      meetingWeekday: 4,
      meetingTime: '18:30',
      termYear: 2036,
      termSeason: Season.SPRING,
    })
  })

  /**
   * The whole reason the roster is left behind: a new term is when people
   * decide again, and a copy that re-enrolled last spring's team would put a
   * project back on the dashboard of somebody who has graduated.
   */
  it('starts with nobody on it', async () => {
    const response = await duplicate({ slug: `${PREFIX}rover-empty` })
    const copy = (await response.json()) as { id: string }

    expect(
      await prisma.projectMember.count({ where: { projectId: copy.id } }),
    ).toBe(0)
    // …even though the original has its lead on it.
    expect(
      await prisma.projectMember.count({ where: { projectId } }),
    ).toBeGreaterThan(0)
  })

  it('copies the resource links', async () => {
    const response = await duplicate({ slug: `${PREFIX}rover-links` })
    const copy = (await response.json()) as { id: string }

    const links = await prisma.projectLink.findMany({
      where: { projectId: copy.id },
    })
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      label: 'Docs',
      url: 'https://example.com',
    })
  })

  /**
   * The sharp edge. Copying the image *rows* alone looks right in every test —
   * both galleries render — and breaks on deletion, because every delete route
   * calls `deleteIfStored` by hand and would take the bytes out from under the
   * other project. So the copy gets its own `StoredFile`, and this is what says
   * the two are genuinely separate rather than two names for one row.
   */
  it('copies an uploaded picture rather than sharing it', async () => {
    const stored = await prisma.storedFile.create({
      data: {
        kind: FileKind.IMAGE,
        mimeType: 'image/png',
        byteSize: 4,
        originalName: `${PREFIX}pic.png`,
        data: Buffer.from([1, 2, 3, 4]),
      },
    })

    await prisma.projectImage.create({
      data: {
        projectId,
        url: `/api/files/${stored.id}`,
        caption: 'On the bench',
        sortOrder: 0,
      },
    })

    const response = await duplicate({ slug: `${PREFIX}rover-gallery` })
    const copy = (await response.json()) as { id: string }

    const images = await prisma.projectImage.findMany({
      where: { projectId: copy.id },
    })
    expect(images).toHaveLength(1)
    expect(images[0]!.caption).toBe('On the bench')
    expect(images[0]!.url).not.toBe(`/api/files/${stored.id}`)

    // Deleting the copy's file must leave the original's where it is.
    const copiedId = images[0]!.url.replace('/api/files/', '')
    expect(await prisma.storedFile.count({ where: { id: copiedId } })).toBe(1)

    await prisma.storedFile.deleteMany({ where: { id: copiedId } })
    expect(await prisma.storedFile.count({ where: { id: stored.id } })).toBe(1)

    await prisma.storedFile.deleteMany({ where: { id: stored.id } })
  })

  /** An external URL is somebody else's hosting: copied as written. */
  it('leaves an external picture URL as it is', async () => {
    await prisma.projectImage.create({
      data: { projectId, url: 'https://example.com/rover.png', sortOrder: 0 },
    })

    const response = await duplicate({ slug: `${PREFIX}rover-external` })
    const copy = (await response.json()) as { id: string }

    const images = await prisma.projectImage.findMany({
      where: { projectId: copy.id },
    })
    expect(images[0]!.url).toBe('https://example.com/rover.png')
  })

  /**
   * Duplicating an archived project is how a build comes *back*, so inheriting
   * the status would get the one case this route exists for wrong.
   */
  it('brings an archived project back as in progress', async () => {
    await prisma.project.update({
      where: { id: projectId },
      data: { status: ProjectStatus.ARCHIVED, featured: true },
    })

    const response = await duplicate({ slug: `${PREFIX}rover-revived` })

    expect(await response.json()).toMatchObject({
      status: ProjectStatus.IN_PROGRESS,
      featured: false,
    })
  })

  it('refuses a slug that is already a project', async () => {
    expect((await duplicate({ slug: `${PREFIX}rover` })).status).toBe(409)
  })

  it('refuses a season named without its year', async () => {
    const response = await duplicate({
      slug: `${PREFIX}rover-half`,
      termSeason: Season.SPRING,
    })

    expect(response.status).toBe(400)
  })

  it('belongs to officers', async () => {
    const response = await request(
      'POST',
      `/api/officer/projects/${projectId}/duplicate`,
      leadCookie,
      { slug: `${PREFIX}rover-nope` },
    )

    expect(response.status).toBe(403)
  })
})

/**
 * An officer giving somebody a term, with no money involved.
 *
 * The cash-at-a-meeting case. It used to be a date typed into Prisma Studio,
 * which covers the person and does nothing else — no promotion, no `joinedAt`,
 * and no record of who decided. All three of those are what these assert.
 */
describe('granting a membership', () => {
  const grant = (userId: string, plan: 'SEMESTER' | 'YEAR') =>
    request(
      'POST',
      `/api/officer/members/${userId}/membership`,
      officerCookie,
      { plan },
    )

  it('covers a guest and makes them a member', async () => {
    const response = await grant(unpaidId, 'SEMESTER')

    expect(response.status).toBe(200)

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: unpaidId },
    })
    expect(after.role).toBe(UserRole.MEMBER)
    expect(after.duesPaidThrough).not.toBeNull()
    expect(after.duesPaidThrough!.getTime()).toBeGreaterThan(MID_FALL.getTime())
    // Promoted, but not published: a slug stays a person's decision.
    expect(after.slug).toBeNull()
    expect(after.joinedAt).toBeInstanceOf(Date)
  })

  /**
   * A payment row for nothing, with a name on it. The zero amount says the club
   * collected nothing, `grantedById` says who decided, and the sentinel keeps
   * the unique constraint that stops Stripe crediting twice meaning what it
   * means rather than the column going nullable.
   */
  it('records who granted it, for nothing', async () => {
    await grant(unpaidId, 'SEMESTER')

    const rows = await prisma.duesPayment.findMany({
      where: { userId: unpaidId },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      amountCents: 0,
      status: 'SUCCEEDED',
      plan: 'SEMESTER',
      grantedById: officerId,
    })
    expect(rows[0]!.stripePaymentIntentId).toMatch(/^comp_/)
    expect(rows[0]!.paidAt).toBeInstanceOf(Date)
  })

  /**
   * Quoted against what they already hold, the same way the checkout page is,
   * so a second grant reaches further out instead of shortening somebody to the
   * term they are already covered for.
   */
  it('extends rather than resets', async () => {
    await grant(unpaidId, 'SEMESTER')
    const first = await prisma.user.findUniqueOrThrow({
      where: { id: unpaidId },
    })

    await grant(unpaidId, 'SEMESTER')
    const second = await prisma.user.findUniqueOrThrow({
      where: { id: unpaidId },
    })

    expect(second.duesPaidThrough!.getTime()).toBeGreaterThan(
      first.duesPaidThrough!.getTime(),
    )
  })

  it('shows in their own dues history, with the officer named', async () => {
    await grant(unpaidId, 'SEMESTER')

    const response = await request('GET', '/api/dues/status', unpaidCookie)
    const body = (await response.json()) as {
      history: { amountCents: number; grantedBy: string | null }[]
    }

    expect(body.history[0]).toMatchObject({
      amountCents: 0,
      grantedBy: 'PM Officer',
    })
  })

  it('404s for somebody who does not exist', async () => {
    const response = await grant(
      '00000000-0000-7000-8000-000000000000',
      'SEMESTER',
    )

    expect(response.status).toBe(404)
  })

  it('belongs to officers', async () => {
    const response = await request(
      'POST',
      `/api/officer/members/${unpaidId}/membership`,
      leadCookie,
      { plan: 'SEMESTER' },
    )

    expect(response.status).toBe(403)
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: unpaidId } }))
        .duesPaidThrough,
    ).toBeNull()
  })
})
