import type { MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { prisma } from '../core/db.js'
import { ProjectMemberRank, UserRole } from '../generated/prisma/enums.js'
import { membershipStanding } from '../membership/semester.js'
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
 * **Two gates, in order: the survey, then dues.** Every check below ends with
 * `requireCurrentDues`, and the first thing that does is `requireSurvey` — the
 * one-time member survey outranks dues because paying is one of the things it
 * gates. After it, `hasAccess` is `duesPaidThrough > now`
 * and nothing else — the same question the dashboard draws its padlocks from
 * and the same one the Discord bot asks before handing out the Members role.
 * There is exactly one exemption, `ADMIN`, because the club cannot be in a
 * position where the only person who can fix a membership problem is locked out
 * by one. **Officers are not exempt**: a lead or an officer whose dues have
 * lapsed keeps their rank and loses the tools until they pay.
 *
 * **Reading is never gated.** Nothing checks dues in `requireProjectMember`,
 * because somebody who has let their dues run out is still on their projects
 * and can still look at them — they simply cannot change anything. That line is
 * the whole of what a lapsed member keeps, and it must not grow a dues check.
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

const NEVER_PAID =
  'This is for paid-up members. Dues take a minute on the dues page, and everything opens the moment they go through.'

const CLAIM_IT =
  'Membership is free right now — claim it on the dues page and this opens straight away. It takes one press and costs nothing.'

const SURVEY_OWED =
  'One thing first: the member survey. It takes about two minutes, it is only ever asked once, and everything opens as soon as it is in — the dues page included.'

/**
 * The gate ahead of the gate.
 *
 * The club needs shirt sizes, majors and — the one that matters at a meeting
 * with food at it — allergies, and it had no way to ask. So the survey is
 * required of everybody before anything else opens, **including the dues page**:
 * somebody who has not answered is not told to pay, because paying is one of
 * the things they cannot do yet.
 *
 * It is checked against `User.surveyCompletedAt` rather than against the
 * `member_surveys` row, and that is why this function is synchronous and free.
 * Session resolution already loaded the column; asking the table would be a
 * query on every authenticated request to learn something that changes once in
 * a member's life. See the column's own comment in `schema.prisma`.
 *
 * `ADMIN` is exempt for exactly the reason it is exempt from dues: whoever can
 * fix an account must not be lockable out of one. **Officers are not exempt.**
 * The whole club is being asked, and the board is part of the club.
 */
export function requireSurvey(user: SessionUser): void {
  if (isAdmin(user)) return
  if (user.surveyCompletedAt !== null) return

  throw new HTTPException(403, { message: SURVEY_OWED })
}

/**
 * The same check as middleware, for the two dues routes that need it.
 *
 * `POST /dues/checkout` and `POST /dues/activate` are the only places that want
 * the survey gate *without* the dues gate underneath it — everything else on
 * the site reaches both through `requireCurrentDues`.
 */
export const requireSurveyForRoute: MiddlewareHandler<AuthEnv> = async (
  c,
  next,
) => {
  requireSurvey(c.get('user'))
  await next()
}

/**
 * The one gate. Everything on this site that is not reading goes through here.
 *
 * **`hasAccess` is `duesPaidThrough > now` and nothing else**, so this is the
 * same question the Discord bot asks before handing out the Members role and
 * the same one the dashboard asks before drawing a padlock. There is no longer
 * a second, looser notion of access for the summer or the opening weeks:
 * those are free, but they are *claimed*, and claiming puts a real date on the
 * row like paying does.
 *
 * `ADMIN` is exempt and always will be. Whoever can fix a membership must not
 * be lockable out by a membership — that is how a club ends up with nobody able
 * to put it right. **Nothing else is exempt, officers included.** A board that
 * has not paid is a board that cannot reach its own desks, which is the club's
 * decision and not this file's to soften.
 *
 * **The survey is asked before any of this**, so the refusals below are only
 * ever reached by somebody who has answered it. That ordering is the point:
 * "pay your dues" is the wrong sentence for a person who cannot reach the dues
 * page yet.
 *
 * Three refusals, because they need three different sentences and getting them
 * the wrong way round is how somebody two years in reads that they were never
 * a member:
 *
 *   - a free window is running → say so, because they are one press from being
 *     let in and quoting a price at them would be false;
 *   - a date that has run out → they are a member who lapsed, and nothing has
 *     been taken away permanently;
 *   - no date ever → a newcomer, who is told what membership is.
 */
export async function requireCurrentDues(user: SessionUser): Promise<void> {
  if (isAdmin(user)) return

  // The survey first, and this one line is what puts it in front of every
  // gated route on the site — they all end here. Somebody who has not filled
  // it in is never told to pay: paying is behind the same gate.
  requireSurvey(user)

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

/**
 * There used to be a second, stricter gate here, and it is gone on purpose.
 *
 * `requireClubMember` refused a `GUEST` outright *on top of* the dues check,
 * and it existed for one reason: coverage alone would have let an account made
 * ten minutes ago order prints, because the summer and the opening weeks
 * reported `hasAccess: true` for everybody. That is no longer true. Access is
 * now `duesPaidThrough > now`, which can only be set by paying, claiming or an
 * officer granting — and all three promote a `GUEST` in the same transaction.
 * So the role check had become a test that could never fail for anybody who had
 * got past the first one, and two gates that always agree are one gate and a
 * place for them to stop agreeing.
 *
 * 3D printing and equipment borrowing now use `requireDuesForRoute` like
 * everything else. The two *sentences* survive — a newcomer and a lapsed member
 * still hear different things — but they are chosen in `requireCurrentDues`
 * from the date rather than from the role.
 */

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
