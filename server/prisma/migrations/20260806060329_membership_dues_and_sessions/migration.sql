-- CreateEnum
CREATE TYPE "Season" AS ENUM ('SPRING', 'SUMMER', 'FALL');

-- CreateEnum
CREATE TYPE "DuesPlan" AS ENUM ('SEMESTER', 'YEAR');

-- CreateEnum
CREATE TYPE "DuesPaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'REFUNDED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "discord_id" TEXT,
ADD COLUMN     "dues_paid_through" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dues_payments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "plan" "DuesPlan" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" "DuesPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "stripe_payment_intent_id" TEXT NOT NULL,
    "term_year" INTEGER NOT NULL,
    "term_season" "Season" NOT NULL,
    "covers_through" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dues_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trial_notices" (
    "user_id" TEXT NOT NULL,
    "term_year" INTEGER NOT NULL,
    "term_season" "Season" NOT NULL,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),
    "failure" TEXT,

    CONSTRAINT "trial_notices_pkey" PRIMARY KEY ("user_id","term_year","term_season")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "dues_payments_stripe_payment_intent_id_key" ON "dues_payments"("stripe_payment_intent_id");

-- CreateIndex
CREATE INDEX "dues_payments_user_id_created_at_idx" ON "dues_payments"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "dues_payments_status_idx" ON "dues_payments"("status");

-- CreateIndex
CREATE INDEX "trial_notices_term_year_term_season_idx" ON "trial_notices"("term_year", "term_season");

-- CreateIndex
CREATE UNIQUE INDEX "users_discord_id_key" ON "users"("discord_id");

-- CreateIndex
CREATE INDEX "users_dues_paid_through_idx" ON "users"("dues_paid_through");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dues_payments" ADD CONSTRAINT "dues_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_notices" ADD CONSTRAINT "trial_notices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
