-- Calendar subscription tokens, and the Discord scheduled events the sync owns.
-- CreateTable
CREATE TABLE "calendar_feeds" (
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_feeds_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "discord_scheduled_events" (
    "event_id" TEXT NOT NULL,
    "discord_event_id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discord_scheduled_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_feeds_token_key" ON "calendar_feeds"("token");

-- CreateIndex
CREATE UNIQUE INDEX "discord_scheduled_events_discord_event_id_key" ON "discord_scheduled_events"("discord_event_id");

-- AddForeignKey
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
