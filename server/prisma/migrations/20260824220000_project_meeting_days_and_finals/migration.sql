-- The weekly meeting becomes days plus a range, and the club's finals week
-- becomes something an officer can set.
--
-- Written by hand rather than generated: `prisma migrate dev` is interactive on
-- this box and exits rather than prompting. Apply with `prisma migrate deploy`.

-- --------------------------------------------------------------- meetings

ALTER TABLE "projects" ADD COLUMN "meeting_weekdays" INTEGER[] NOT NULL DEFAULT '{}';

UPDATE "projects"
   SET "meeting_weekdays" = ARRAY["meeting_weekday"]
 WHERE "meeting_weekday" IS NOT NULL;

ALTER TABLE "projects" RENAME COLUMN "meeting_time" TO "meeting_start_time";
ALTER TABLE "projects" ADD COLUMN "meeting_end_time" TEXT;

-- An hour after the start, which is exactly what the dashboard has been drawing
-- for these rows all along -- see the old `meetingsIn`. Nothing is invented by
-- preserving what the site already showed; a lead who meets for four hours can
-- now say so, and until they do the calendar reads the same as yesterday.
UPDATE "projects"
   SET "meeting_end_time" = to_char(
         ("meeting_start_time")::time + interval '1 hour', 'HH24:MI')
 WHERE "meeting_start_time" IS NOT NULL;

ALTER TABLE "projects" DROP COLUMN "meeting_weekday";

-- Default true: every project that already had a schedule meant it to be found.
ALTER TABLE "projects" ADD COLUMN "meetings_public" BOOLEAN NOT NULL DEFAULT true;

-- ----------------------------------------------------------------- finals

ALTER TABLE "term_overrides" ADD COLUMN "finals_starts_at" TIMESTAMP(3);
ALTER TABLE "term_overrides" ADD COLUMN "finals_ends_at" TIMESTAMP(3);
