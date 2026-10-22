import type { ApiSlicedWith, ApiSlicerPrinter, ApiSlicerWorkspace } from '../api/api'

/**
 * The printer, process and filament a plate names, and the rules for picking them, which the
 * server checks again (`server/src/printing/profiles.ts`): a process and a filament each belong to
 * one printer, since a spool is tuned per printer. Any id can be null, or name something the
 * workspace no longer offers, when an officer has deleted or hidden it since.
 */

export interface PlateChoice {
  printerId: string | null
  processId: string | null
  filamentId: string | null
}

type Profiles = ApiSlicerWorkspace['profiles']

export const printerOf = (profiles: Profiles, id: string | null): ApiSlicerPrinter | undefined =>
  profiles.printers.find((printer) => printer.id === id)

export const filamentsFor = (profiles: Profiles, printerId: string | null) =>
  profiles.filaments.filter((filament) => printerId !== null && filament.printers.includes(printerId))

/** What a new plate starts with: the first printer, its first process, the first filament it takes. */
export function defaultChoice(profiles: Profiles): PlateChoice {
  const printer = profiles.printers[0]
  return {
    printerId: printer?.id ?? null,
    processId: printer?.processes[0]?.id ?? null,
    filamentId: printer ? (filamentsFor(profiles, printer.id)[0]?.id ?? null) : null,
  }
}

/**
 * Moving a plate to another printer. Neither the process nor the filament can come along, so each
 * is the new printer's one of the same name if it has one, or its first.
 */
export function onPrinter(profiles: Profiles, choice: PlateChoice, printerId: string): PlateChoice {
  const printer = printerOf(profiles, printerId)
  const wasProcess = printerOf(profiles, choice.printerId)?.processes.find(
    (process) => process.id === choice.processId,
  )
  const process =
    printer?.processes.find((p) => wasProcess && p.label === wasProcess.label) ?? printer?.processes[0]
  const wasFilament = profiles.filaments.find((f) => f.id === choice.filamentId)
  const filaments = filamentsFor(profiles, printerId)
  const filament =
    filaments.find((f) => f.id === choice.filamentId) ??
    filaments.find((f) => wasFilament && f.label === wasFilament.label) ??
    filaments[0]
  return { printerId, processId: process?.id ?? null, filamentId: filament?.id ?? null }
}

/**
 * The first thing wrong with a plate's choice, in the words the workspace shows, or null.
 *
 * `saved` is the draft as the server has it. While the member hasn't touched a choice, a missing
 * one was taken away by an officer, and its label (kept in `slicedWith`) says which.
 */
export function choiceProblem(
  profiles: Profiles,
  choice: PlateChoice,
  saved?: (PlateChoice & { slicedWith: ApiSlicedWith }) | null,
): string | null {
  const gone = (key: keyof ApiSlicedWith, id: keyof PlateChoice) => {
    const label = saved && saved[id] === choice[id] ? saved.slicedWith[key] : ''
    return label ? `${label} isn't offered any more. Pick a ${key}.` : `Pick a ${key}.`
  }
  const printer = printerOf(profiles, choice.printerId)
  if (!printer) return gone('printer', 'printerId')
  if (!printer.processes.some((process) => process.id === choice.processId)) return gone('process', 'processId')
  const filament = profiles.filaments.find((f) => f.id === choice.filamentId)
  if (filament && !filament.printers.includes(printer.id)) {
    return `That ${filament.label} is set up for another printer. Pick a filament.`
  }
  return filament ? null : gone('filament', 'filamentId')
}
