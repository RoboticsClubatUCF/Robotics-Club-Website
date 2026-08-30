-- What a sponsorship costs and what the club gives back, which was four
-- hardcoded objects in `web/src/content/sponsorship.ts` marked PLACEHOLDER
-- until now. Officers write both from `/dashboard/officer/sponsors`, and an
-- unwritten tier is absent from the price list rather than quoting a figure
-- nobody agreed to — nothing seeds these tables. See `SponsorTierOffer` and
-- `InKindOffer` in schema.prisma.
--
-- `sponsor_tier_offers` is keyed by the tier itself: one offer per level, and
-- ordering by the key is ordering by the ranking, because Postgres sorts an
-- enum by declaration order.
--
-- Written by hand rather than taken from `migrate diff` as it came: that also
-- wanted to DROP DEFAULT on `projects.meeting_weekdays`, which is unrelated
-- drift left by 20260824220000 and not this migration's business — the same
-- edit 20260825224248 and 20260826230843 made, for the same reason.

-- CreateTable
CREATE TABLE "sponsor_tier_offers" (
    "tier" "SponsorTier" NOT NULL,
    "amount" TEXT NOT NULL,
    "blurb" TEXT NOT NULL,
    "benefits" TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sponsor_tier_offers_pkey" PRIMARY KEY ("tier")
);

-- CreateTable
CREATE TABLE "in_kind_offers" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "blurb" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "in_kind_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "in_kind_offers_sort_order_idx" ON "in_kind_offers"("sort_order");
