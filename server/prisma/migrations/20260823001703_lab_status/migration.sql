-- CreateTable
CREATE TABLE "lab_status" (
    "id" TEXT NOT NULL DEFAULT 'current',
    "open" BOOLEAN NOT NULL DEFAULT false,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by_id" TEXT,
    "discord_channel_id" TEXT,
    "discord_message_id" TEXT,
    "discord_synced" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lab_status_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "lab_status" ADD CONSTRAINT "lab_status_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
