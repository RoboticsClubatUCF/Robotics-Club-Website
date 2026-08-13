-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('IMAGE', 'PRINT_MODEL');

-- CreateEnum
CREATE TYPE "PrintRequestStatus" AS ENUM ('PENDING', 'PRINTING', 'DONE', 'REJECTED');

-- CreateTable
CREATE TABLE "stored_files" (
    "id" TEXT NOT NULL,
    "kind" "FileKind" NOT NULL,
    "mime_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "original_name" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "file_id" TEXT,
    "file_name" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "notes" TEXT,
    "status" "PrintRequestStatus" NOT NULL DEFAULT 'PENDING',
    "officer_note" TEXT,
    "decided_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "print_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "print_requests_file_id_key" ON "print_requests"("file_id");

-- CreateIndex
CREATE INDEX "print_requests_status_created_at_idx" ON "print_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "print_requests_user_id_created_at_idx" ON "print_requests"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_requests" ADD CONSTRAINT "print_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_requests" ADD CONSTRAINT "print_requests_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_requests" ADD CONSTRAINT "print_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
