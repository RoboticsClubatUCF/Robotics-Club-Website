import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../app.js'
import { prisma } from '../core/db.js'
import { env } from '../core/env.js'
import {
  ProjectMemberRank,
  Season,
  UserRole,
} from '../generated/prisma/enums.js'
import { clearCalendarCache } from '../membership/semester.js'
import { createSession } from './session.js'

/**
 * The permission matrix, against the live database.
 *
 * This suite is the contract the whole dashboard rests on: project authority
 * is *per-project*. The two rows that carry the most weight are the ones that
 * would rot silently —
 *
 *   - somebody on no project gets 403 everywhere, because **no value of
 *     `UserRole` says anything about any project**; and
 *   - the lead of project A is a plain member on project B and gets 403 there,
 *     because rank lives on the membership row, not the person.
 *
 * The first of those used to be proved by a fixture carrying a *global*
 * `PROJECT_LEAD` role — a roster label that granted nothing and was spelled
 * identically to the rank that grants everything. Those two values are not
 * roles any more, so the trap they set cannot be rebuilt; what is left is the
 * stronger claim, which is that there is no role to try.
 *
 * Fixtures are all created and deleted by this suite, keyed on a `test-authz-`
 * prefix so nothing real is ever touched.
 *
 * **The clock is pinned and every fixture is paid up through 2035.** Management
 * is gated on current dues now, and whether *anybody* can be lapsed is a
 * property of the calendar rather than of a person: through the summer, the gap
 * between terms and a term's opening weeks, `hasAccess` is true for everyone
 * whatever their date says. Left on the real clock this suite would pass all
 * summer, go red the week fall's trial closes, and go green again in December —
 * on days nobody changed anything. So the clock sits in October 2035, term time,
 * past the trial, with `fetch` stubbed to fail so the terms are the fixed
 * fallbacks rather than whatever calendar.ucf.edu says today.
 *
 * The time is set *before* the fixtures, because `createSession` dates a session
 * from the clock it was issued under — moving nine years forward afterwards
 * would expire every cookie in the file and every test would 401.
 */

const PREFIX = 'test-authz-'

/**
 * A schedule, which every created project now has to carry.
 *
 * Spread into each create body rather than repeated: the route requires the
 * days and both times together, so a test about slugs or write-ups would
 * otherwise fail on a field it is not about.
 */
const MEETING = {
  meetingWeekdays: [2, 4],
  meetingStartTime: '18:00',
  meetingEndTime: '22:00',
}
const email = (name: string) => `${PREFIX}${name}@ucf.edu`

/** Term time, past the trial — so somebody unpaid is genuinely lapsed. */
const NOW = new Date('2035-10-01T12:00:00')
/** Covers `NOW` with room to spare. */
const PAID_UP = new Date('2035-12-31T23:59:59')
/** Far enough back that nothing can read it as current cover. */
const LAPSED = new Date('2020-01-01T00:00:00')
/**
 * The survey, answered. It is the gate *in front of* dues, so every fixture
 * here carries it — otherwise each of the dues refusals below would be masked
 * by a survey refusal, and the matrix would be testing the wrong sentence.
 */
const SURVEYED = new Date('2035-09-01T00:00:00')

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
  // Projects first: their members reference the users.
  await prisma.project.deleteMany({ where: { slug: { startsWith: PREFIX } } })
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } })
}

/** A signed-in cookie for a user, without the password ceremony. */
async function cookieFor(userId: string): Promise<string> {
  const { token } = await createSession(userId)
  return `${env.SESSION_COOKIE_NAME}=${token}`
}

type Person =
  | 'officer'
  | 'leadA'
  | 'teamLeadA'
  | 'siblingTeamLeadA'
  | 'memberA'
  | 'stranger'

const cookies = {} as Record<Person, string>
let projectA: string
let projectB: string
let teamT: string
let teamU: string
let memberIds: Record<Person, string>

