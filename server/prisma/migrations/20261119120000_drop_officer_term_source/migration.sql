-- The Discord officer sync was the only reader: it closed only the terms it had opened.
-- The board is kept by hand now, so every term is closed by a person.
ALTER TABLE "officer_terms" DROP COLUMN "source";

DROP TYPE "OfficerTermSource";
