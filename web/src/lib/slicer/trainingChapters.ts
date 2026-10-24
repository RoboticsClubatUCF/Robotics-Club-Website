/**
 * Which slicer training chapters everyone does, and what each of the others unlocks.
 *
 * The required chapters open the slicer, with the club's default printer, process and filament
 * and the process's settings as they are. Each optional chapter unlocks the settings it teaches.
 * `printer`, `process` and `filament` stand for choosing those profiles. Vase mode's chapter also
 * unlocks Supports, since vase mode needs them off and its task switches them off.
 *
 * A copy of `server/src/printing/trainingChapters.ts`, which refuses the same changes. Both are
 * tested against `trainingChapters.vectors.json`, and CI fails if the two vector files differ.
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

export type ProfileKey = (typeof PROFILE_KEYS)[number]

export const UNLOCKS: Readonly<Record<string, readonly string[]>> = {
  supports: ['enable_support', 'support_type', 'support_threshold_angle', 'support_on_build_plate_only', 'raft_layers'],
  adhesion: ['brim_type', 'brim_width', 'skirt_loops'],
  materials: PROFILE_KEYS,
  quality: ['layer_height', 'initial_layer_print_height', 'wall_generator', 'seam_position', 'ironing_type'],
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

/** The optional chapters' titles, as the training has them (its test checks they match). */
export const CHAPTER_TITLES: Readonly<Record<string, string>> = {
  supports: 'Supports, and needing fewer',
  adhesion: 'Sticking to the plate',
  materials: 'Printer, filament and process',
  quality: 'Quality settings',
  strength: 'Strength settings',
  others: 'Vase mode and fuzzy skin',
}

/** What each optional chapter unlocks, in a few words. */
export const CHAPTER_SUMMARIES: Readonly<Record<string, string>> = {
  supports: 'Supports, their type and angle, and rafts',
  adhesion: 'Brims and skirts, for tall, thin or small parts',
  materials: 'Other printers, filaments and processes',
  quality: 'Layer height, seams and ironing',
  strength: 'Walls, infill, tops and bottoms',
  others: 'One-wall vases and a rough, grippy finish',
}

/** Whether somebody who has finished `chapters` may change `key`. */
export const unlocked = (chapters: readonly string[], key: string) =>
  chapters.some((chapter) => UNLOCKS[chapter]?.includes(key) === true)

/** The chapter that teaches `key`: the first that unlocks it. */
export const chapterFor = (key: string) => OPTIONAL_CHAPTERS.find((id) => UNLOCKS[id]!.includes(key))

/** The training, opened on a chapter. */
export const chapterLink = (chapter: string) => `/dashboard/profile/training?chapter=${chapter}`
