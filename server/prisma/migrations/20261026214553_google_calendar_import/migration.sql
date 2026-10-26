-- AlterTable
ALTER TABLE "events" ADD COLUMN     "google_calendar_id" TEXT,
ADD COLUMN     "google_id" TEXT;

-- CreateTable
CREATE TABLE "google_calendars" (
    "id" TEXT NOT NULL,
    "ics_url" TEXT NOT NULL,
    "name" TEXT,
    "synced_at" TIMESTAMP(3),
    "sync_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "google_calendars_ics_url_key" ON "google_calendars"("ics_url");

-- CreateIndex
CREATE UNIQUE INDEX "events_google_calendar_id_google_id_key" ON "events"("google_calendar_id", "google_id");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_google_calendar_id_fkey" FOREIGN KEY ("google_calendar_id") REFERENCES "google_calendars"("id") ON DELETE SET NULL ON UPDATE CASCADE;
