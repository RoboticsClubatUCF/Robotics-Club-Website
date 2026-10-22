import { describe, expect, it } from 'vitest'
import type { ApiSlicerWorkspace } from '../api/api'
import { choiceProblem, defaultChoice, filamentsFor, onPrinter } from './profiles'

const bed = { width: 256, depth: 256, height: 256, exclude: null }
const process = (id: string, label: string) => ({ id, label, name: label, description: '', values: {} })
const printer = (id: string, processes: ReturnType<typeof process>[]) => ({
  id,
  label: id,
  name: id,
  description: null,
  model: id,
  nozzle: 0.4,
  bedType: 'Textured PEI Plate',
  bed,
  layerHeight: { min: 0.08, max: 0.28 },
  processes,
})
/** A filament is set up on one printer; the same spool on another printer is another row. */
const filament = (id: string, label: string, printer: string) => ({
  id,
  label,
  name: label,
  description: null,
  type: 'PLA',
  printers: [printer],
})

const profiles: ApiSlicerWorkspace['profiles'] = {
  printers: [
    printer('cc1', [process('cc1-std', 'Standard'), process('cc1-q', 'Q')]),
    printer('mk4', [process('mk4-fine', 'Fine'), process('mk4-q', 'Q')]),
  ],
  filaments: [
    filament('cc1-petg', 'PETG', 'cc1'),
    filament('cc1-pla', 'PLA', 'cc1'),
    filament('mk4-tpu', 'TPU', 'mk4'),
    filament('mk4-pla', 'PLA', 'mk4'),
  ],
}

describe('picking profiles', () => {
  it('starts a plate on the first printer, its first process and its first filament', () => {
    expect(defaultChoice(profiles)).toEqual({ printerId: 'cc1', processId: 'cc1-std', filamentId: 'cc1-petg' })
  })

  it('offers only the printer’s own filaments', () => {
    expect(filamentsFor(profiles, 'mk4').map((f) => f.id)).toEqual(['mk4-tpu', 'mk4-pla'])
    expect(filamentsFor(profiles, null)).toEqual([])
  })

  it('moves to a printer with its process and filament of the same name, or its first', () => {
    expect(onPrinter(profiles, { printerId: 'cc1', processId: 'cc1-q', filamentId: 'cc1-pla' }, 'mk4')).toEqual({
      printerId: 'mk4',
      processId: 'mk4-q',
      filamentId: 'mk4-pla',
    })
    expect(onPrinter(profiles, { printerId: 'cc1', processId: 'cc1-std', filamentId: 'cc1-petg' }, 'mk4')).toEqual({
      printerId: 'mk4',
      processId: 'mk4-fine',
      filamentId: 'mk4-tpu',
    })
  })

  it('names the first thing missing from a plate', () => {
    expect(choiceProblem(profiles, defaultChoice(profiles))).toBeNull()
    expect(choiceProblem(profiles, { printerId: null, processId: null, filamentId: null })).toBe('Pick a printer.')
    expect(choiceProblem(profiles, { printerId: 'cc1', processId: 'mk4-q', filamentId: 'cc1-pla' })).toBe('Pick a process.')
    expect(choiceProblem(profiles, { printerId: 'cc1', processId: 'cc1-q', filamentId: 'mk4-tpu' })).toBe(
      'That TPU is set up for another printer. Pick a filament.',
    )
  })

  it('names a profile an officer took away, by the label the plate was saved with', () => {
    const saved = {
      printerId: 'cc1',
      processId: 'cc1-q',
      filamentId: null,
      slicedWith: { printer: 'CC1', process: 'Q', filament: 'Silk PLA' },
    }
    expect(choiceProblem(profiles, { printerId: 'cc1', processId: 'cc1-q', filamentId: null }, saved)).toBe(
      "Silk PLA isn't offered any more. Pick a filament.",
    )
    // A hidden one keeps its id on the plate but isn't offered.
    expect(
      choiceProblem(profiles, { printerId: 'cc1', processId: 'cc1-q', filamentId: 'hidden' }, { ...saved, filamentId: 'hidden' }),
    ).toBe("Silk PLA isn't offered any more. Pick a filament.")
  })
})
