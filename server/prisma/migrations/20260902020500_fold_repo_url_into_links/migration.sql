-- The repository stops being a column and becomes an ordinary resource row.
--
-- `repo_url` printed as a fixed `SOURCE CODE` row at the head of `/ RESOURCES`
-- and drew a fixed box in the editor, so the section could never be empty on a
-- site where most of what the club builds has no repository at all.
--
-- The backfill and the drop are in one file on purpose: Prisma runs a migration
-- inside a transaction, so there is no moment at which the column is gone and
-- the links have not landed.

-- `-1` so a repository still leads the list, as it did when it was hardcoded
-- above it. The next `PATCH /links` renumbers the whole set from zero like any
-- other edit, which is when it takes its place among the rest.
INSERT INTO "project_links" ("id", "project_id", "label", "url", "sort_order", "created_at")
SELECT gen_random_uuid()::text, "id", 'Source code', "repo_url", -1, now()
FROM "projects"
WHERE "repo_url" IS NOT NULL AND btrim("repo_url") <> '';

ALTER TABLE "projects" DROP COLUMN "repo_url";
