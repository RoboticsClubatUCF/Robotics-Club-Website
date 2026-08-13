-- CreateTable
CREATE TABLE "membership_activations" (
    "user_id" TEXT NOT NULL,
    "term_year" INTEGER NOT NULL,
    "term_season" "Season" NOT NULL,
    "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_activations_pkey" PRIMARY KEY ("user_id","term_year","term_season")
);

-- AddForeignKey
ALTER TABLE "membership_activations" ADD CONSTRAINT "membership_activations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