beforeEach(async () => {
  clearCalendarCache()
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('nope', { status: 503 }))),
  )
  vi.useFakeTimers()
  vi.setSystemTime(NOW)

  await clearWindows()
  await clearRows()

  const [officer, leadA, teamLeadA, siblingTeamLeadA, memberA, stranger] =
    await Promise.all(
      (
        [
          ['officer', UserRole.OFFICER],
          ['leadA', UserRole.MEMBER],
          ['teamLeadA', UserRole.MEMBER],
          ['siblingTeamLeadA', UserRole.MEMBER],
          ['memberA', UserRole.MEMBER],
          // On no project at all, and a paid-up club member in good standing —
          // so every 403 they collect below is about the membership row they do
          // not have, and can be about nothing else.
          ['stranger', UserRole.MEMBER],
        ] as const
      ).map(([name, role]) =>
        prisma.user.create({
          data: {
            fullName: `Authz ${name}`,
            email: email(name),
            role,
            duesPaidThrough: PAID_UP,
            surveyCompletedAt: SURVEYED,
          },
        }),
      ),
    )

  memberIds = {
    officer: officer.id,
    leadA: leadA.id,
    teamLeadA: teamLeadA.id,
    siblingTeamLeadA: siblingTeamLeadA.id,
    memberA: memberA.id,
    stranger: stranger.id,
  }

  const a = await prisma.project.create({
    data: {
      slug: `${PREFIX}a`,
      title: 'Authz Project A',
      // Every project needs a term now. A year nothing real uses, so a
      // fixture can never collide with the club's own rows.
      termYear: 2035,
      termSeason: Season.FALL,
      teams: { create: [{ name: 'Team T' }, { name: 'Team U' }] },
    },
    include: { teams: true },
  })
  projectA = a.id
  teamT = a.teams.find((t) => t.name === 'Team T')!.id
  teamU = a.teams.find((t) => t.name === 'Team U')!.id

  const b = await prisma.project.create({
    data: {
      slug: `${PREFIX}b`,
      title: 'Authz Project B',
      termYear: 2035,
      termSeason: Season.FALL,
    },
  })
  projectB = b.id

  await prisma.projectMember.createMany({
    data: [
      { projectId: projectA, userId: leadA.id, rank: ProjectMemberRank.PROJECT_LEAD },
      { projectId: projectA, userId: teamLeadA.id, rank: ProjectMemberRank.TEAM_LEAD, teamId: teamT },
      { projectId: projectA, userId: siblingTeamLeadA.id, rank: ProjectMemberRank.TEAM_LEAD, teamId: teamU },
      { projectId: projectA, userId: memberA.id },
      // The other half of the per-project story: A's lead is a plain member on B.
      { projectId: projectB, userId: leadA.id },
    ],
  })

  for (const person of Object.keys(memberIds) as Person[]) {
    cookies[person] = await cookieFor(memberIds[person])
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  clearCalendarCache()
})

afterAll(async () => {
  await clearWindows()
  await clearRows()
  await prisma.$disconnect()
})

