-- CreateTable
CREATE TABLE "signup_verifications" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signup_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "signup_verifications_email_key" ON "signup_verifications"("email");

-- CreateIndex
CREATE UNIQUE INDEX "signup_verifications_token_hash_key" ON "signup_verifications"("token_hash");

-- CreateIndex
CREATE INDEX "signup_verifications_expires_at_idx" ON "signup_verifications"("expires_at");
