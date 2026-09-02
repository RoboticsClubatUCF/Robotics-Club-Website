import { HTTPException } from 'hono/http-exception'
import { prisma } from '../core/db.js'
import { ProjectMemberRank } from '../generated/prisma/enums.js'

/**
 * Seating somebody as a project's lead, or standing them down.
 *
 * **A project has at most one `PROJECT_LEAD`, and this is the only place that
 * sentence is enforced.** `TEAM_LEAD` is deliberately not this function's
 * business and stays uncapped — a project has as many team leads as it has
 * teams, and they are granted against a team by `PATCH /projects/:id/members/:userId`
 * in `projectManage.ts`, whose own enum refuses `PROJECT_LEAD` so the two routes
 * cannot both mint one.
 *
 * It used to be two statements in a route handler: read the incumbent, then
 * upsert. Two officers appointing different people in the same instant both
 * passed the read and both wrote, and the project ended up with two leads — a
 * state `schema.prisma` says cannot exist, visible on the manage page, and
 * fixable only by noticing it. The comment in the route said so and left it.
 *
 * **The fix is a row lock on the project, not a partial unique index and not
 * `Serializable`.** The index is refused for the reason `OfficerTerm` refuses
 * one: Prisma cannot express it, so it would live in the database and not in
 * `schema.prisma`, and the next generated migration would emit a `DROP INDEX`
 * for it into something unrelated. `Serializable` would work and costs a
 * retry loop plus decoding a 40001 out of the driver — and Prisma 7's adapter
 * buries error codes in three shapes, which `uniqueConflict` in `signup.ts`
 * already had to learn the hard way. `SELECT … FOR UPDATE` needs neither: two
 * appointments to the *same* project queue on that project's own row at the
 * default isolation level, so the second one reads the first one's committed
 * lead and answers the 409 it should have answered. Nothing else in the
 * database is blocked, because the lock is one row wide.
 */
export async function appointLead(
  projectId: string,
  userId: string,
  rank: typeof ProjectMemberRank.PROJECT_LEAD | typeof ProjectMemberRank.MEMBER,
) {
  return prisma.$transaction(async (tx) => {
    // The gate. Taken before the read below and held to commit, so "is there a
    // lead" and "there is now" cannot be separated by another transaction.
    // Demotions take it too: standing the incumbent down and appointing their
    // successor are the two halves of one swap an officer does in two presses,
    // and a demotion that raced an appointment could otherwise strand both.
    await tx.$executeRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`

    if (rank === ProjectMemberRank.PROJECT_LEAD) {
      // Excluding the person being appointed, so re-appointing the sitting lead
      // is idempotent rather than a conflict with themselves.
      const incumbent = await tx.projectMember.findFirst({
        where: {
          projectId,
          rank: ProjectMemberRank.PROJECT_LEAD,
          userId: { not: userId },
        },
        select: { user: { select: { fullName: true } } },
      })

      // Specific enough to act on, which the shared 403 deliberately is not —
      // the sentence names the incumbent because the next step is standing that
      // particular person down, with the button directly beside this one.
      if (incumbent) {
        throw new HTTPException(409, {
          message: `${incumbent.user.fullName} already leads this project. Stand them down first — a project has one lead.`,
        })
      }
    }

    // Upsert, because the person an officer appoints lead has often not joined
    // through the site — appointing them *is* how they land on the project.
    return tx.projectMember.upsert({
      where: { projectId_userId: { projectId, userId } },
      create: { projectId, userId, rank },
      // Demotion also clears any team-lead seat: a rank set here is the whole
      // answer, not a layer over the old one.
      update: { rank },
      select: { projectId: true, userId: true, rank: true, teamId: true },
    })
  })
}