const request = (
  method: string,
  path: string,
  person: Person | null,
  body?: unknown,
) =>
  app.request(path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(person ? { cookie: cookies[person] } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

describe('editing a project', () => {
  it.each([
    ['a member who is on no project at all', 'stranger', 403],
    ['a plain member of the project', 'memberA', 403],
    ['one of its team leads', 'teamLeadA', 403],
    ['its project lead', 'leadA', 200],
    ['an officer', 'officer', 200],
  ] as const)('%s -> %i', async (_who, person, status) => {
    const response = await request('PATCH', `/api/projects/${projectA}`, person, {
      summary: 'edited',
    })
    expect(response.status).toBe(status)
  })

  it('refuses A\'s lead on project B, where they are a plain member', async () => {
    const response = await request('PATCH', `/api/projects/${projectB}`, 'leadA', {
      summary: 'edited',
    })
    expect(response.status).toBe(403)
  })

  it('refuses anybody signed out', async () => {
    const response = await request('PATCH', `/api/projects/${projectA}`, null, {
      summary: 'edited',
    })
    expect(response.status).toBe(401)
  })
})

/**
 * The public page's editor. Same gate as editing the project itself — it is
 * literally `requireProjectLead` — so the matrix is the same five rows, and
 * these exist because a new route is exactly where that gate gets forgotten.
 */
describe('editing the public page', () => {
  const attempts = [
    [
      'adding a gallery picture',
      'POST',
      (id: string) => `/api/projects/${id}/images`,
      { url: 'https://example.test/a.png' },
      201,
    ],
    [
      'reordering the gallery',
      'PATCH',
      (id: string) => `/api/projects/${id}/images/order`,
      // Refused before the ids are looked at, so an empty gallery is fine for
      // the rows that expect a 403; the allowed rows get a 409 instead, which
      // is still "past the gate" and is what the expectation below says.
      { ids: ['00000000-0000-4000-8000-000000000000'] },
      409,
    ],
    [
      'replacing the links',
      'PATCH',
      (id: string) => `/api/projects/${id}/links`,
      { links: [{ label: 'Doc', url: 'https://example.test/doc' }] },
      200,
    ],
  ] as const

  describe.each(attempts)('%s', (_what, method, path, body, allowed) => {
    it.each([
      ['a member who is on no project at all', 'stranger', 403],
      ['a plain member of the project', 'memberA', 403],
      ['one of its team leads', 'teamLeadA', 403],
      ['its project lead', 'leadA', allowed],
      ['an officer', 'officer', allowed],
    ] as const)('%s -> %i', async (_who, person, status) => {
      const response = await request(method, path(projectA), person, body)
      expect(response.status).toBe(status)
    })

    it("refuses A's lead on project B, where they are a plain member", async () => {
      const response = await request(method, path(projectB), 'leadA', body)
      expect(response.status).toBe(403)
    })

    it('refuses anybody signed out', async () => {
      const response = await request(method, path(projectA), null, body)
      expect(response.status).toBe(401)
    })
  })

  it('refuses a picture removal by anyone but a lead or an officer', async () => {
    const image = await prisma.projectImage.create({
      data: { projectId: projectA, url: 'https://example.test/a.png' },
    })

    const refused = await request(
      'DELETE',
      `/api/projects/${projectA}/images/${image.id}`,
      'memberA',
    )
    expect(refused.status).toBe(403)

    const allowed = await request(
      'DELETE',
      `/api/projects/${projectA}/images/${image.id}`,
      'leadA',
    )
    expect(allowed.status).toBe(200)
  })
})

describe('the member roster of a project', () => {
  it.each([
    ['a member', 'memberA', 200],
    ['the lead', 'leadA', 200],
    ['an officer who is not a member', 'officer', 200],
    ['a member who is on no project at all', 'stranger', 403],
  ] as const)('is visible to %s -> %i', async (_who, person, status) => {
    const response = await request('GET', `/api/projects/${projectA}/team`, person)
    expect(response.status).toBe(status)
  })

  it('never carries an email address', async () => {
    const response = await request('GET', `/api/projects/${projectA}/team`, 'memberA')
    expect(JSON.stringify(await response.json())).not.toContain('@ucf.edu')
  })
})

describe('creating teams', () => {
  it.each([
    ['a team lead', 'teamLeadA', 403],
    ['a member', 'memberA', 403],
    ['the project lead', 'leadA', 201],
    ['an officer', 'officer', 201],
  ] as const)('%s -> %i', async (_who, person, status) => {
    const response = await request('POST', `/api/projects/${projectA}/teams`, person, {
      name: 'Fresh Team',
    })
    expect(response.status).toBe(status)
  })
})

describe('a team lead moving members', () => {
  it('may pull an unseated member onto their own team', async () => {
    const response = await request(
      'POST',
      `/api/teams/${teamT}/members/${memberIds.memberA}`,
      'teamLeadA',
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ teamId: teamT })
  })

  it("may not touch a sibling team's roster", async () => {
    const response = await request(
      'POST',
      `/api/teams/${teamT}/members/${memberIds.memberA}`,
      'siblingTeamLeadA',
    )
    expect(response.status).toBe(403)
  })

  it('may not poach from another team', async () => {
    await prisma.projectMember.update({
      where: { projectId_userId: { projectId: projectA, userId: memberIds.memberA } },
      data: { teamId: teamU },
    })

    const response = await request(
      'POST',
      `/api/teams/${teamT}/members/${memberIds.memberA}`,
      'teamLeadA',
    )
    expect(response.status).toBe(409)
  })

  it('may not move a fellow lead', async () => {
    const response = await request(
      'POST',
      `/api/teams/${teamT}/members/${memberIds.siblingTeamLeadA}`,
      'teamLeadA',
    )
    expect(response.status).toBe(403)
  })

  it('is outranked by the project lead on the same route', async () => {
    const response = await request(
      'POST',
      `/api/teams/${teamT}/members/${memberIds.memberA}`,
      'leadA',
    )
    expect(response.status).toBe(200)
  })
})

describe('placing members, as the project lead', () => {
  it('assigns a team and the TEAM_LEAD rank together', async () => {
    const response = await request(
      'PATCH',
      `/api/projects/${projectA}/members/${memberIds.memberA}`,
      'leadA',
      { teamId: teamT, rank: 'TEAM_LEAD' },
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ rank: 'TEAM_LEAD', teamId: teamT })
  })

  it('refuses a TEAM_LEAD rank with no team under it', async () => {
    const response = await request(
      'PATCH',
      `/api/projects/${projectA}/members/${memberIds.memberA}`,
      'leadA',
      { rank: 'TEAM_LEAD' },
    )
    expect(response.status).toBe(400)
  })

  it('cannot mint PROJECT_LEAD — the body schema itself refuses', async () => {
    const response = await request(
      'PATCH',
      `/api/projects/${projectA}/members/${memberIds.memberA}`,
      'leadA',
      { rank: 'PROJECT_LEAD' },
    )
    expect(response.status).toBe(400)
  })

  it("cannot touch a fellow project lead's row", async () => {
    await prisma.projectMember.create({
      data: {
        projectId: projectA,
        userId: memberIds.stranger,
        rank: ProjectMemberRank.PROJECT_LEAD,
      },
    })

    const response = await request(
      'PATCH',
      `/api/projects/${projectA}/members/${memberIds.stranger}`,
      'leadA',
      { role: 'renamed' },
    )
    expect(response.status).toBe(403)
  })

  it("refuses another project's team, in words rather than a constraint error", async () => {
    const foreign = await prisma.team.create({
      data: { projectId: projectB, name: 'Foreign Team' },
    })

    const response = await request(
      'PATCH',
      `/api/projects/${projectA}/members/${memberIds.memberA}`,
      'leadA',
      { teamId: foreign.id },
    )
    expect(response.status).toBe(400)
  })
})

