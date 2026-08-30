-- The member survey stops being five columns and becomes rows an officer can
-- edit. Written by hand, because it has to carry every answer already given
-- across into the new shape before the columns holding them are dropped --
-- `migrate diff` emits the drops first and would destroy the lot.
--
-- The order below is the whole of it: create, seed the six questions the club
-- was already asking, move the answers onto them, and only then drop.

-- CreateEnum
CREATE TYPE "SurveyQuestionKind" AS ENUM ('SHORT_TEXT', 'LONG_TEXT', 'SINGLE_CHOICE', 'MULTI_CHOICE');

-- CreateTable
CREATE TABLE "survey_questions" (
    "id" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "help" TEXT,
    "kind" "SurveyQuestionKind" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "allow_none" BOOLEAN NOT NULL DEFAULT false,
    "max_length" INTEGER,
    "position" INTEGER NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "survey_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_options" (
    "id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "wants_text" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "survey_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_answers" (
    "id" TEXT NOT NULL,
    "survey_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "text" TEXT,

    CONSTRAINT "survey_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_answer_options" (
    "answer_id" TEXT NOT NULL,
    "option_id" TEXT NOT NULL,

    CONSTRAINT "survey_answer_options_pkey" PRIMARY KEY ("answer_id","option_id")
);

-- CreateIndex
CREATE INDEX "survey_questions_archived_at_position_idx" ON "survey_questions"("archived_at", "position");

-- CreateIndex
CREATE INDEX "survey_options_question_id_position_idx" ON "survey_options"("question_id", "position");

-- CreateIndex
CREATE INDEX "survey_answers_question_id_idx" ON "survey_answers"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "survey_answers_survey_id_question_id_key" ON "survey_answers"("survey_id", "question_id");

-- CreateIndex
CREATE INDEX "survey_answer_options_option_id_idx" ON "survey_answer_options"("option_id");

-- AddForeignKey
ALTER TABLE "survey_options" ADD CONSTRAINT "survey_options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "survey_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_answers" ADD CONSTRAINT "survey_answers_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "member_surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_answers" ADD CONSTRAINT "survey_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "survey_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_answer_options" ADD CONSTRAINT "survey_answer_options_answer_id_fkey" FOREIGN KEY ("answer_id") REFERENCES "survey_answers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_answer_options" ADD CONSTRAINT "survey_answer_options_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "survey_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The bridge between the enum values being retired and the option rows
-- replacing them. It exists only for the length of this file: every backfill
-- below joins on it, and the last thing that happens before the drops is that
-- it goes away, because nothing after today has an enum value to match against.
ALTER TABLE "survey_options" ADD COLUMN "legacy_value" TEXT;

-- The six questions the club was already asking, in the order the form already
-- drew them. Seeded here rather than in `prisma/seed.ts` because a fresh
-- database runs this migration too, and a survey with no questions on it is a
-- gate nobody can get through.
INSERT INTO "survey_questions"
    ("id", "prompt", "help", "kind", "required", "allow_none", "max_length", "position", "created_at", "updated_at")
VALUES
    (gen_random_uuid(), 'Major', NULL, 'SINGLE_CHOICE', true, false, 100, 0, NOW(), NOW()),
    (gen_random_uuid(), 'Shirt size', 'Unisex sizing, so it runs a little large.', 'SINGLE_CHOICE', true, false, NULL, 1, NOW(), NOW()),
    (gen_random_uuid(), 'Allergies', 'We ask because the club buys food. Tick everything that applies, or tick None.', 'MULTI_CHOICE', true, true, NULL, 2, NOW(), NOW()),
    (gen_random_uuid(), 'Dietary restrictions', 'Separate from allergies: what you would rather not eat, as opposed to what would hurt you.', 'MULTI_CHOICE', true, true, NULL, 3, NOW(), NOW()),
    (gen_random_uuid(), 'Anything else about food', 'How severe an allergy is, or anything the tick boxes above do not cover. This is the box whoever orders the food actually reads.', 'LONG_TEXT', false, false, 1000, 4, NOW(), NOW()),
    (gen_random_uuid(), 'How did you find out about the club', NULL, 'SINGLE_CHOICE', true, false, 200, 5, NOW(), NOW());

-- Their options, labelled the way the form already labelled them and ordered
-- the way Postgres already sorted the enums.
--
-- `wants_text` is on exactly two of them, and that is not an oversight: MAJOR
-- and the source question each had their own free-text column, while the two
-- food questions shared one box and go on sharing it as the ANYTHING ELSE
-- ABOUT FOOD question. Turning it on for an allergy's OTHER would leave every
-- row already in this table holding a pick that owes a sentence nobody was
-- asked for.
INSERT INTO "survey_options" ("id", "question_id", "label", "wants_text", "position", "legacy_value")
SELECT gen_random_uuid(), q."id", v."label", v."wants_text", v."position", v."legacy_value"
FROM "survey_questions" q
JOIN (VALUES
    ('Major'::text, 'Aerospace Engineering'::text, false, 0, 'AEROSPACE_ENGINEERING'::text),
    ('Major', 'Computer Science', false, 1, 'COMPUTER_SCIENCE'),
    ('Major', 'Computer Engineering', false, 2, 'COMPUTER_ENGINEERING'),
    ('Major', 'Electrical Engineering', false, 3, 'ELECTRICAL_ENGINEERING'),
    ('Major', 'Mechanical Engineering', false, 4, 'MECHANICAL_ENGINEERING'),
    ('Major', 'Undecided', false, 5, 'UNDECIDED'),
    ('Major', 'Other', true, 6, 'OTHER'),

    ('Shirt size', 'XS', false, 0, 'XS'),
    ('Shirt size', 'S', false, 1, 'S'),
    ('Shirt size', 'M', false, 2, 'M'),
    ('Shirt size', 'L', false, 3, 'L'),
    ('Shirt size', 'XL', false, 4, 'XL'),
    ('Shirt size', '2XL', false, 5, 'XXL'),
    ('Shirt size', '3XL', false, 6, 'XXXL'),

    ('Allergies', 'Dairy', false, 0, 'DAIRY'),
    ('Allergies', 'Eggs', false, 1, 'EGGS'),
    ('Allergies', 'Fish', false, 2, 'FISH'),
    ('Allergies', 'Nuts', false, 3, 'NUTS'),
    ('Allergies', 'Shellfish', false, 4, 'SHELLFISH'),
    ('Allergies', 'Sesame', false, 5, 'SESAME'),
    ('Allergies', 'Soy', false, 6, 'SOY'),
    ('Allergies', 'Other', false, 7, 'OTHER'),

    ('Dietary restrictions', 'Vegetarian', false, 0, 'VEGETARIAN'),
    ('Dietary restrictions', 'Vegan', false, 1, 'VEGAN'),
    ('Dietary restrictions', 'Halal', false, 2, 'HALAL'),
    ('Dietary restrictions', 'Kosher', false, 3, 'KOSHER'),
    ('Dietary restrictions', 'No pork', false, 4, 'NO_PORK'),
    ('Dietary restrictions', 'Gluten free', false, 5, 'GLUTEN_FREE'),
    ('Dietary restrictions', 'Other', false, 6, 'OTHER'),

    ('How did you find out about the club', 'Google', false, 0, 'GOOGLE'),
    ('How did you find out about the club', 'Social media', false, 1, 'SOCIAL_MEDIA'),
    ('How did you find out about the club', 'Friends', false, 2, 'FRIENDS'),
    ('How did you find out about the club', 'In class', false, 3, 'IN_CLASS'),
    ('How did you find out about the club', 'Other', true, 4, 'OTHER')
) AS v("prompt", "label", "wants_text", "position", "legacy_value")
  ON v."prompt" = q."prompt";

-- One answer row per member per question. The four questions everybody had to
-- answer get a row unconditionally -- an empty set of ticks is a real answer to
-- the food questions and always was -- while the notes box only gets one where
-- somebody actually wrote in it, because it is the one optional question and an
-- empty row there would read as an answer.
INSERT INTO "survey_answers" ("id", "survey_id", "question_id", "text")
SELECT gen_random_uuid(), s."id", q."id", s."other_major"
FROM "member_surveys" s
CROSS JOIN "survey_questions" q
WHERE q."prompt" = 'Major';

INSERT INTO "survey_answers" ("id", "survey_id", "question_id", "text")
SELECT gen_random_uuid(), s."id", q."id", NULL
FROM "member_surveys" s
CROSS JOIN "survey_questions" q
WHERE q."prompt" IN ('Shirt size', 'Allergies', 'Dietary restrictions');

INSERT INTO "survey_answers" ("id", "survey_id", "question_id", "text")
SELECT gen_random_uuid(), s."id", q."id", s."food_notes"
FROM "member_surveys" s
CROSS JOIN "survey_questions" q
WHERE q."prompt" = 'Anything else about food'
  AND s."food_notes" IS NOT NULL;

INSERT INTO "survey_answers" ("id", "survey_id", "question_id", "text")
SELECT gen_random_uuid(), s."id", q."id", s."source_other"
FROM "member_surveys" s
CROSS JOIN "survey_questions" q
WHERE q."prompt" = 'How did you find out about the club';

-- The ticks themselves: one row per single-choice answer, and one per element
-- of the two arrays.
INSERT INTO "survey_answer_options" ("answer_id", "option_id")
SELECT a."id", o."id"
FROM "survey_answers" a
JOIN "survey_questions" q ON q."id" = a."question_id" AND q."prompt" = 'Major'
JOIN "member_surveys" s ON s."id" = a."survey_id"
JOIN "survey_options" o ON o."question_id" = q."id" AND o."legacy_value" = s."major"::text;

INSERT INTO "survey_answer_options" ("answer_id", "option_id")
SELECT a."id", o."id"
FROM "survey_answers" a
JOIN "survey_questions" q ON q."id" = a."question_id" AND q."prompt" = 'Shirt size'
JOIN "member_surveys" s ON s."id" = a."survey_id"
JOIN "survey_options" o ON o."question_id" = q."id" AND o."legacy_value" = s."shirt_size"::text;

INSERT INTO "survey_answer_options" ("answer_id", "option_id")
SELECT a."id", o."id"
FROM "survey_answers" a
JOIN "survey_questions" q ON q."id" = a."question_id" AND q."prompt" = 'How did you find out about the club'
JOIN "member_surveys" s ON s."id" = a."survey_id"
JOIN "survey_options" o ON o."question_id" = q."id" AND o."legacy_value" = s."source"::text;

INSERT INTO "survey_answer_options" ("answer_id", "option_id")
SELECT a."id", o."id"
FROM "survey_answers" a
JOIN "survey_questions" q ON q."id" = a."question_id" AND q."prompt" = 'Allergies'
JOIN "member_surveys" s ON s."id" = a."survey_id"
CROSS JOIN LATERAL unnest(s."allergies") AS picked
JOIN "survey_options" o ON o."question_id" = q."id" AND o."legacy_value" = picked::text;

INSERT INTO "survey_answer_options" ("answer_id", "option_id")
SELECT a."id", o."id"
FROM "survey_answers" a
JOIN "survey_questions" q ON q."id" = a."question_id" AND q."prompt" = 'Dietary restrictions'
JOIN "member_surveys" s ON s."id" = a."survey_id"
CROSS JOIN LATERAL unnest(s."dietary") AS picked
JOIN "survey_options" o ON o."question_id" = q."id" AND o."legacy_value" = picked::text;

-- Everything above has read the old columns. From here they are gone.
ALTER TABLE "survey_options" DROP COLUMN "legacy_value";

-- DropColumn
ALTER TABLE "member_surveys"
    DROP COLUMN "major",
    DROP COLUMN "other_major",
    DROP COLUMN "shirt_size",
    DROP COLUMN "allergies",
    DROP COLUMN "dietary",
    DROP COLUMN "food_notes",
    DROP COLUMN "source",
    DROP COLUMN "source_other";

-- DropEnum
DROP TYPE "Major";

-- DropEnum
DROP TYPE "ShirtSize";

-- DropEnum
DROP TYPE "Allergen";

-- DropEnum
DROP TYPE "DietaryRestriction";

-- DropEnum
DROP TYPE "ClubSource";
