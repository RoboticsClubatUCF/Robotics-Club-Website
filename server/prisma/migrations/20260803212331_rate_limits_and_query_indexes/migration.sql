-- CreateTable
CREATE TABLE "rate_limits" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "rate_limits_expires_at_idx" ON "rate_limits"("expires_at");

-- CreateIndex
CREATE INDEX "events_published_ends_at_idx" ON "events"("published", "ends_at");

-- CreateIndex
CREATE INDEX "members_active_role_full_name_idx" ON "members"("active", "role", "full_name");

-- CreateIndex
CREATE INDEX "projects_featured_started_at_idx" ON "projects"("featured", "started_at");

-- CreateIndex
CREATE INDEX "sponsors_active_tier_idx" ON "sponsors"("active", "tier");