/**
 * Which projects the club runs is a board decision, so creating one is officer
 * business and nothing else opens that door.
 *
 * It briefly did: a `PROJECT_LEAD` roster label used to buy the right to start
 * a single project of your own, which was the one place in the whole codebase
 * where a `UserRole` value said something about projects. The label is not a
 * role any more and the delegation went with it. **Running a project confers
 * nothing here** — `leadA` leads project A and still gets a 403, because
 * authority inside a project and permission to make another are different
 * things and the second one is the board's.
 */
describe('the officer desk', () => {
  const newProject = {
    slug: `${PREFIX}new`,
    title: 'Somebody Made This',
    summary: 'A thing to build.',
  }

  it.each([
    ['a project lead, on their own project', 'leadA', 403],
    ['a team lead', 'teamLeadA', 403],
    ['a member', 'memberA', 403],
    ['a member on no project', 'stranger', 403],
    ['an officer', 'officer', 201],
  ] as const)('creating a project as %s -> %i', async (_who, person, status) => {
    const response = await request('POST', '/api/officer/projects', person, {
      ...MEETING,
      ...newProject,
      leadUserId: memberIds.memberA,
    })
    expect(response.status).toBe(status)
  })

  /**
   * A project has one lead. Appointing over a sitting one is refused rather
   * than swapped — the site does not get to decide which of two people runs a
   * build — and the sentence names the incumbent, because standing that
   * particular person down is the next thing the officer has to do.
   */
  it('refuses a second project lead, naming the one already there', async () => {
    const response = await request(
      'PATCH',
      `/api/officer/projects/${projectA}/members/${memberIds.memberA}/rank`,
      'officer',
      { rank: ProjectMemberRank.PROJECT_LEAD },
    )

    expect(response.status).toBe(409)
    expect(((await response.json()) as { error: string }).error).toContain(
      'Authz leadA',
    )

    // And the sitting lead is untouched by the attempt.
    expect(
      await prisma.projectMember.count({
        where: { projectId: projectA, rank: ProjectMemberRank.PROJECT_LEAD },
      }),
    ).toBe(1)
  })

  /** Standing the incumbent down first is the workflow that 409 describes. */
  it('appoints once the seat is free', async () => {
    const down = await request(
      'PATCH',
      `/api/officer/projects/${projectA}/members/${memberIds.leadA}/rank`,
      'officer',
      { rank: ProjectMemberRank.MEMBER },
    )
    expect(down.status).toBe(200)

    const up = await request(
      'PATCH',
      `/api/officer/projects/${projectA}/members/${memberIds.memberA}/rank`,
      'officer',
      { rank: ProjectMemberRank.PROJECT_LEAD },
    )
    expect(up.status).toBe(200)

    const leads = await prisma.projectMember.findMany({
      where: { projectId: projectA, rank: ProjectMemberRank.PROJECT_LEAD },
      select: { userId: true },
    })
    expect(leads).toEqual([{ userId: memberIds.memberA }])
  })

  /** Nobody conflicts with themselves — re-appointing the lead is a no-op. */
  it('re-appoints the sitting lead without complaint', async () => {
    const response = await request(
      'PATCH',
      `/api/officer/projects/${projectA}/members/${memberIds.leadA}/rank`,
      'officer',
      { rank: ProjectMemberRank.PROJECT_LEAD },
    )

    expect(response.status).toBe(200)
    expect(
      await prisma.projectMember.count({
        where: { projectId: projectA, rank: ProjectMemberRank.PROJECT_LEAD },
      }),
    ).toBe(1)
  })

  it('keeps the member search to officers', async () => {
    const denied = await request('GET', '/api/officer/members?query=authz', 'leadA')
    expect(denied.status).toBe(403)

    const allowed = await request('GET', '/api/officer/members?query=authz', 'officer')
    expect(allowed.status).toBe(200)
  })
})

