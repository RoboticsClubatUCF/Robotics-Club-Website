-- Drops the club-wide subteam. A team is a working group inside one project and
-- always was; the standing division a member belonged to all year was a second
-- grouping nothing quite owned, and the two were confused constantly. `Team`,
-- `ProjectMember.rank` and TEAM_LEAD are untouched.
--
-- Destructive and not recoverable: the assignment lives only in the column this
-- drops. Nothing in the product ever wrote it outside the seed and Prisma
-- Studio, and every row carrying one was seeded.

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_subteam_id_fkey";

-- DropIndex
DROP INDEX "users_subteam_id_idx";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "subteam_id";

-- DropTable
DROP TABLE "subteams";
