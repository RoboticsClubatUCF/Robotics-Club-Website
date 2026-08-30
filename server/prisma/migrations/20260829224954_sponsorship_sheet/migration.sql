-- The two gaps the club's real sponsorship sheet opened the moment it was typed
-- in. See `SponsorTierOffer.blurb` and `SponsorshipSheet` in schema.prisma.
--
-- `blurb` loses NOT NULL because the club's actual tiers are an amount and a
-- list of what you get, with no sentence between them — a required column meant
-- inventing four lines of marketing copy to satisfy the schema, which is the
-- failure the move off `content/sponsorship.ts` existed to end. Dropping a NOT
-- NULL takes no backfill and cannot fail on existing rows.
--
-- `sponsorship_sheet` is the fine print under the grid: the footnote markers
-- cited by two different tiers, and the note about the sponsorship being
-- tax-deductible. One row, always `current`, keyed by a column default — the
-- same shape as `lab_status`.
--
-- Written by hand rather than taken from `migrate diff` as it came: that also
-- wanted to DROP DEFAULT on `projects.meeting_weekdays`, which is unrelated
-- drift left by 20260824220000 and not this migration's business — the same
-- edit 20260825224248, 20260826230843 and 20260829220652 made.

-- AlterTable
ALTER TABLE "sponsor_tier_offers" ALTER COLUMN "blurb" DROP NOT NULL;

-- CreateTable
CREATE TABLE "sponsorship_sheet" (
    "id" TEXT NOT NULL DEFAULT 'current',
    "footnotes" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sponsorship_sheet_pkey" PRIMARY KEY ("id")
);