/**
 * Dues lapsing takes the tools away and leaves everything else alone.
 *
 * The club's rule, and the reason it is a separate axis from rank: somebody who
 * has let their dues run out is still on their projects and can still see them
 * — that is the whole of `/ MY PROJECTS` — but they cannot run anything until
 * they pay. Their rank does not move; only what it opens does.
 *
 * `ADMIN` is exempt on purpose and forever. Whoever can fix a membership must
 * not be lockable out by a membership, or the club reaches a state nobody can
 * put right from inside the site.
 *
 * Fixtures here are re-pointed at a date in 2020 rather than being created
 * separately, so the *same* people who pass every test above are the ones
 * failing here — which is the point being made.
 */
describe('when dues lapse', () => {
  const lapse = (person: Person) =>
    prisma.user.update({
      where: { id: memberIds[person] },
      data: { duesPaidThrough: LAPSED },
    })

  it('locks a project lead out of running their own project', async () => {
    await lapse('leadA')

    const response = await request('PATCH', `/api/projects/${projectA}`, 'leadA', {
      summary: 'edited',
    })

    expect(response.status).toBe(403)
    // Named, not the generic refusal: they had the rank a moment ago and the
    // fix is a payment, so the message has to say so.
    expect(((await response.json()) as { error: string }).error).toMatch(
      /dues have lapsed/i,
    )
  })

  /**
   * The public page's editor goes with the rest of the tools. Reading the page
   * does not — it is public, and a lapsed lead browsing their own project sees
   * exactly what a visitor sees.
   */
  it('locks a project lead out of editing their public page', async () => {
    await lapse('leadA')

    const response = await request('POST', `/api/projects/${projectA}/images`, 'leadA', {
      url: 'https://example.test/a.png',
    })

    expect(response.status).toBe(403)
    expect(((await response.json()) as { error: string }).error).toMatch(
      /dues have lapsed/i,
    )

    // And the page itself is still there for them, unchanged.
    const page = await app.request(`/api/projects/${PREFIX}a`)
    expect(page.status).toBe(200)
  })

  it('locks an officer out of the officer desk', async () => {
    await lapse('officer')

    const response = await request('GET', '/api/officer/members?query=authz', 'officer')

    expect(response.status).toBe(403)
    expect(((await response.json()) as { error: string }).error).toMatch(
      /dues have lapsed/i,
    )
  })

  it("locks a team lead out of their team's events", async () => {
    await lapse('teamLeadA')

    const response = await request('POST', '/api/events', 'teamLeadA', {
      title: 'Lapsed build night',
      startsAt: '2035-11-01T23:00:00.000Z',
      type: 'MEETING',
      projectId: projectA,
      teamId: teamT,
    })

    expect(response.status).toBe(403)
  })

  /**
   * The half that must keep working. Reading a project you are on is not a
   * management feature, and a member who owes the club $25 has not stopped
   * being on the team.
   */
  it('leaves them able to see the projects they are on', async () => {
    await lapse('memberA')
    await lapse('leadA')

    for (const person of ['memberA', 'leadA'] as const) {
      const roster = await request('GET', `/api/projects/${projectA}/team`, person)
      expect(roster.status).toBe(200)

      const mine = await request('GET', '/api/me/projects', person)
      expect(mine.status).toBe(200)
      expect(await mine.json()).toHaveLength(person === 'leadA' ? 2 : 1)
    }
  })

  /** The rank is untouched. Paying gives the tools straight back. */
  it('does not take the rank away, so paying restores everything', async () => {
    await lapse('leadA')
    expect(
      (await request('PATCH', `/api/projects/${projectA}`, 'leadA', { summary: 'a' }))
        .status,
    ).toBe(403)

    await prisma.user.update({
      where: { id: memberIds.leadA },
      data: { duesPaidThrough: PAID_UP },
    })

    expect(
      (await request('PATCH', `/api/projects/${projectA}`, 'leadA', { summary: 'b' }))
        .status,
    ).toBe(200)
  })

  /**
   * The role follows on the very next request rather than waiting on the timer.
   * `demoteIfLapsed` runs inside session resolution, so the answer is live for
   * anybody who is actually using the site; the sweep is the backstop for the
   * far larger group who have stopped turning up.
   */
  it('takes MEMBER back on the next request, not on the next sweep', async () => {
    await lapse('memberA')

    // Any authenticated request will do — this one is the cheapest.
    await request('GET', '/api/me/projects', 'memberA')

    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { id: memberIds.memberA },
          select: { role: true },
        })
      ).role,
    ).toBe(UserRole.GUEST)
  })

  /** It must not reach past the people the site itself promoted. */
  it('leaves a hand-made roster entry alone on the way through', async () => {
    await prisma.user.update({
      where: { id: memberIds.teamLeadA },
      data: { role: UserRole.MEMBER, duesPaidThrough: null },
    })

    await request('GET', '/api/me/projects', 'teamLeadA')

    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { id: memberIds.teamLeadA },
          select: { role: true },
        })
      ).role,
    ).toBe(UserRole.MEMBER)
  })

  /**
   * The exception, and the one row here worth breaking a deploy over. An admin
   * with no payment on record at all still runs everything.
   */
  it('never locks out an admin', async () => {
    await prisma.user.update({
      where: { id: memberIds.officer },
      data: { role: UserRole.ADMIN, duesPaidThrough: null },
    })

    const desk = await request('GET', '/api/officer/members?query=authz', 'officer')
    expect(desk.status).toBe(200)

    const edit = await request('PATCH', `/api/projects/${projectA}`, 'officer', {
      summary: 'admins always get through',
    })
    expect(edit.status).toBe(200)
  })

  /**
   * The club's line, widened past management: with dues owed the dashboard is
   * the page that takes the payment and the projects you are already on, and
   * nothing else. Printing and borrowing are the club spending money on you,
   * and no *rank* refuses anybody from them — so this check is the only thing
   * standing between a lapsed account and a spool of filament.
   */
  it('locks a plain member out of printing and borrowing', async () => {
    await lapse('memberA')

    for (const [method, path] of [
      ['GET', '/api/equipment'],
      ['POST', '/api/print'],
    ] as const) {
      const response = await request(method, path, 'memberA')
      expect(response.status).toBe(403)
      expect(((await response.json()) as { error: string }).error).toMatch(
        /dues have lapsed/i,
      )
    }
  })

  /** And the two things that stay open, which is the other half of the rule. */
  it('leaves the dues page and their own projects open', async () => {
    await lapse('memberA')

    for (const path of [
      '/api/dues/status',
      '/api/me/projects',
      '/api/me/events',
      '/api/me/tasks',
    ]) {
      expect((await request('GET', path, 'memberA')).status).toBe(200)
    }
  })

  /**
   * Order matters: a stranger gets the ordinary refusal, not a note about dues.
   * Telling them to pay would say that paying hands out a lead's tools.
   */
  it('still refuses a stranger on rank rather than on dues', async () => {
    await lapse('stranger')

    const response = await request('PATCH', `/api/projects/${projectA}`, 'stranger', {
      summary: 'edited',
    })

    expect(response.status).toBe(403)
    expect(((await response.json()) as { error: string }).error).not.toMatch(
      /dues/i,
    )
  })
})

