# Third-party software in the slicer image

The slicer worker image (`orca/Dockerfile`) bundles software under its own licences:

- **OrcaSlicer 2.4.2**, AGPL-3.0, <https://github.com/OrcaSlicer/OrcaSlicer>. Run unmodified as a
  separate program; the worker only invokes its command line.
- **OrcaSlicer's Elegoo vendor profiles**, flattened into `orca/profiles/` by
  `orca/resolve-profiles.ts`, under the same licence as OrcaSlicer.
- **occt-import-js 0.0.23**, LGPL-2.1, <https://github.com/kovacsv/occt-import-js>, built on
  Open CASCADE Technology (LGPL-2.1 with an exception). Used unmodified to mesh STEP uploads.

The club's own presets in `orca/source/` were exported from desktop OrcaSlicer.
