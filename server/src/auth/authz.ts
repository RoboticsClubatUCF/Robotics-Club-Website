import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { prisma } from '../core/db.js'
import { ProjectMemberRank, UserRole } from '../generated/prisma/enums.js'
import { membershipStanding } from '../membership/semester.js'
import type { AuthEnv, SessionUser } from './session.js'

/**
 * Who may do what, inside a project.
 *
 * The rule that shapes everything here: project authority is per-project. The lead of
 * one project is a plain member on every other, so nothing in this file reads the
 * `UserRole` ladder except to let officers through and refuse a `GUEST`. The rank that
 * grants is `ProjectMember.rank`, scoped by its primary key to one project.
 *
 * `UserRole` used to carry `PROJECT_LEAD` and `TEAM_LEAD` as roster labels, spelled
 * the same as that column's values and meaning something else. Both are gone: no value
 * of `UserRole` says anything about any project, and a check here that needs one is
 * wrong.
 *
 * Officers and admins pass every check — they create projects and appoint leads, and a
 * lead who quits mid-term must not leave a project nobody can administer.
 *
 * Every refusal is the same sentence and the same 403. Which check failed isn't
 * something a stranger probing project ids should learn, and the fix is "ask your lead"
 * in every case.
 *
 * One gate, and it's dues. `hasAccess` is `duesPaidThrough > now` and nothing else —
 * the same question the dashboard draws its padlocks from and the bot asks before
 * handing out the Members role. Exactly one exemption, `ADMIN`, because the club can't
 * be in a position where the only person who can fix a membership is locked out by one.
 * Officers are not exempt.
 *
 * There used to be a second gate in front of it: `requireSurvey` refused everything,
 * including the dues page, until the one-time survey was answered — so the club
 * couldn't take somebody's money until it had their shirt size. The survey is an
 * invitation now and nothing is refused for a null `surveyCompletedAt`.
 *
 * Reading is never gated. Nothing checks dues in `requireProjectMember`, because
 * somebody whose dues ran out is still on their projects and can still look at them.
 * That line is the whole of what a lapsed member keeps, and it must not grow a check.
 *
 * The dues check runs after the rank check, deliberately: somebody who was never a lead
 * gets the ordinary 403 rather than a note about dues, which would tell them paying
 * would hand them a lead's tools.
 */

const forbidden = () =>
  new HTTPException(403, { message: 'You do not have permission to do that.' })

export const isOfficer = (user: SessionUser): boolean =>
  user.role === UserRole.ADMIN || user.role === UserRole.OFFICER

export const isAdmin = (user: SessionUser): boolean =>
  user.role === UserRole.ADMIN

const LAPSED =
  'Your dues have lapsed. Pay them and everything comes straight back — your projects and your standing on them have not changed.'

const NEVER_PAID =
  'This is for paid-up members. Dues take a minute on the dues page, and everything opens the moment they go through.'

const CLAIM_IT =
  'Membership is free right now — claim it on the dues page and this opens straight away. It takes one press and costs nothing.'

/**
 * The one gate. Everything that isn't reading goes through here.
 *
 * `hasAccess` is `duesPaidThrough > now` and nothing else, so this is the same question
 * the Discord bot asks and the same one the dashboard asks before drawing a padlock.
 * There's no looser notion of access for the summer or the opening weeks: those are
 * free, but they're claimed, and claiming puts a real date on the row.
 *
 * `ADMIN` is exempt and always will be — whoever can fix a membership must not be
 * lockable out by one. Nothing else is exempt, officers included.
 *
 * Three refusals, because they need three different sentences and getting them the
 * wrong way round is how somebody two years in reads that they were never a member:
 *
 *   - a free window is running -> say so, because they're one press from being let in
 *     and quoting a price would be false;
 *   - a date that has run out -> a member who lapsed, nothing taken away permanently;
 *   - no date ever -> a newcomer, who is told what membership is.
 */
export async function requireCurrentDues(user: SessionUser): Promise<void> {
  if (isAdmin(user)) return

  const standing = await membershipStanding(user.duesPaidThrough)
  if (standing.hasAccess) return

  throw new HTTPException(403, {
    message: standing.canActivate
      ? CLAIM_IT
      : user.duesPaidThrough === null
        ? NEVER_PAID
        : LAPSED,
  })
}

/**
 * The same check as middleware, for whole routers.
 *
 * The club's line: with dues owed, the dashboard is your projects and the page that
 * takes the payment. 3D printing and equipment borrowing are the club spending money on
 * you, so they sit behind it — and unlike the management tools they're refused by rank
 * to nobody, so this is the only thing between a lapsed account and a print.
 */
export const requireDuesForRoute: MiddlewareHandler<AuthEnv> = async (
  c,
  next,
) => {
  await requireCurrentDues(c.get('user'))
  await next()
}

/**
 * There used to be a second, stricter gate here, and it's gone on purpose.
 *
 * `requireClubMember` refused a `GUEST` outright on top of the dues check, because
 * coverage alone would have let an account made ten minutes ago order prints — the
 * summer and the opening weeks reported `hasAccess: true` for everybody. Access is now
 * `duesPaidThrough > now`, which can only be set by paying, claiming or an officer
 * granting, and all three promote a `GUEST` in the same transaction. So the role check
 * had become one that could never fail, and two gates that always agree are one gate
 * and a place for them to stop agreeing.
 *
 * The two sentences survive — a newcomer and a lapsed member still hear different
 * things — but they're chosen in `requireCurrentDues` from the date rather than the role.
 */

/** For the routes that are officer business outright — queues, appointments. */
export const requireOfficer: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const user = c.get('user')

  if (!isOfficer(user)) throw forbidden()
  await requireCurrentDues(user)
  await next()
}

/**
 * One person's standing on one project, or null for a stranger. Also null for a project
 * that doesn't exist — callers that need to tell those apart fetch the project first,
 * and mostly they already have.
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
 * Team-lead authority over one team: its own leads, the leads of the project it belongs
 * to, and officers. Returns the team's project id because every caller needs it next.
 *
 * A missing team is a 404 rather than the shared 403 — the id came from a URL, and "no
 * such team" isn't information about anybody's rank.
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
 * The event permission matrix as one predicate: officers, the person who made it, the
 * leads of the project it belongs to, and the leads of its team. That last pair is
 * deliberately asymmetric — a project lead can edit any of their teams' events, a team
 * lead only their own team's.
 *
 * Takes the event's ownership columns rather than an id: every caller has already
 * loaded the row, and a second read would be a place for the two to disagree.
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
