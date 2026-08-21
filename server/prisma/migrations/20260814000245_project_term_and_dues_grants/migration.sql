-- Who granted a comped term. Nullable and additive, so nothing to think about.

-- AlterTable
ALTER TABLE "dues_payments" ADD COLUMN     "granted_by_id" TEXT;

-- AddForeignKey
ALTER TABLE "dues_payments" ADD CONSTRAINT "dues_payments_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The term a project is built for.
--
-- Three steps rather than the one `migrate diff` generates, because these
-- columns are NOT NULL and the table has rows in it: `ADD COLUMN ... NOT NULL`
-- with no default is refused outright on a non-empty table. The usual escape —
-- a DEFAULT — is worse here than it looks. It has to be dropped again in this
-- same file or the next `migrate diff` emits the DROP as a correction inside an
-- unrelated migration, and if that line is ever lost every project created from
-- then on carries a term nobody chose.
--
-- Nullable, backfilled, tightened. The end state is exactly what schema.prisma
-- declares, so `migrate diff --exit-code` comes back empty afterwards.

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "term_year" INTEGER,
ADD COLUMN     "term_season" "Season";

-- Backfill, run once and never again.
--
-- `started_at` is the truthful answer wherever somebody set one, and almost
-- nobody has: nothing in the API writes it — neither the create route nor the
-- edit route carries the field — so it is a Prisma Studio column. In practice
-- this reads `created_at`, the moment the project was entered, which is the
-- only signal every row actually has.
--
-- The month boundaries are FALLBACK_START from src/semester.ts — spring
-- 12 January, summer 18 May, fall 24 August — deliberately, so this one-off
-- stamp and a term read at runtime cannot disagree by more than the few days
-- UCF moves classes by. A row dated before 12 January lands in that year's
-- spring, which is also what `currentTerm` says during that break.
--
-- Expect the club's multi-year builds to land in a past term and need rolling
-- forward by hand. That is the feature working, not a bad backfill: a stamp
-- that called everything current would produce exactly the state this column
-- exists to fix, and nobody could tell which rows were guesses.
UPDATE "projects" AS p
SET "term_year" = t.y,
    "term_season" = (
      CASE
        WHEN t.at < make_date(t.y, 5, 18) THEN 'SPRING'
        WHEN t.at < make_date(t.y, 8, 24) THEN 'SUMMER'
        ELSE 'FALL'
      END
    )::"Season"
FROM (
  SELECT "id",
         COALESCE("started_at", "created_at") AS at,
         EXTRACT(YEAR FROM COALESCE("started_at", "created_at"))::int AS y
  FROM "projects"
) AS t
WHERE p."id" = t."id";

-- Now they can be what the schema says they are. Same migration, so there is no
-- window in which a row could be inserted without a term.
ALTER TABLE "projects" ALTER COLUMN "term_year" SET NOT NULL,
ALTER COLUMN "term_season" SET NOT NULL;
