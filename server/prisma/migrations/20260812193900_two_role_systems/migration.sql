-- Two role systems, told apart at last.
--
-- `UserRole` was carrying `PROJECT_LEAD` and `TEAM_LEAD` alongside the club
-- standings, spelled identically to `ProjectMemberRank`'s values and meaning
-- something else entirely: those two were roster labels that granted nothing,
-- while the column that actually decides project permission is
-- `project_members.rank`. This migration removes the duplicate vocabulary.
--
-- After it: `UserRole` answers "have you joined, and do you run the club";
-- `ProjectMemberRank` answers "what do you run inside this one project"; and
-- `users.dues_paid_through` answers "are your dues current". Three questions,
-- three columns, no overlap.
--
-- Hand-written on purpose. Prisma diffs only the *set* of enum values and
-- cannot author a removal safely, and `migrate diff` would emit DROP COLUMN +
-- ADD COLUMN for the rename in step 3 — which would throw away every display
-- string in the table. See the note on `UserRole` in schema.prisma and the
-- worked example in 20260803215037_merge_member_into_user.

-- ---------------------------------------------------------------------------
-- 1. At most one PROJECT_LEAD per project.
--
-- Nothing enforced this before — the appointment route upserted without
-- counting — so a database where an officer appointed a co-lead violates the
-- new rule before the code that keeps it exists. The development database has
-- no such project; this clause is for every other one, and it is a no-op on
-- clean data.
--
-- Longest in the club keeps the seat. `project_members` has no timestamp of
-- its own, so the ordering comes from the person: when they joined, failing
-- that when their account was made, failing that their id, so the result is
-- deterministic rather than whatever the planner returned first.
UPDATE "project_members" pm
SET "rank" = 'MEMBER'
WHERE pm."rank" = 'PROJECT_LEAD'
  AND pm."user_id" <> (
    SELECT keep."user_id"
    FROM "project_members" keep
    JOIN "users" u ON u."id" = keep."user_id"
    WHERE keep."project_id" = pm."project_id"
      AND keep."rank" = 'PROJECT_LEAD'
    ORDER BY u."joined_at" ASC NULLS LAST, u."created_at" ASC, keep."user_id" ASC
    LIMIT 1
  );

-- ---------------------------------------------------------------------------
-- 2. Shrink UserRole to the four club standings.
--
-- All eight arms are spelled out rather than leaning on an ELSE: a CASE that
-- falls off the end yields NULL, `users.role` is NOT NULL, and the failure
-- would arrive as a constraint violation with nothing to say about which value
-- was missed. Written out, the mapping is also readable a year from now.
--
-- Everything removed lands on MEMBER, including ALUMNUS. Not GUEST: the public
-- roster filters `role <> 'GUEST'` (see `onRoster` in src/routes/content.ts),
-- so demoting alumni would silently take every one of them off the roster.
-- `users.active` is already what marks somebody as no longer around, and after
-- this it is the only thing that does.
--
-- The default has to come off before the type changes and go back on after, or
-- DROP TYPE trips over the dependent default expression. The
-- `(active, role, full_name)` index needs no handling of its own — ALTER COLUMN
-- ... TYPE rewrites the table and rebuilds every index on it.
CREATE TYPE "UserRole_new" AS ENUM ('ADMIN', 'OFFICER', 'MEMBER', 'GUEST');

ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "users"
  ALTER COLUMN "role" TYPE "UserRole_new"
  USING (
    CASE "role"::text
      WHEN 'ADMIN'        THEN 'ADMIN'
      WHEN 'OFFICER'      THEN 'OFFICER'
      WHEN 'MEMBER'       THEN 'MEMBER'
      WHEN 'GUEST'        THEN 'GUEST'
      -- Roster labels. What they described lives on project_members.rank.
      WHEN 'PROJECT_LEAD' THEN 'MEMBER'
      WHEN 'TEAM_LEAD'    THEN 'MEMBER'
      -- Standings the club no longer distinguishes by role. `users.title`
      -- keeps whatever was typed there, and `users.active` marks the alumni.
      WHEN 'MENTOR'       THEN 'MEMBER'
      WHEN 'ALUMNUS'      THEN 'MEMBER'
    END
  )::"UserRole_new";

DROP TYPE "UserRole";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";

ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'GUEST';

-- ---------------------------------------------------------------------------
-- 3. project_members.role -> title.
--
-- A rename, not a drop and an add. This column is the free-text display string
-- ("Software Lead") and has nothing to do with any role enum; `title` is what
-- the same thing is called on `users`. There is no @renamedFrom in Prisma, so
-- generated SQL would drop the column and every value in it — this line is why
-- the file is hand-written.
ALTER TABLE "project_members" RENAME COLUMN "role" TO "title";
