import type {
  ApiPrintRequest,
  InfillPattern,
  PrintMaterial,
  PrintProcess,
  PrintRequestStatus,
} from './api'

/**
 * What the printers will do, in the words the club uses for it.
 *
 * Two pages read this — the member choosing settings and the officer
 * correcting them to what actually came off the machine — and they have to
 * offer the same choices. Written twice they would agree until one was edited.
 *
 * The rule that shapes all of it: **a process decides its materials, and only
 * FDM has infill.** A resin print is a solid or a hollowed shell; "20% gyroid"
 * is not something that can be done to one. The server enforces the same
 * pairing in `server/src/printSettings.ts` — this is the readable half, not a
 * second rule that could drift.
 */

export const PROCESSES: {
  value: PrintProcess
  label: string
  blurb: string
}[] = [
  {
    value: 'FDM',
    label: 'FDM — FILAMENT',
    blurb: 'The everyday printers. Tough parts, brackets, jigs, most things.',
  },
  {
    value: 'SLA',
    label: 'SLA — RESIN',
    blurb: 'Fine detail and smooth faces. Slower, messier, and worth it for small parts.',
  },
]

export const MATERIAL_LABEL: Record<PrintMaterial, string> = {
  PLA: 'PLA',
  PETG: 'PETG',
  ABS_LIKE_RESIN: 'ABS-like resin',
}

const MATERIAL_BLURB: Record<PrintMaterial, string> = {
  PLA: 'Stiff, easy, and fine indoors. The default for a reason.',
  PETG: 'Tougher and takes heat better — outdoor and under-the-hood parts.',
  ABS_LIKE_RESIN: 'The one resin the club stocks.',
}

/** What a process can be printed in. The order is the order on the page. */
const MATERIALS: Record<PrintProcess, PrintMaterial[]> = {
  FDM: ['PLA', 'PETG'],
  SLA: ['ABS_LIKE_RESIN'],
}

export const materialsFor = (
  process: PrintProcess,
): { value: PrintMaterial; label: string; blurb: string }[] =>
  MATERIALS[process].map((value) => ({
    value,
    label: MATERIAL_LABEL[value],
    blurb: MATERIAL_BLURB[value],
  }))

/** Whether this process has infill at all. The only caller of `MATERIALS`'
    sibling rule, and the reason the infill controls are absent rather than
    disabled on resin — a greyed-out box invites somebody to wonder why. */
export const hasInfill = (process: PrintProcess): boolean => process === 'FDM'

export const INFILL_PATTERNS: { value: InfillPattern; label: string }[] = [
  { value: 'GRID', label: 'Grid' },
  { value: 'GYROID', label: 'Gyroid' },
  { value: 'LINES', label: 'Lines' },
  { value: 'TRIANGLES', label: 'Triangles' },
  { value: 'CUBIC', label: 'Cubic' },
  { value: 'HONEYCOMB', label: 'Honeycomb' },
  { value: 'CONCENTRIC', label: 'Concentric' },
]

/**
 * The densities worth offering, rather than a 0–100 box.
 *
 * Nobody wants 37%. These are the figures that come up — hollow, light, the
 * common default, strong, solid — and a short list is faster to pick from than
 * a number to type. The server still takes any integer 0–100, so this is a
 * convenience and not a constraint.
 */
export const INFILL_DENSITIES = [0, 10, 15, 20, 25, 40, 60, 80, 100]

/**
 * The defaults a fresh form starts on: the common everyday print.
 *
 * 15% is the club's figure, and it is the one number here that is a decision
 * rather than a convention — it is enough for almost anything that is not
 * load-bearing, and every request that leaves it alone is filament the club
 * did not spend. The officer's correction defaults to the same, so a job with
 * nothing typed reads consistently at both ends.
 */
export const DEFAULT_INFILL_DENSITY = 15

export const DEFAULT_SETTINGS = {
  process: 'FDM' as PrintProcess,
  material: 'PLA' as PrintMaterial,
  infillPattern: 'GRID' as InfillPattern,
  infillDensity: DEFAULT_INFILL_DENSITY,
}

export const patternLabel = (pattern: InfillPattern): string =>
  INFILL_PATTERNS.find((option) => option.value === pattern)?.label ?? pattern

/**
 * What a request was printed as, falling back to what was asked for.
 *
 * The `printed*` columns are null until an officer corrects something, and null
 * means "as asked" — so every reader of these fields is this `??` and it is
 * worth having in one place. `changed` is what lets a page say "asked PLA,
 * printed PETG" instead of quietly showing the second one.
 */
export function actualSettings(request: ApiPrintRequest) {
  const process = request.printedProcess ?? request.process
  const material = request.printedMaterial ?? request.material

  return {
    process,
    material,
    infillPattern: request.printedInfillPattern ?? request.infillPattern,
    infillDensity: request.printedInfillDensity ?? request.infillDensity,
    changed:
      (request.printedProcess !== null && request.printedProcess !== request.process) ||
      (request.printedMaterial !== null &&
        request.printedMaterial !== request.material),
  }
}

/**
 * The settings as one line: `FDM · PETG · 20% GYROID`.
 *
 * The infill half disappears on resin rather than reading "null%", which is
 * the same absence the form draws.
 */
export function settingsLine(settings: {
  process: PrintProcess
  material: PrintMaterial
  infillPattern: InfillPattern | null
  infillDensity: number | null
}): string {
  const parts: string[] = [settings.process, MATERIAL_LABEL[settings.material]]

  if (settings.infillDensity !== null) {
    parts.push(
      settings.infillPattern
        ? `${settings.infillDensity}% ${patternLabel(settings.infillPattern)}`
        : `${settings.infillDensity}% infill`,
    )
  }

  return parts.join(' · ')
}

/**
 * What the officer actually did, in the words somebody would use for it.
 *
 * Named rather than left as "last moved by", because the status is not the
 * event. `REJECTED` in particular is two quite different things — refusing a
 * request nobody started, and stopping a print that was already running — and
 * `startedAt` is the only thing that tells them apart. Reading "declined the
 * request" about a print you watched come off the bed half-finished is the sort
 * of small wrongness that makes people stop trusting a page.
 */
export function actionPhrase(
  status: PrintRequestStatus,
  startedAt: string | null,
): string {
  switch (status) {
    case 'PRINTING':
      return 'started the print'
    case 'DONE':
      return 'marked the print as done'
    case 'REJECTED':
      return startedAt ? 'cancelled the print' : 'declined the request'
    default:
      // A `PENDING` row with an officer on it: nothing moved, so they came in
      // to leave a note or fix the settings.
      return 'updated the request'
  }
}

/**
 * What the button that ends a job badly should say.
 *
 * Declining is refusing something nobody has started. Cancelling is stopping
 * something already running, which has a printer to go and clear and possibly
 * a half-made object on it. Same status underneath; different act.
 */
export const isCancel = (status: PrintRequestStatus): boolean =>
  status === 'PRINTING'

/** Grams as the page prints them, and the one place the unit is spelled. */
export const grams = (value: number): string => `${value} g`

/**
 * How many, when it is worth saying. One of a thing is what almost every
 * request is, so printing "×1" on all of them would be noise on every row to
 * make the rare row legible.
 */
export const countLabel = (quantity: number): string | null =>
  quantity > 1 ? `×${String(quantity)}` : null

/** The most of one thing somebody can ask for, matching the server's cap. */
export const MAX_QUANTITY = 50
