-- Officer tenure: `officer_terms` becomes the record of who sits on the board,
-- which seat, and between which dates. `users.officer_position` goes with it.
--
-- Hand-written rather than generated, and the order is the whole point. The
-- generated version dropped `start_year`/`end_year` and `users.officer_position`
-- before anything read them, and added `started_at NOT NULL` to a table that
-- already has rows — which fails outright. Every existing row is carried over
-- below and only then are the old columns dropped.

-- CreateEnum
CREATE TYPE "OfficerTermSource" AS ENUM ('DISCORD', 'MANUAL');

-- AlterTable: the new columns arrive nullable so the backfill has somewhere to
-- write. `position` becomes nullable because Discord decides *that* somebody is
-- on the board and an officer decides *which seat* — an officer promoted a
-- minute ago genuinely holds none yet.
ALTER TABLE "officer_terms"
  ADD COLUMN "started_at"   TIMESTAMP(3),
  ADD COLUMN "ended_at"     TIMESTAMP(3),
  ADD COLUMN "ended_reason" TEXT,
  ADD COLUMN "source" "OfficerTermSource" NOT NULL DEFAULT 'MANUAL',
  ALTER COLUMN "position" DROP NOT NULL;

-- Backfill the archive rows that already exist. The old columns were academic
-- years, so a term is taken to run from August of the first to May of the last;
-- a row whose years were equal was a single semester and ends that December.
UPDATE "officer_terms"
SET "started_at" = make_date("start_year", 8, 1)::timestamp,
    "ended_at"   = CASE
                     WHEN "end_year" > "start_year"
                       THEN make_date("end_year", 5, 31)::timestamp
                     ELSE make_date("start_year", 12, 31)::timestamp
                   END;

ALTER TABLE "officer_terms" ALTER COLUMN "started_at" SET NOT NULL;

-- The old year columns are dropped *before* the insert below, not after: they
-- are still NOT NULL, so any row added while they exist has to supply them.
-- Everything that needed to read them has now read them.
DROP INDEX "officer_terms_start_year_position_idx";
ALTER TABLE "officer_terms" DROP COLUMN "start_year", DROP COLUMN "end_year";

-- Everyone currently holding a seat becomes an *open* term, which is what the
-- board is read from now. `MANUAL`, because the sync did not open these and
-- must not close them — the faculty advisor holds a seat carrying no Discord
-- role at all, and a loop that closed every seat whose holder lacks the role
-- would stand them down on its first pass.
INSERT INTO "officer_terms" (
  "id", "position", "started_at", "source",
  "full_name", "photo_url", "user_id", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  "officer_position",
  COALESCE("joined_at", now()),
  'MANUAL',
  "full_name",
  "photo_url",
  "id",
  now(),
  now()
FROM "users"
WHERE "officer_position" IS NOT NULL;

-- AlterTable: only now that the seats have been read out of it.
DROP INDEX "users_officer_position_key";
ALTER TABLE "users" DROP COLUMN "officer_position";

-- CreateIndex
CREATE INDEX "officer_terms_ended_at_position_idx" ON "officer_terms"("ended_at", "position");
CREATE INDEX "officer_terms_started_at_idx" ON "officer_terms"("started_at");

-- CreateTable: a term whose dates the club has set by hand, ahead of UCF's feed.
CREATE TABLE "term_overrides" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "season" "Season" NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "set_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "term_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "term_overrides_year_season_key" ON "term_overrides"("year", "season");

-- AddForeignKey
ALTER TABLE "term_overrides" ADD CONSTRAINT "term_overrides_set_by_id_fkey" FOREIGN KEY ("set_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
