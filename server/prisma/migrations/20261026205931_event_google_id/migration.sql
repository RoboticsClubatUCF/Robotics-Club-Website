-- AlterTable
ALTER TABLE "events" ADD COLUMN     "google_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "events_google_id_key" ON "events"("google_id");
