/**
 * Which slicer training chapters everyone does, and what each of the others unlocks.
 *
 * The required chapters are the basics: finishing them (`POST /api/print/training`) opens the
 * slicer with the club's default printer, process and filament and the process's settings as
 * they are. Each optional chapter unlocks the settings it teaches, so a member who wants a brim
 * takes the brim chapter. `printer`, `process` and `filament` stand for choosing those profiles.
 * A setting can sit under two chapters when both teach it: vase mode needs Supports off, and its
 * chapter has the member switch them off.
 *
 * A copy of `web/src/lib/slicer/trainingChapters.ts`. Both are tested against
 * `trainingChapters.vectors.json`, and CI fails if the two vector files differ.
 */

export const REQUIRED_CHAPTERS = [
  'basics',
  'screen',
  'camera',
  'placing',
  'turning',
  'copies',
  'fitting',
  'orientation',
  'slicing',
  'sending',
] as const

export const PROFILE_KEYS = ['printer', 'process', 'filament'] as const

export const UNLOCKS: Readonly<Record<string, readonly string[]>> = {
  supports: [
    'enable_support',
    'support_type',
    'support_threshold_angle',
    'support_on_build_plate_only',
    'raft_layers',
  ],
  adhesion: ['brim_type', 'brim_width', 'skirt_loops'],
  materials: PROFILE_KEYS,
  quality: [
    'layer_height',
    'initial_layer_print_height',
    'wall_generator',
    'seam_position',
    'ironing_type',
  ],
  strength: [
    'wall_loops',
    'top_shell_layers',
    'top_shell_thickness',
    'bottom_shell_layers',
    'bottom_shell_thickness',
    'sparse_infill_density',
    'sparse_infill_pattern',
    'top_surface_pattern',
    'bottom_surface_pattern',
  ],
  others: ['spiral_mode', 'fuzzy_skin', 'enable_support'],
}

export const OPTIONAL_CHAPTERS = Object.keys(UNLOCKS)

const KNOWN = new Set<string>([...REQUIRED_CHAPTERS, ...OPTIONAL_CHAPTERS])

export const isChapter = (id: string) => KNOWN.has(id)

/** Whether a member who has finished `chapters` may change `key`. */
export const unlocked = (chapters: readonly string[], key: string) =>
  chapters.some((chapter) => UNLOCKS[chapter]?.includes(key) === true)

/**
 * The first setting `after` sets differently from `before` that's still locked, or null. Taking a
 * change back is never refused: it only returns to the process's value.
 */
export function lockedChange(
  chapters: readonly string[],
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): string | null {
  for (const [key, value] of Object.entries(after)) {
    if (value !== undefined && value !== before[key] && !unlocked(chapters, key)) return key
  }
  return null
}
