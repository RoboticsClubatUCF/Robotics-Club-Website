-- AlterTable
ALTER TABLE "print_requests" ADD COLUMN     "settled_at" TIMESTAMP(3),
ALTER COLUMN "grams_used" SET DATA TYPE DECIMAL(8,2);

-- A settled request is never written again, so its last update is when it was settled.
UPDATE "print_requests" SET "settled_at" = "updated_at" WHERE "status" IN ('DONE', 'REJECTED');

-- CreateIndex
CREATE INDEX "print_requests_status_settled_at_idx" ON "print_requests"("status", "settled_at");
