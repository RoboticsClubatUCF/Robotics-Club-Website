BEGIN;

CREATE TABLE "officer_seats" (
    "position" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 8,
    CONSTRAINT "officer_seats_pkey" PRIMARY KEY ("position")
);

CREATE UNIQUE INDEX "officer_seats_name_key_key" ON "officer_seats"("name_key");

INSERT INTO "officer_seats" ("position", "name_key", "display_order") VALUES
    ('PRESIDENT', 'president', 0),
    ('VICE_PRESIDENT', 'vice president', 1),
    ('TREASURER', 'treasurer', 2),
    ('SECRETARY', 'secretary', 3),
    ('MARKETING', 'marketing', 4),
    ('OUTREACH', 'outreach', 5),
    ('LAB_MANAGER', 'lab manager', 6),
    ('FACULTY_ADVISOR', 'faculty advisor', 7);

ALTER TABLE "officer_terms" ALTER COLUMN "position" TYPE TEXT USING "position"::TEXT;
DROP TYPE "OfficerPosition";

UPDATE "officer_terms"
SET "ended_at" = GREATEST(CURRENT_TIMESTAMP, "started_at" + INTERVAL '1 millisecond'),
    "ended_reason" = 'Board seat required',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "ended_at" IS NULL AND "position" IS NULL;

-- The normal dues checks still apply to everyone who has a membership date.
UPDATE "users" AS u
SET "role" = CASE WHEN u."dues_paid_through" IS NULL THEN 'GUEST'::"UserRole"
                  ELSE 'MEMBER'::"UserRole" END,
    "updated_at" = CURRENT_TIMESTAMP
WHERE u."role" = 'OFFICER'
  AND NOT EXISTS (
      SELECT 1 FROM "officer_terms" t
      WHERE t."user_id" = u."id" AND t."ended_at" IS NULL
        AND t."position" <> 'FACULTY_ADVISOR'
  );

ALTER TABLE "officer_terms" ADD CONSTRAINT "officer_terms_open_seat_check"
    CHECK ("ended_at" IS NOT NULL OR "position" IS NOT NULL);

ALTER TABLE "officer_terms" ADD CONSTRAINT "officer_terms_position_fkey"
    FOREIGN KEY ("position") REFERENCES "officer_seats"("position") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
