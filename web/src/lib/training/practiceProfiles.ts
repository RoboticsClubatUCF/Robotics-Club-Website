import type { ApiSlicerProcess, ApiSlicerWorkspace } from '../api/api'

/**
 * The printer, processes and filaments the training's practice plate offers: the club's CC1 and
 * its presets as they were when the practice slices were made (`server/src/printing/
 * trainingSlices.ts`). They're fixed so every task and every practice slice can count on them;
 * the real slicer lists what officers offer now.
 */

const SHARED = {
  layer_height: 0.2,
  initial_layer_print_height: 0.2,
  wall_generator: 'classic',
  seam_position: 'aligned',
  ironing_type: 'no ironing',
  top_shell_layers: 5,
  top_shell_thickness: 1,
  bottom_shell_layers: 3,
  bottom_shell_thickness: 0.6,
  top_surface_pattern: 'monotonicline',
  bottom_surface_pattern: 'monotonic',
  enable_support: true,
  support_type: 'tree(auto)',
  support_threshold_angle: 30,
  support_on_build_plate_only: false,
  raft_layers: 0,
  brim_type: 'no_brim',
  brim_width: 5,
  skirt_loops: 0,
  spiral_mode: false,
  fuzzy_skin: 'disabled_fuzzy',
}

const process = (
  id: string,
  label: string,
  name: string,
  values: { wall_loops: number; sparse_infill_density: number; sparse_infill_pattern: string },
  description: string,
): ApiSlicerProcess => ({ id, label, name, description, values: { ...SHARED, ...values } })

export const PRACTICE_PRINTER = 'practice-cc1'
export const PRACTICE_STANDARD = 'practice-standard'
export const PRACTICE_PLA = 'practice-pla'
export const PRACTICE_PETG = 'practice-petg'

export const PRACTICE_WORKSPACE: ApiSlicerWorkspace = {
  profiles: {
    printers: [
      {
        id: PRACTICE_PRINTER,
        label: 'CC1',
        name: 'CC1',
        description: null,
        model: 'Elegoo Centauri Carbon',
        nozzle: 0.4,
        bedType: 'Textured PEI Plate',
        bed: { width: 256, depth: 256, height: 256, exclude: { minX: 246, minY: 0, maxX: 256, maxY: 20 } },
        layerHeight: { min: 0.08, max: 0.28 },
        processes: [
          process(
            PRACTICE_STANDARD,
            'Standard',
            '0.20mm, 0.4 nozzle, Line, T-Support',
            { wall_loops: 2, sparse_infill_density: 15, sparse_infill_pattern: 'line' },
            '2 walls, 15% line',
          ),
          process(
            'practice-q',
            'Q',
            '0.20mm, Q, 0.4 nozzle, Line, T-Support',
            { wall_loops: 3, sparse_infill_density: 10, sparse_infill_pattern: 'gyroid' },
            '3 walls, 10% gyroid',
          ),
          process(
            'practice-qs',
            'Q-S',
            '0.20mm, Q-S, 0.4 nozzle, Line, T-Support',
            { wall_loops: 6, sparse_infill_density: 6, sparse_infill_pattern: '3dhoneycomb' },
            '6 walls, 6% 3d honeycomb',
          ),
        ],
      },
    ],
    filaments: [
      {
        id: PRACTICE_PLA,
        label: 'PLA',
        name: 'Elegoo Rapid PLA',
        description: 'Stiff, easy, and fine indoors. The default for a reason.',
        type: 'PLA',
        printers: [PRACTICE_PRINTER],
      },
      {
        id: PRACTICE_PETG,
        label: 'PETG',
        name: 'Elegoo RAPID PETG Optimized',
        description: 'Tougher and takes heat better, for outdoor and under-the-hood parts.',
        type: 'PETG',
        printers: [PRACTICE_PRINTER],
      },
    ],
  },
  workerOnline: true,
  limits: { drafts: 5, models: 10, objects: 20, fileMb: 50, slicesPerHour: 60 },
}

/** What the Standard preset says for a setting, which a task compares against. */
export function standardValue(key: string): number | boolean | string {
  return PRACTICE_WORKSPACE.profiles.printers[0]!.processes[0]!.values[key]!
}
