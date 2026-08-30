-- The photographs beside the landing page's headline. The right half of the
-- hero was artwork in the bundle until now, so changing it took a deploy; it is
-- the club's own photos, and officers add and remove them from
-- `/dashboard/officer/front-page`. Empty is a supported state and puts the
-- artwork back. See `HeroSlide` in schema.prisma.
--
-- Written by hand rather than taken from `migrate diff` as it came: that also
-- wanted to DROP DEFAULT on `projects.meeting_weekdays`, which is unrelated
-- drift left by 20260824220000 and not this migration's business — the same
-- edit 20260825224248 made, for the same reason.

-- CreateTable
CREATE TABLE "hero_slides" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "focal_x" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "focal_y" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "zoom" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hero_slides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hero_slides_sort_order_idx" ON "hero_slides"("sort_order");
