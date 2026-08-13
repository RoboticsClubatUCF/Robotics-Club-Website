-- CreateEnum
CREATE TYPE "PrintProcess" AS ENUM ('FDM', 'SLA');

-- CreateEnum
CREATE TYPE "PrintMaterial" AS ENUM ('PLA', 'PETG', 'ABS_LIKE_RESIN');

-- CreateEnum
CREATE TYPE "InfillPattern" AS ENUM ('GRID', 'GYROID', 'LINES', 'TRIANGLES', 'CUBIC', 'HONEYCOMB', 'CONCENTRIC');

-- AlterTable
ALTER TABLE "print_requests" ADD COLUMN     "grams_used" INTEGER,
ADD COLUMN     "infill_density" INTEGER,
ADD COLUMN     "infill_pattern" "InfillPattern",
ADD COLUMN     "material" "PrintMaterial" NOT NULL DEFAULT 'PLA',
ADD COLUMN     "printed_infill_density" INTEGER,
ADD COLUMN     "printed_infill_pattern" "InfillPattern",
ADD COLUMN     "printed_material" "PrintMaterial",
ADD COLUMN     "printed_process" "PrintProcess",
ADD COLUMN     "process" "PrintProcess" NOT NULL DEFAULT 'FDM',
ADD COLUMN     "project_id" TEXT,
ADD COLUMN     "term_season" "Season" NOT NULL,
ADD COLUMN     "term_year" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "print_requests_user_id_term_year_term_season_idx" ON "print_requests"("user_id", "term_year", "term_season");

-- CreateIndex
CREATE INDEX "print_requests_project_id_idx" ON "print_requests"("project_id");

-- AddForeignKey
ALTER TABLE "print_requests" ADD CONSTRAINT "print_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