/**
 * The three sentences a refusal can carry, and which one you get.
 *
 * There is one gate now — `requireCurrentDues`, which is `duesPaidThrough` in
 * the future and `ADMIN` — where there used to be two. The stricter of the pair
 * refused a `GUEST` outright and picked its wording from the role; that check
 * is gone, because nothing can set a dues date without promoting the account in
 * the same transaction, so it had become a test that could never fail for
 * anybody who got past the first one.
 *
 * What survives is the wording, chosen from the date instead. Getting it the
 * wrong way round is how somebody two years in reads that they were never a
 * member, so it is worth a matrix of its own — and it lives here rather than in
 * `print.test.ts` and `equipment.test.ts` because the sentence turns on whether
 * a free window is running, and this is the suite with a pinned clock. `NOW` is
 * mid-fall 2035: term time, well past the free weeks, nothing free on offer.
 */
describe('what a refusal says', () => {
  const asking = (person: Person) =>
    request('POST', '/api/print', person, {
      fileId: '00000000-0000-0000-0000-000000000000',
      material: 'PLA',
      colour: 'Black',
      quantity: 1,
    })

  const refusalFor = async (
    paidThrough: Date | null,
    role: UserRole = UserRole.MEMBER,
  ) => {
    await prisma.user.update({
      where: { id: memberIds.memberA },
      data: { duesPaidThrough: paidThrough, role },
    })

    const response = await asking('memberA')
    expect(response.status).toBe(403)

    return ((await response.json()) as { error: string }).error
  }

  it('tells somebody who never paid what membership is', async () => {
    expect(await refusalFor(null)).toMatch(/paid-up members/i)
  })

  it('tells a lapsed member nothing has been taken away', async () => {
    const error = await refusalFor(LAPSED)

    expect(error).toMatch(/dues have lapsed/i)
    // The kindness is the whole reason the two are told apart: somebody two
    // years in must not read that they never joined.
    expect(error).not.toMatch(/paid-up members/i)
  })

  /**
   * A `GUEST` with a date that has run out is a member the sweep demoted, and
   * gets the lapsed sentence rather than the newcomer's — the role is not what
   * decides this any more, and this is the case that proves it.
   */
  it('reads the date, not the role', async () => {
    expect(await refusalFor(LAPSED, UserRole.GUEST)).toMatch(/dues have lapsed/i)
  })

  /**
   * And the third sentence, which is new: while a free window is running,
   * quoting a price at somebody would be false. They are one press from being
   * let in. Checked by moving the clock into the August gap rather than by
   * moving the fixture, because the window is a property of the calendar.
   */
  it('tells somebody to claim it while the window is open', async () => {
    vi.setSystemTime(new Date('2035-08-15T12:00:00'))

    try {
      expect(await refusalFor(null)).toMatch(/free right now/i)
    } finally {
      vi.setSystemTime(NOW)
    }
  })
})

