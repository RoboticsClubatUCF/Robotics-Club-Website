-- CreateEnum
CREATE TYPE "Major" AS ENUM ('AEROSPACE_ENGINEERING', 'COMPUTER_SCIENCE', 'COMPUTER_ENGINEERING', 'ELECTRICAL_ENGINEERING', 'MECHANICAL_ENGINEERING', 'UNDECIDED', 'OTHER');

-- CreateEnum
CREATE TYPE "ShirtSize" AS ENUM ('XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL');

-- CreateEnum
CREATE TYPE "Allergen" AS ENUM ('DAIRY', 'EGGS', 'FISH', 'NUTS', 'SHELLFISH', 'SESAME', 'SOY', 'OTHER');

-- CreateEnum
CREATE TYPE "DietaryRestriction" AS ENUM ('VEGETARIAN', 'VEGAN', 'HALAL', 'KOSHER', 'NO_PORK', 'GLUTEN_FREE', 'OTHER');

-- CreateEnum
CREATE TYPE "ClubSource" AS ENUM ('GOOGLE', 'SOCIAL_MEDIA', 'FRIENDS', 'IN_CLASS', 'OTHER');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "survey_completed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "member_surveys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "major" "Major" NOT NULL,
    "other_major" TEXT,
    "shirt_size" "ShirtSize" NOT NULL,
    "allergies" "Allergen"[],
    "dietary" "DietaryRestriction"[],
    "food_notes" TEXT,
    "source" "ClubSource" NOT NULL,
    "source_other" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_surveys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_surveys_user_id_key" ON "member_surveys"("user_id");

-- CreateIndex
CREATE INDEX "users_survey_completed_at_idx" ON "users"("survey_completed_at");

-- AddForeignKey
ALTER TABLE "member_surveys" ADD CONSTRAINT "member_surveys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
