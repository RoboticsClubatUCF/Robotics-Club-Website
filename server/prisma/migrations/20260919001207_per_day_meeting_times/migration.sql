-- CreateTable
CREATE TABLE "project_meeting_times" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,

    CONSTRAINT "project_meeting_times_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_meeting_times_project_id_day_key" ON "project_meeting_times"("project_id", "day");

-- AddForeignKey
ALTER TABLE "project_meeting_times" ADD CONSTRAINT "project_meeting_times_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
