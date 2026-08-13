import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { prisma } from './db.js'
import { ProjectMemberRank, UserRole } from './generated/prisma/enums.js'
import { membershipStanding } from './semester.js'
import type { AuthEnv, SessionUser } from './session.js'

/**
 * Who may do what, inside a project.
 *
 * The rule that shapes everything here, with no exceptions left in it:
 * **project authority is per-project**. The lead of one project is a plain
 * member — or a stranger — on every other, so nothing in this file reads the
 * `UserRole` ladder except to let officers through and to refuse a `GUEST`.
 * The rank that grants is `ProjectMember.rank`, scoped by its primary key to
 * exactly one project.
 *
 * `UserRole` used to carry `PROJECT_LEAD` and `TEAM_LEAD` as roster labels,
 * spelled the same as that column's values and meaning something else, and
 * `requireProjectCreator` here read one of them to allow starting a project.
 * Both are gone. **No value of `UserRole` says anything about any project**,
 * and if a check in this file ever needs one, the check is wrong.
 *
 * Officers and admins pass every check. They are the ones who create projects
 * and appoint leads in the first place, and a lead who quits mid-term must not
 * leave a project nobody can administer.
 *
 * Every refusal is the same sentence and the same 403. Which check failed is
 * not something a stranger probing project ids should be able to learn, and a
 * member who genuinely lacks the rank gets nothing useful from a more specific
 * answer either — the fix is "ask your lead" in every case.
 *
 * **Running anything needs current dues.** Every check below ends with
 * `requireCurrentDues`, so a lead or an officer whose dues have lapsed keeps
 * their rank and loses the tools until they pay. Reading does not: nothing gates
 * `requireProjectMember`, because somebody who has let their dues run out is
 * still on their projects and can still see them. `ADMIN` is exempt from all of
 * it — the club cannot be in a position where the only person who can fix a
 * membership problem is locked out by one.
 *
 * **Asking the club for something needs membership on top of that.**
 * `requireClubMember` refuses a `GUEST` outright, because having an account is
 * not the same as having joined — see the long note on it below.
 *
 * The dues check runs *after* the rank check, and that order is deliberate.
 * Somebody who was never a lead gets the ordinary 403 rather than a note about
 * dues, which would tell them that paying would hand them a lead's tools.
 */

const forbidden = () =>
  new HTTPException(403, { message: 'You do not have permission to do that.' })

export const isOfficer = (user: SessionUser): boolean =>
  user.role === UserRole.ADMIN || user.role === UserRole.OFFICER

export const isAdmin = (user: SessionUser): boolean =>
  user.role === UserRole.ADMIN

const LAPSED =
  'Your dues have lapsed. Pay them and everything comes straight back — your projects and your standing on them have not changed.'

/**
 * Running things is for paid-up members.
 *
 * `hasAccess` rather than the date, like everywhere else on the site: the
 * summer, the gap between terms and the trial fortnight all count as covered,
 * and a free window somebody has claimed is that same date moved forward. So
 * this only ever bites in term time, and only somebody who genuinely owes.
 *
 * `ADMIN` is exempt and always will be. Whoever can fix a membership must not
 * be lockable out by a membership — that is how a club ends up with nobody able
 * to put it right.
 */
export async function requireCurrentDues(user: SessionUser): Promise<void> {
  if (isAdmin(user)) return

  const standing = await membershipStanding(user.duesPaidThrough)
  if (!standing.hasAccess) throw new HTTPException(403, { message: LAPSED })
}

/**
 * The same check as middleware, for whole routers.
 *
 * The club's line: with dues owed, the dashboard is your projects and the page
 * that takes the payment, and nothing else. 3D printing and equipment borrowing
 * are the club spending money on you, so they sit behind it exactly as the
 * management tools do — and unlike those, they are refused by *rank* to nobody,
 * so this is the only thing standing between a lapsed account and a print.
 */
export const requireDuesForRoute: MiddlewareHandler<AuthEnv> = async (
  c,
  next,
) => {
  await requireCurrentDues(c.get('user'))
  await next()
}

const NOT_A_MEMBER =
  'This is for club members. Pay your dues — or claim the free window, if one is running — and it opens straight away.'

