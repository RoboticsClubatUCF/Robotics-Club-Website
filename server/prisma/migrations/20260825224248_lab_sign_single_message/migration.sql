-- The lab sign is one message now, edited for ever, so nothing announces and
-- there is no announcement to remember. `announced_at` existed only to stop the
-- @Members ping going out twice for one opening; with no post there is no ping.
-- See `src/labStatus.ts`.
--
-- Written by hand rather than taken from `migrate diff` as it came: that also
-- wanted to DROP DEFAULT on `projects.meeting_weekdays`, which is unrelated
-- drift left by 20260824220000 and not this migration's business.

-- AlterTable
ALTER TABLE "lab_status" DROP COLUMN "announced_at";
