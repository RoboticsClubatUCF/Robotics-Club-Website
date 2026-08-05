-- CreateEnum
CREATE TYPE "OfficerPosition" AS ENUM ('PRESIDENT', 'VICE_PRESIDENT', 'TREASURER', 'SECRETARY', 'MARKETING', 'OUTREACH', 'LAB_MANAGER', 'FACULTY_ADVISOR');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "all_day" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "officer_position" "OfficerPosition";

-- CreateIndex
CREATE UNIQUE INDEX "users_officer_position_key" ON "users"("officer_position");
