-- AlterTable
ALTER TABLE "about_milestones" ADD COLUMN     "focal_x" DOUBLE PRECISION NOT NULL DEFAULT 50,
ADD COLUMN     "focal_y" DOUBLE PRECISION NOT NULL DEFAULT 50,
ADD COLUMN     "image_caption" TEXT,
ADD COLUMN     "image_url" TEXT,
ADD COLUMN     "zoom" DOUBLE PRECISION NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "about_stats" (
    "id" TEXT NOT NULL,
    "figure" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "about_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "about_stats_sort_order_idx" ON "about_stats"("sort_order");

-- The club's numbers as the officers gave them, so the live page has them on
-- the deploy rather than waiting for somebody to type them into the editor.
INSERT INTO "about_stats" ("id", "figure", "label", "sort_order", "created_at") VALUES
(gen_random_uuid(), $t$50+ years$t$, $t$of robotics at UCF$t$, 0, CURRENT_TIMESTAMP),
(gen_random_uuid(), $t$170+ members$t$, $t$across our programs$t$, 1, CURRENT_TIMESTAMP),
(gen_random_uuid(), $t$7 active projects$t$, $t$across multiple robotics disciplines$t$, 2, CURRENT_TIMESTAMP),
(gen_random_uuid(), $t$15 different majors$t$, $t$working across multiple disciplines$t$, 3, CURRENT_TIMESTAMP),
(gen_random_uuid(), $t$$15,000 annually$t$, $t$in funding from our various sponsors and supporters$t$, 4, CURRENT_TIMESTAMP);
