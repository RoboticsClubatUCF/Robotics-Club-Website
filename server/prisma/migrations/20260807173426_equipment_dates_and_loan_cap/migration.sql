-- AlterTable
ALTER TABLE "equipment" ADD COLUMN     "max_loan_days" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "equipment_loans" ADD COLUMN     "reminded_for" TIMESTAMP(3),
ADD COLUMN     "requested_due_at" TIMESTAMP(3),
ADD COLUMN     "start_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "equipment_loans_status_due_at_idx" ON "equipment_loans"("status", "due_at");
