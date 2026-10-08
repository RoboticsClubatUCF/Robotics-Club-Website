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
const filament = (id: string, printers: string[]) => ({
  id,
  label: id,
  name: id,
  description: null,
  type: 'PLA',
  printers,
})

const profiles: ApiSlicerWorkspace['profiles'] = {
  printers: [
    printer('cc1', [process('cc1-std', 'Standard'), process('cc1-q', 'Q')]),
    printer('mk4', [process('mk4-fine', 'Fine'), process('mk4-q', 'Q')]),
  ],
  filaments: [filament('petg', ['cc1']), filament('pla', ['cc1', 'mk4']), filament('tpu', ['mk4'])],
}

describe('picking profiles', () => {
  it('starts a plate on the first printer, its first process and the first filament it takes', () => {
    expect(defaultChoice(profiles)).toEqual({ printerId: 'cc1', processId: 'cc1-std', filamentId: 'petg' })
  })

  it('offers only the filaments made for the printer', () => {
    expect(filamentsFor(profiles, 'mk4').map((f) => f.id)).toEqual(['pla', 'tpu'])
    expect(filamentsFor(profiles, null)).toEqual([])
  })

  it('moves to a printer with its process of the same name, keeping a filament that fits', () => {
    expect(onPrinter(profiles, { printerId: 'cc1', processId: 'cc1-q', filamentId: 'pla' }, 'mk4')).toEqual({
      printerId: 'mk4',
      processId: 'mk4-q',
      filamentId: 'pla',
    })
    expect(onPrinter(profiles, { printerId: 'cc1', processId: 'cc1-std', filamentId: 'petg' }, 'mk4')).toEqual({
      printerId: 'mk4',
      processId: 'mk4-fine',
      filamentId: 'pla',
    })
  })

  it('names the first thing missing from a plate', () => {
    expect(choiceProblem(profiles, defaultChoice(profiles))).toBeNull()
    expect(choiceProblem(profiles, { printerId: null, processId: null, filamentId: null })).toBe('Pick a printer.')
    expect(choiceProblem(profiles, { printerId: 'cc1', processId: 'mk4-q', filamentId: 'pla' })).toBe('Pick a process.')
    expect(choiceProblem(profiles, { printerId: 'cc1', processId: 'cc1-q', filamentId: 'tpu' })).toBe(
      "tpu isn't made for the cc1. Pick a filament.",
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