/**
 * Asking the club for something is for members, not for anyone with an account.
 *
 * **A `GUEST` is refused outright here, whatever their standing says**, and that
 * is a different question from the one `requireCurrentDues` answers. Two things
 * have to be true to consume club resources, and they are genuinely
 * independent:
 *
 *   - *Are you a member of the club at all?* — the role, and only `GUEST` fails.
 *   - *Are your dues current?* — `membershipStanding`, never the role.
 *
 * The second is why the standing rule elsewhere still holds: the sweep can be
 * an hour behind and nothing breaks, because coverage is asked at the moment of
 * the request. But coverage alone would let anybody who signed up ten minutes
 * ago order prints, because the summer, the break between terms and the trial
 * fortnight all report `hasAccess: true` for *everyone* — that is what makes
 * them free, and it is not the same thing as having joined.
 *
 * Nothing is lost by it. A guest becomes a member on one page: paying does it,
 * and so does claiming a free window, which costs nothing and is one press —
 * both go through `membershipUpdateFor`, so the promotion lands in the same
 * transaction as the date.
 *
 * Which sentence they get turns on `duesPaidThrough`, the same signal the
 * demotion sweep reads: **a date that has run out** means this is a member the
 * sweep demoted, and "nothing has been taken away" is the true and kinder thing
 * to say to them. Getting that the wrong way round is how somebody who has been
 * in the club two years reads that they are not in it.
 *
 * Both other shapes get the newcomer's wording, and the second is the one worth
 * spelling out. A null date is somebody the site never promoted. A date still
 * *running* on an account that is nonetheless a `GUEST` cannot happen by paying
 * — that promotes in the same transaction — so it is an officer having set the
 * role by hand, and telling that person their dues lapsed would be plainly
 * false: they are covered, and what they are not is a member.
 */
export async function requireClubMember(user: SessionUser): Promise<void> {
  if (isAdmin(user)) return

  if (user.role === UserRole.GUEST) {
    const lapsed =
      user.duesPaidThrough !== null && user.duesPaidThrough <= new Date()

    throw new HTTPException(403, { message: lapsed ? LAPSED : NOT_A_MEMBER })
  }

  await requireCurrentDues(user)
}

/** The same, as middleware, for the print and equipment routers. */
export const requireMemberForRoute: MiddlewareHandler<AuthEnv> = async (
  c,
  next,
) => {
  await requireClubMember(c.get('user'))
  await next()
}

/** For the routes that are officer business outright — queues, appointments. */
export const requireOfficer: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const user = c.get('user')

  if (!isOfficer(user)) throw forbidden()
  await requireCurrentDues(user)
  await next()
}

/**
 * One person's standing on one project, or null for a stranger. Also null for
 * a project that does not exist — callers that need to tell those apart fetch
 * the project first, and mostly they already have.
 */
export function membershipOf(userId: string, projectId: string) {
  return prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { rank: true, teamId: true },
  })
}

export async function requireProjectMember(
  user: SessionUser,
  projectId: string,
): Promise<void> {
  if (isOfficer(user)) return
  if (!(await membershipOf(user.id, projectId))) throw forbidden()
}

export async function requireProjectLead(
  user: SessionUser,
  projectId: string,
): Promise<void> {
  if (!isOfficer(user)) {
    const membership = await membershipOf(user.id, projectId)
    if (membership?.rank !== ProjectMemberRank.PROJECT_LEAD) throw forbidden()
  }

  await requireCurrentDues(user)
}

/**
 * Team-lead authority over one team: its own leads, the leads of the project
 * it belongs to, and officers. Returns the team's project id because every
 * caller needs it next and the team was just read anyway.
 *
 * A missing team is a 404 rather than the shared 403 — the id came from a URL,
 * and "no such team" is not information about anybody's rank.
 */
export async function requireTeamLead(
  user: SessionUser,
  teamId: string,
): Promise<{ projectId: string }> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { projectId: true },
  })

  if (!team) throw new HTTPException(404, { message: 'No such team' })

  if (!isOfficer(user)) {
    const membership = await membershipOf(user.id, team.projectId)

    const allowed =
      membership?.rank === ProjectMemberRank.PROJECT_LEAD ||
      (membership?.rank === ProjectMemberRank.TEAM_LEAD &&
        membership.teamId === teamId)

    if (!allowed) throw forbidden()
  }

  await requireCurrentDues(user)
  return team
}

/**
 * The event permission matrix, as one predicate: officers, the person who made
 * it, the leads of the project it belongs to, and the leads of its team. That
 * last pair is deliberately asymmetric — a project lead can edit any of their
 * teams' events, a team lead only their own team's — which is exactly the
 * "project lead can manage the team leads' events" rule.
 *
 * Takes the event's ownership columns rather than an id: every caller has
 * already loaded the row, and a second read here would just be a place for the
 * two reads to disagree.
 */
export async function requireEventManager(
  user: SessionUser,
  event: {
    createdById: string | null
    projectId: string | null
    teamId: string | null
  },
): Promise<void> {
  if (!isOfficer(user) && event.createdById !== user.id) {
    // An event with no project is site business — officers and its creator only.
    if (!event.projectId) throw forbidden()

    const membership = await membershipOf(user.id, event.projectId)

    const allowed =
      membership?.rank === ProjectMemberRank.PROJECT_LEAD ||
      (membership?.rank === ProjectMemberRank.TEAM_LEAD &&
        event.teamId !== null &&
        membership.teamId === event.teamId)

    if (!allowed) throw forbidden()
  }

  await requireCurrentDues(user)
}
