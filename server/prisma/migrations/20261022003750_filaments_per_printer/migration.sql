-- Filaments move onto a printer each, like processes, because the same spool is tuned
-- differently on each printer. A filament goes on the first printer it fits and is copied onto
-- every other printer it fits, and drafts on those printers follow their copy. One the worker
-- hasn't read yet (no info, so no fit to go by) goes on the first printer only. One that fits no
-- printer here could never be picked, and is deleted. No column changes.

CREATE TEMP TABLE filament_fits AS
SELECT f.id AS filament_id,
       p.id AS printer_id,
       row_number() OVER (PARTITION BY f.id ORDER BY p.position, p.created_at, p.id) AS n
FROM slicer_profiles f
JOIN slicer_profiles p ON p.kind = 'PRINTER'
WHERE f.kind = 'FILAMENT'
  AND f.printer_id IS NULL
  AND (
    f.info IS NULL
    OR jsonb_array_length(COALESCE(f.info -> 'compatiblePrinters', '[]'::jsonb)) = 0
    OR f.info -> 'compatiblePrinters' ? p.name
    OR (COALESCE(p.info ->> 'stockName', '') <> ''
        AND f.info -> 'compatiblePrinters' ? (p.info ->> 'stockName'))
  );

DELETE FROM filament_fits t
USING slicer_profiles f
WHERE f.id = t.filament_id AND f.info IS NULL AND t.n > 1;

CREATE TEMP TABLE filament_copies AS
SELECT filament_id, printer_id, gen_random_uuid()::text AS copy_id
FROM filament_fits
WHERE n > 1;

-- A copy is the same flattened preset, so it stays READY, but it hasn't been test-sliced on its
-- new printer.
INSERT INTO slicer_profiles (
  id, kind, name, label, description, offered, position, printer_id, source, source_file,
  state, failure, resolved, sha256, info, orca_version, attempts, lease_token, lease_expires_at,
  requested_at, uploaded_by_id, created_at, updated_at
)
SELECT c.copy_id, f.kind, f.name, f.label, f.description, f.offered, f.position, c.printer_id,
       f.source, f.source_file, f.state, f.failure, f.resolved, f.sha256,
       f.info || '{"tested": false, "testedWith": null}'::jsonb,
       f.orca_version, f.attempts, NULL, NULL, f.requested_at, f.uploaded_by_id, f.created_at, now()
FROM filament_copies c
JOIN slicer_profiles f ON f.id = c.filament_id;

UPDATE print_requests r
SET filament_profile_id = c.copy_id
FROM filament_copies c
WHERE r.status = 'DRAFT'
  AND r.filament_profile_id = c.filament_id
  AND r.printer_profile_id = c.printer_id;

UPDATE slicer_profiles f
SET printer_id = t.printer_id, updated_at = now()
FROM filament_fits t
WHERE t.filament_id = f.id AND t.n = 1;

DELETE FROM slicer_profiles WHERE kind = 'FILAMENT' AND printer_id IS NULL;

DROP TABLE filament_copies;
DROP TABLE filament_fits;
