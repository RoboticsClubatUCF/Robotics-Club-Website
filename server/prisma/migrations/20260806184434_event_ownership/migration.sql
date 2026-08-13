-- AlterTable
ALTER TABLE "events" ADD COLUMN     "created_by_id" TEXT,
ADD COLUMN     "project_id" TEXT,
ADD COLUMN     "team_id" TEXT;

-- CreateIndex
CREATE INDEX "events_project_id_starts_at_idx" ON "events"("project_id", "starts_at");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
