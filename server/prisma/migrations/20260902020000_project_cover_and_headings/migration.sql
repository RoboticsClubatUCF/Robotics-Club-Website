-- The cover a project shows on `/projects`, and what it calls its own sections.
--
-- Every column here carries a DEFAULT, so `schema.prisma` carries the matching
-- `@default` — the rule `meeting_weekdays` already exists for. Without it the
-- next `migrate diff` emits a correction for the drift into something unrelated.
ALTER TABLE "projects" ADD COLUMN "cover_from_gallery" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "projects" ADD COLUMN "cover_focal_x" DOUBLE PRECISION NOT NULL DEFAULT 50;
ALTER TABLE "projects" ADD COLUMN "cover_focal_y" DOUBLE PRECISION NOT NULL DEFAULT 50;
ALTER TABLE "projects" ADD COLUMN "cover_zoom" DOUBLE PRECISION NOT NULL DEFAULT 1;
ALTER TABLE "projects" ADD COLUMN "gallery_heading" TEXT;
ALTER TABLE "projects" ADD COLUMN "resources_heading" TEXT;
ALTER TABLE "projects" ADD COLUMN "team_heading" TEXT;

-- A project that already has a cover somebody chose keeps showing it. `true` is
-- the right default for a project made from here and the wrong one for every row
-- the club already has, all of which carry a `cover_url`.
UPDATE "projects" SET "cover_from_gallery" = false WHERE "cover_url" IS NOT NULL;

-- `/projects` prints `summary` and only `summary` now, and no project the club
-- has ever created has filled one in — so without this the list is fifty titles
-- above nothing on the day this deploys.
--
-- The club's own first paragraph, capped at the column's 500. Nothing is
-- invented and nothing is lost: `description` is untouched and still the whole
-- of what the project's own page prints. A lead who wants a different line
-- writes one in the editor, which is the point of the field.
UPDATE "projects"
SET "summary" = left(split_part("description", E'\n\n', 1), 500)
WHERE "summary" IS NULL
  AND "description" IS NOT NULL
  AND btrim("description") <> '';
