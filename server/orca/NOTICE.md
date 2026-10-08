# Third-party software in the slicer image

The slicer worker image (`orca/Dockerfile`) bundles software under its own licences:

- **OrcaSlicer 2.4.2**, AGPL-3.0, <https://github.com/OrcaSlicer/OrcaSlicer>. Run unmodified as a
  separate program; the worker only invokes its command line.
- **OrcaSlicer's stock profiles**, which officers' uploads are flattened against
  (`src/printing/profileResolve.ts`), under the same licence as OrcaSlicer.
- **occt-import-js 0.0.23**, LGPL-2.1, <https://github.com/kovacsv/occt-import-js>, built on
  Open CASCADE Technology (LGPL-2.1 with an exception). Used unmodified to mesh STEP uploads.

The club's own presets in `orca/source/` were exported from desktop OrcaSlicer. They seed the
profiles table and the smoke test; officers upload anything newer on the profiles desk.
