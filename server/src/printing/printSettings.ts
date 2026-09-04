import { z } from 'zod'
import {
  InfillPattern,
  PrintMaterial,
  PrintProcess,
} from '../generated/prisma/enums.js'

/**
 * What may be asked of the printers, as one rule both writers share.
 *
 * Two writers exist — the member's request in `routes/member/print.ts` and the officer's correction
 * in `routes/officer/officer.ts`, which records what actually came off the machine — and they have
 * to agree about what a legal combination is. Written twice they would agree until one of them was
 * edited.
 *
 * The rule itself is the pairing:
 *
 * - FDM takes `PLA` or `PETG`, and wants an infill pattern and density.
 * - SLA takes `ABS_LIKE_RESIN` and nothing else — the club stocks one resin — and has no infill at
 *   all. A resin print is a solid or a hollowed shell; "20% gyroid" is not a thing that can be done
 *   to it, so the fields are refused rather than stored as a number nobody can act on.
 *
 * A discriminated union rather than a flat object with a `superRefine`, because the two shapes
 * genuinely differ: zod then narrows the material to the right pair on its own, and an SLA body
 * carrying infill fails on the field that is wrong instead of on a hand-written message about the
 * whole.
 */

/** Sane bounds. 0% is hollow and 100% is solid; both are things people ask for. */
const density = z.coerce.number().int().min(0).max(100)

const fdm = z.object({
  process: z.literal(PrintProcess.FDM),
  material: z.enum([PrintMaterial.PLA, PrintMaterial.PETG]),
  infillPattern: z.enum(InfillPattern),
  infillDensity: density,
})

const sla = z.object({
  process: z.literal(PrintProcess.SLA),
  material: z.literal(PrintMaterial.ABS_LIKE_RESIN),
  // Present and undefined is fine — a form that always sends its fields sends
  // empty strings, and the route strips those. Present with a *value* is the
  // mistake worth catching, and `never` is what says so.
  infillPattern: z.never().optional(),
  infillDensity: z.never().optional(),
})

export const printSettings = z.discriminatedUnion('process', [fdm, sla])

export type PrintSettings = z.infer<typeof printSettings>

/**
 * The same choice, for the officer recording what was printed. Optional as a
 * whole — most jobs come off the printer as they were asked for, and null in
 * every `printed*` column is how the row says "as asked".
 */
export const printedSettings = printSettings.optional()

/**
 * Flatten settings into the four columns, filling the infill pair with null on
 * resin. Callers spread the result straight into a Prisma `data`, so the nulls
 * matter: they are what clears a stale pattern when an officer corrects an FDM
 * request to SLA.
 */
export function settingsColumns(settings: PrintSettings) {
  return {
    process: settings.process,
    material: settings.material,
    infillPattern:
      settings.process === PrintProcess.FDM ? settings.infillPattern : null,
    infillDensity:
      settings.process === PrintProcess.FDM ? settings.infillDensity : null,
  }
}

/** The same, under the `printed*` names. */
export function printedColumns(settings: PrintSettings) {
  const columns = settingsColumns(settings)

  return {
    printedProcess: columns.process,
    printedMaterial: columns.material,
    printedInfillPattern: columns.infillPattern,
    printedInfillDensity: columns.infillDensity,
  }
}

/**
 * How the club says these out loud — for the Discord message officers get, and
 * nothing else. The web package has its own copy for the pages it renders,
 * because it cannot import from here.
 */
export const MATERIAL_LABEL: Record<PrintMaterial, string> = {
  [PrintMaterial.PLA]: 'PLA',
  [PrintMaterial.PETG]: 'PETG',
  [PrintMaterial.ABS_LIKE_RESIN]: 'ABS-like resin',
}
