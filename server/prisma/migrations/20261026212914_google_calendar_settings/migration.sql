-- CreateTable
CREATE TABLE "google_calendar" (
    "id" TEXT NOT NULL DEFAULT 'current',
    "ics_url" TEXT,
    "synced_at" TIMESTAMP(3),
    "sync_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_calendar_pkey" PRIMARY KEY ("id")
);
