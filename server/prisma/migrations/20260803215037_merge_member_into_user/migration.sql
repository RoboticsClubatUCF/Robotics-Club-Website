-- Fold `members` into `users`, so there is one row per person and one role
-- ladder (UserRole) that says what that person may do.
--
-- Written by hand rather than generated, for three reasons:
--   * the enum swap has to preserve declaration order — Prisma diffs only the
--     *set* of enum values, and Postgres sorts by declaration order;
--   * rows have to be copied across before `members` is dropped, which a
--     generated migration would never do;
--   * someone who had both a login and a roster entry has to collapse into a
--     single row instead of colliding on `users_email_key`.

-- 1. UserRole becomes the permission ladder: most permission first, least last.
--    EDITOR and VIEWER are gone; the club roles from MemberRole take their place.
CREATE TYPE "UserRole_new" AS ENUM ('ADMIN', 'OFFICER', 'PROJECT_LEAD', 'TEAM_LEAD', 'MEMBER', 'MENTOR', 'ALUMNUS', 'GUEST');

ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "users"
  ALTER COLUMN "role" TYPE "UserRole_new"
  USING (
    CASE "role"::text
      WHEN 'ADMIN'  THEN 'ADMIN'
      WHEN 'EDITOR' THEN 'OFFICER'
      WHEN 'VIEWER' THEN 'MEMBER'
    END
  )::"UserRole_new";

DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";

ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'GUEST';

-- 2. users takes on the roster columns. `email` and `password_hash` become
--    optional because most people on the roster never sign in, and `slug` is
--    null for accounts that have no public profile page.
ALTER TABLE "users" RENAME COLUMN "name" TO "full_name";

ALTER TABLE "users"
  ALTER COLUMN "email" DROP NOT NULL,
  ALTER COLUMN "password_hash" DROP NOT NULL,
  ADD COLUMN "slug" TEXT,
  ADD COLUMN "title" TEXT,
  ADD COLUMN "grad_year" INTEGER,
  ADD COLUMN "bio" TEXT,
  ADD COLUMN "photo_url" TEXT,
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "joined_at" TIMESTAMP(3),
  ADD COLUMN "subteam_id" TEXT;

-- 3. A member sharing an email with a login is the same person: fold the roster
--    fields onto the login row. LEAST picks the stronger of the two roles —
--    the enum sorts most-permissive first, so the smaller value wins.
UPDATE "users" u
SET "slug"       = m."slug",
    "full_name"  = m."full_name",
    "title"      = m."title",
    "grad_year"  = m."grad_year",
    "bio"        = m."bio",
    "photo_url"  = m."photo_url",
    "active"     = m."active",
    "joined_at"  = m."joined_at",
    "subteam_id" = m."subteam_id",
    "role"       = LEAST(u."role", (
      CASE m."role"::text
        WHEN 'CAPTAIN' THEN 'OFFICER'
        WHEN 'LEAD'    THEN 'TEAM_LEAD'
        WHEN 'MEMBER'  THEN 'MEMBER'
        WHEN 'MENTOR'  THEN 'MENTOR'
        WHEN 'ALUMNUS' THEN 'ALUMNUS'
      END
    )::"UserRole")
FROM "members" m
WHERE m."email" IS NOT NULL AND lower(m."email") = lower(u."email");

-- Project credits follow that person to the surviving row.
UPDATE "project_members" pm
SET "member_id" = u."id"
FROM "members" m
JOIN "users" u ON m."email" IS NOT NULL AND lower(u."email") = lower(m."email")
WHERE pm."member_id" = m."id";

-- 4. Everyone else becomes a new user row, keeping their id so references to it
--    survive. No password hash: these people have never signed in.
INSERT INTO "users" (
  "id", "slug", "full_name", "email", "password_hash", "role", "title",
  "grad_year", "bio", "photo_url", "active", "joined_at", "created_at",
  "updated_at", "subteam_id"
)
SELECT
  m."id", m."slug", m."full_name", m."email", NULL,
  (
    CASE m."role"::text
      WHEN 'CAPTAIN' THEN 'OFFICER'
      WHEN 'LEAD'    THEN 'TEAM_LEAD'
      WHEN 'MEMBER'  THEN 'MEMBER'
      WHEN 'MENTOR'  THEN 'MENTOR'
      WHEN 'ALUMNUS' THEN 'ALUMNUS'
    END
  )::"UserRole",
  m."title", m."grad_year", m."bio", m."photo_url", m."active",
  m."joined_at", m."created_at", m."updated_at", m."subteam_id"
FROM "members" m
WHERE NOT EXISTS (
  SELECT 1 FROM "users" u
  WHERE m."email" IS NOT NULL AND lower(u."email") = lower(m."email")
);

-- 5. project_members now points at users. The primary key keeps its name, so
--    only the column, its index and its foreign key change.
ALTER TABLE "project_members" DROP CONSTRAINT "project_members_member_id_fkey";

DROP INDEX "project_members_member_id_idx";

ALTER TABLE "project_members" RENAME COLUMN "member_id" TO "user_id";

CREATE INDEX "project_members_user_id_idx" ON "project_members"("user_id");

ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. members has no rows left that users doesn't have. Its own indexes and
--    foreign keys go with it.
DROP TABLE "members";

DROP TYPE "MemberRole";

-- 7. The constraints members used to carry now live on users.
CREATE UNIQUE INDEX "users_slug_key" ON "users"("slug");

CREATE INDEX "users_subteam_id_idx" ON "users"("subteam_id");

CREATE INDEX "users_active_idx" ON "users"("active");

CREATE INDEX "users_active_role_full_name_idx" ON "users"("active", "role", "full_name");

ALTER TABLE "users" ADD CONSTRAINT "users_subteam_id_fkey" FOREIGN KEY ("subteam_id") REFERENCES "subteams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
