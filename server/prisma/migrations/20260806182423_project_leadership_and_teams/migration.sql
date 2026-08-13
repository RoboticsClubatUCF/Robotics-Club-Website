-- CreateEnum
CREATE TYPE "ProjectMemberRank" AS ENUM ('PROJECT_LEAD', 'TEAM_LEAD', 'MEMBER');

-- AlterTable
ALTER TABLE "project_members" ADD COLUMN     "rank" "ProjectMemberRank" NOT NULL DEFAULT 'MEMBER',
ADD COLUMN     "team_id" TEXT;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "meeting_location" TEXT,
ADD COLUMN     "meeting_time" TEXT,
ADD COLUMN     "meeting_weekday" INTEGER;

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "teams_project_id_name_key" ON "teams"("project_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "teams_id_project_id_key" ON "teams"("id", "project_id");

-- CreateIndex
CREATE INDEX "project_members_team_id_idx" ON "project_members"("team_id");

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_team_id_project_id_fkey" FOREIGN KEY ("team_id", "project_id") REFERENCES "teams"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;
