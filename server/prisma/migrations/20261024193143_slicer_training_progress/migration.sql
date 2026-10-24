-- CreateTable
CREATE TABLE "slicer_training" (
    "user_id" TEXT NOT NULL,
    "steps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "at" TEXT,
    "restarted" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "chapters" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slicer_training_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "slicer_training" ADD CONSTRAINT "slicer_training_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Everyone trained so far did every chapter, when they were all required, so they keep every
-- setting. Their steps were kept in their browser; the training page uploads them on next visit.
INSERT INTO "slicer_training" ("user_id", "chapters", "updated_at")
SELECT "id",
       ARRAY['basics', 'screen', 'camera', 'placing', 'turning', 'copies', 'fitting', 'orientation',
             'slicing', 'sending', 'supports', 'adhesion', 'materials', 'quality', 'strength', 'others'],
       CURRENT_TIMESTAMP
FROM "users"
WHERE "slicer_trained_at" IS NOT NULL
ON CONFLICT ("user_id") DO NOTHING;
