-- CreateTable
CREATE TABLE "officer_terms" (
    "id" TEXT NOT NULL,
    "position" "OfficerPosition" NOT NULL,
    "start_year" INTEGER NOT NULL,
    "end_year" INTEGER NOT NULL,
    "full_name" TEXT NOT NULL,
    "photo_url" TEXT,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "officer_terms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "officer_terms_user_id_idx" ON "officer_terms"("user_id");

-- CreateIndex
CREATE INDEX "officer_terms_start_year_position_idx" ON "officer_terms"("start_year", "position");

-- AddForeignKey
ALTER TABLE "officer_terms" ADD CONSTRAINT "officer_terms_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
