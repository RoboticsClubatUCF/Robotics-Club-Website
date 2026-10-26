-- AlterTable
ALTER TABLE "google_calendars" ADD COLUMN     "project_id" TEXT,
ADD COLUMN     "published" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "google_calendars_project_id_idx" ON "google_calendars"("project_id");

-- AddForeignKey
ALTER TABLE "google_calendars" ADD CONSTRAINT "google_calendars_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
