-- CreateEnum
CREATE TYPE "PrintPreset" AS ENUM ('STANDARD', 'Q', 'QS');

-- CreateEnum
CREATE TYPE "SlicerJobState" AS ENUM ('QUEUED', 'RUNNING', 'READY', 'FAILED');

-- AlterEnum
ALTER TYPE "FileKind" ADD VALUE 'PRINT_SLICE';
ALTER TYPE "FileKind" ADD VALUE 'PRINT_PREVIEW';

-- AlterEnum
-- Before PENDING, so the enum still reads in lifecycle order.
ALTER TYPE "PrintRequestStatus" ADD VALUE 'DRAFT' BEFORE 'PENDING';

-- AlterTable
ALTER TABLE "print_requests" ADD COLUMN     "draft_active_at" TIMESTAMP(3),
ADD COLUMN     "estimated_grams" DOUBLE PRECISION,
ADD COLUMN     "estimated_seconds" INTEGER,
ADD COLUMN     "overrides" JSONB,
ADD COLUMN     "preset" "PrintPreset",
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "submitted_at" TIMESTAMP(3);

-- Every request so far joined the queue the moment it was made.
UPDATE "print_requests" SET "submitted_at" = "created_at";

-- CreateTable
CREATE TABLE "print_models" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "file_id" TEXT,
    "mesh_file_id" TEXT,
    "file_name" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "mesh_state" "SlicerJobState" NOT NULL DEFAULT 'READY',
    "mesh_failure" TEXT,
    "triangles" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_token" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "print_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_objects" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "qx" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qz" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qw" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "sx" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "sy" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "sz" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "print_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_slices" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "state" "SlicerJobState" NOT NULL DEFAULT 'QUEUED',
    "revision" INTEGER NOT NULL,
    "spec" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "profile_set_hash" TEXT NOT NULL,
    "orca_version" TEXT,
    "output_file_id" TEXT,
    "preview_file_id" TEXT,
    "preview_failure" TEXT,
    "layer_count" INTEGER,
    "estimated_grams" DOUBLE PRECISION,
    "estimated_seconds" INTEGER,
    "filament_meters" DOUBLE PRECISION,
    "failure" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_token" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "print_slices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slicer_workers" (
    "id" TEXT NOT NULL,
    "orca_version" TEXT NOT NULL,
    "profile_set_hash" TEXT NOT NULL,
    "seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slicer_workers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "print_models_file_id_key" ON "print_models"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "print_models_mesh_file_id_key" ON "print_models"("mesh_file_id");

-- CreateIndex
CREATE INDEX "print_models_request_id_position_idx" ON "print_models"("request_id", "position");

-- CreateIndex
CREATE INDEX "print_models_mesh_state_requested_at_idx" ON "print_models"("mesh_state", "requested_at");

-- CreateIndex
CREATE INDEX "print_objects_request_id_position_idx" ON "print_objects"("request_id", "position");

-- CreateIndex
CREATE INDEX "print_objects_model_id_idx" ON "print_objects"("model_id");

-- CreateIndex
CREATE UNIQUE INDEX "print_slices_request_id_key" ON "print_slices"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "print_slices_output_file_id_key" ON "print_slices"("output_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "print_slices_preview_file_id_key" ON "print_slices"("preview_file_id");

-- CreateIndex
CREATE INDEX "print_slices_state_requested_at_idx" ON "print_slices"("state", "requested_at");

-- CreateIndex
CREATE INDEX "print_requests_status_submitted_at_idx" ON "print_requests"("status", "submitted_at");

-- AddForeignKey
ALTER TABLE "print_models" ADD CONSTRAINT "print_models_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "print_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_models" ADD CONSTRAINT "print_models_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_models" ADD CONSTRAINT "print_models_mesh_file_id_fkey" FOREIGN KEY ("mesh_file_id") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_objects" ADD CONSTRAINT "print_objects_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "print_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_objects" ADD CONSTRAINT "print_objects_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "print_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_slices" ADD CONSTRAINT "print_slices_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "print_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_slices" ADD CONSTRAINT "print_slices_output_file_id_fkey" FOREIGN KEY ("output_file_id") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_slices" ADD CONSTRAINT "print_slices_preview_file_id_fkey" FOREIGN KEY ("preview_file_id") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

