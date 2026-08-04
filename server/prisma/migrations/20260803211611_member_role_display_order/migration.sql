-- Reorder MemberRole so leadership sorts first.
--
-- Postgres sorts an enum by the order its values were declared, and Prisma's
-- migration engine only diffs the *set* of enum values, not their order — a
-- reorder in schema.prisma produces an empty migration. So this is written by
-- hand. The value set is unchanged, so no row can fail the cast.

ALTER TYPE "MemberRole" RENAME TO "MemberRole_old";

CREATE TYPE "MemberRole" AS ENUM ('CAPTAIN', 'LEAD', 'MEMBER', 'MENTOR', 'ALUMNUS');

ALTER TABLE "members" ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "members"
  ALTER COLUMN "role" TYPE "MemberRole"
  USING "role"::text::"MemberRole";

ALTER TABLE "members" ALTER COLUMN "role" SET DEFAULT 'MEMBER';

DROP TYPE "MemberRole_old";
