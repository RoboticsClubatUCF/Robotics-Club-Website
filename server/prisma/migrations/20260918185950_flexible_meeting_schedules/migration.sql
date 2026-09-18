-- CreateEnum
CREATE TYPE "MeetingRepeat" AS ENUM ('WEEKLY', 'MONTHLY_WEEKDAY', 'MONTHLY_DAY', 'DATES');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "meeting_dates" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "meeting_interval" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "meeting_month_days" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "meeting_month_weeks" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "meeting_repeat" "MeetingRepeat",
ADD COLUMN     "meeting_starts_on" TEXT;

-- Every schedule that exists today is weekly. Only rows with both times count:
-- the rest were never drawn on a calendar, and stay that way with no repeat.
UPDATE "projects"
SET "meeting_repeat" = 'WEEKLY'
WHERE cardinality("meeting_weekdays") > 0
  AND "meeting_start_time" IS NOT NULL
  AND "meeting_end_time" IS NOT NULL;

-- CreateTable
CREATE TABLE "project_meeting_cancellations" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_meeting_cancellations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_meeting_cancellations_project_id_date_key" ON "project_meeting_cancellations"("project_id", "date");

-- AddForeignKey
ALTER TABLE "project_meeting_cancellations" ADD CONSTRAINT "project_meeting_cancellations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
