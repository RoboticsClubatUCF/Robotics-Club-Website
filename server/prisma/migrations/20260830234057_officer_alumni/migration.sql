-- Who used to run the club, mirrored off the Discord Officer Alumni role.
--
-- One flag, written only by `syncOfficerAlumni` in `src/discord/discordAlumni.ts`.
-- It is what `/members?status=alumni` selects on, and it is deliberately not
-- `users.active`: that column already has an owner — `membershipUpdateFor` sets
-- it back to true on every payment — so a Discord sweep writing it would be a
-- second writer of one column, and the two would undo each other every ten
-- minutes. They are also different facts: a former president who still pays dues
-- is a current member *and* an officer alumnus.
--
-- Safe to apply to a populated table: NOT NULL with a default, so every existing
-- row gets `false` and the first sweep marks the twenty-seven people who hold
-- the role. No backfill, so the statement order here is free.
--
-- `migrate diff` also wanted `ALTER TABLE "projects" ALTER COLUMN
-- "meeting_weekdays" DROP DEFAULT`, which is unrelated drift left by
-- 20260824220000 and not this migration's business — the same line 20260825224248,
-- 20260826230843, 20260829220652, 20260829224954 and 20260830084410 each had to
-- strip. It wants its own commit, and until it gets one every generated
-- migration will keep offering it.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "officer_alumnus" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "users_officer_alumnus_idx" ON "users"("officer_alumnus");
