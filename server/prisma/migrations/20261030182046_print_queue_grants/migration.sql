-- AlterTable
ALTER TABLE "users" ADD COLUMN     "print_queue_granted_at" TIMESTAMP(3),
ADD COLUMN     "print_queue_granted_by_id" TEXT;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_print_queue_granted_by_id_fkey" FOREIGN KEY ("print_queue_granted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