/**
 * The survey, which is no longer a gate.
 *
 * It used to refuse everything until it was answered — the tools, the desks
 * and the dues page — so the club could not take somebody's money before it
 * had their shirt size. That is gone, and these tests are the ones that would
 * have failed then: an unanswered survey now refuses nothing at all, and the
 * only thing left of it on the wire is a pair of flags the dashboard reads to
 * decide whether it still has something to ask for.
 */
describe('an unanswered member survey', () => {
  const asking = (person: Person) =>
    request('POST', '/api/print', person, {
      fileId: '00000000-0000-0000-0000-000000000000',
      material: 'PLA',
      colour: 'Black',
      quantity: 1,
    })

  /** Unanswer the survey for one fixture, leaving everything else alone. */
  const unanswered = (person: Person, extra: Record<string, unknown> = {}) =>
    prisma.user.update({
      where: { id: memberIds[person] },
      data: { surveyCompletedAt: null, ...extra },
    })

  const errorOf = async (response: Response) =>
    ((await response.json()) as { error: string }).error

  it('does not stop a paid-up member', async () => {
    await unanswered('memberA')

    // 400 rather than 403: the request gets past every gate and falls over on
    // the fixture's deliberately nonexistent file id, which is the cheapest
    // proof available here that nothing refused it.
    expect((await asking('memberA')).status).not.toBe(403)
  })

  /**
   * The one that pins the change. Somebody who owes dues *and* has not answered
   * used to be told about the survey, because it outranked the money; now the
   * only thing standing in their way is what they actually owe.
   */
  it('leaves the dues sentence to dues', async () => {
    await unanswered('memberA', { duesPaidThrough: LAPSED })

    expect(await errorOf(await asking('memberA'))).toMatch(/dues have lapsed/i)
  })

  /**
   * The two dues writes, which is where this mattered most. `checkout` creates
   * the payment intent and `activate` claims a free window; both were shut
   * behind the survey, so a member with a card in their hand could be refused
   * for not having said what size shirt they wear.
   */
  it('does not shut the two dues writes', async () => {
    await unanswered('memberA')

    const checkout = await request('POST', '/api/dues/checkout', 'memberA', {
      plan: 'SEMESTER',
    })
    const activate = await request('POST', '/api/dues/activate', 'memberA')

    expect(checkout.status).not.toBe(403)
    expect(activate.status).not.toBe(403)
  })

  /**
   * And what the dashboard reads instead. `surveyPending` is what puts the
   * prompt up; `surveyPromptDismissed` is the checkbox on it, and the two are
   * separate because answering and declining to be asked are different facts —
   * see the column comments in `schema.prisma`.
   */
  it('is reported on the dues status for the dashboard to ask about', async () => {
    await unanswered('memberA')

    const response = await request('GET', '/api/dues/status', 'memberA')
    const { membership } = (await response.json()) as {
      membership: { surveyPending: boolean; surveyPromptDismissed: boolean }
    }

    expect(response.status).toBe(200)
    expect(membership.surveyPending).toBe(true)
    expect(membership.surveyPromptDismissed).toBe(false)
  })

  /** No `ADMIN` exemption left, because there is nothing to be exempt from. */
  it('is asked of an admin like anybody else', async () => {
    await unanswered('memberA', { role: UserRole.ADMIN })

    const response = await request('GET', '/api/dues/status', 'memberA')

    expect(
      ((await response.json()) as { membership: { surveyPending: boolean } })
        .membership.surveyPending,
    ).toBe(true)
  })
})
