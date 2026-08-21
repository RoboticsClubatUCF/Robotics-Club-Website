-- The Discord role a project's crew carries. Nullable, and no unique index:
-- a build that runs several semesters is several rows sharing one role.
-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "discord_role_id" TEXT;
