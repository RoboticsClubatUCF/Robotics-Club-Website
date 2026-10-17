BEGIN;

CREATE TABLE "project_document_authors" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "project_document_authors_pkey" PRIMARY KEY ("id")
);

-- Each old document has exactly one credit. Reusing its UUID for that credit
-- preserves every name and account link without requiring a database UUID extension.
INSERT INTO "project_document_authors" ("id", "document_id", "user_id", "name", "position")
SELECT "id", "id", "author_id", "author_name", 0 FROM "project_documents";

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM "project_documents" d
        LEFT JOIN "project_document_authors" a ON a."document_id" = d."id"
        WHERE a."id" IS NULL OR a."name" IS DISTINCT FROM d."author_name"
           OR a."user_id" IS DISTINCT FROM d."author_id"
    ) THEN
        RAISE EXCEPTION 'A document credit was not preserved';
    END IF;
END $$;

CREATE INDEX "project_document_authors_document_id_position_idx" ON "project_document_authors"("document_id", "position");
CREATE INDEX "project_document_authors_user_id_idx" ON "project_document_authors"("user_id");
ALTER TABLE "project_document_authors" ADD CONSTRAINT "project_document_authors_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "project_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_document_authors" ADD CONSTRAINT "project_document_authors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "project_documents" DROP COLUMN "author_id", DROP COLUMN "author_name";

COMMIT;
