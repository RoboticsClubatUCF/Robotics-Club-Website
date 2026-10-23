-- Printers resolved before the worker stopped slicing on "Default Plate" still carry it, and Orca
-- crashes on it. Queue them and their processes (which take the plate from the printer) again.
UPDATE "slicer_profiles"
SET "state" = 'QUEUED',
    "attempts" = 0,
    "requested_at" = now(),
    "lease_token" = NULL,
    "lease_expires_at" = NULL
WHERE "id" IN (
    SELECT "id" FROM "slicer_profiles"
    WHERE "kind" = 'PRINTER' AND "info"->>'bedType' = 'Default Plate'
  )
  OR ("kind" = 'PROCESS' AND "printer_id" IN (
    SELECT "id" FROM "slicer_profiles"
    WHERE "kind" = 'PRINTER' AND "info"->>'bedType' = 'Default Plate'
  ));
