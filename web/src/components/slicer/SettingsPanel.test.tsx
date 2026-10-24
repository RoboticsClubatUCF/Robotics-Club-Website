import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { ApiSlicerPrinter, ApiSlicerWorkspace } from '../../lib/api/api'
import { OPTIONAL_CHAPTERS, REQUIRED_CHAPTERS } from '../../lib/slicer/trainingChapters'
import { SettingsPanel } from './SettingsPanel'

const EVERY_CHAPTER = [...REQUIRED_CHAPTERS, ...OPTIONAL_CHAPTERS]

const values = {
  layer_height: 0.2,
  initial_layer_print_height: 0.2,
  wall_generator: 'classic',
  seam_position: 'aligned',
  ironing_type: 'no ironing',
  wall_loops: 2,
  top_shell_layers: 5,
  top_shell_thickness: 1,
  bottom_shell_layers: 3,
  bottom_shell_thickness: 0.6,
  sparse_infill_density: 15,
  sparse_infill_pattern: 'line',
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

const printer = (id: string, label: string, processes: ApiSlicerPrinter['processes']): ApiSlicerPrinter => ({
  id,
  label,
  name: label,
  description: null,
  model: 'Elegoo Centauri Carbon',
  nozzle: 0.4,
  bedType: 'Textured PEI Plate',
  bed: { width: 256, depth: 256, height: 256, exclude: null },
  layerHeight: { min: 0.08, max: 0.28 },
  processes,
})

const cc1 = printer('cc1', 'CC1', [
  { id: 'std', label: 'Standard', name: 'Standard preset', description: '2 walls, 15% line', values },
  { id: 'qs', label: 'Q-S', name: 'Q-S preset', description: '6 walls, 6% 3d honeycomb', values: { ...values, wall_loops: 6 } },
])

const profiles: ApiSlicerWorkspace['profiles'] = {
  printers: [cc1],
  filaments: [
    { id: 'pla', label: 'PLA', name: 'Elegoo Rapid PLA', description: 'The default for a reason.', type: 'PLA', printers: ['cc1'] },
    { id: 'petg', label: 'PETG', name: 'Elegoo RAPID PETG Optimized', description: null, type: 'PETG', printers: ['cc1'] },
  ],
}

const SETTINGS = { printerId: 'cc1', processId: 'std', filamentId: 'pla' }

const show = (
  overrides: Record<string, number | boolean | string> = {},
  choice: Partial<typeof SETTINGS> | { [K in keyof typeof SETTINGS]?: string | null } = {},
  shown = profiles,
  chapters: readonly string[] = EVERY_CHAPTER,
) => {
  const onChange = vi.fn()
  render(
    <MemoryRouter>
      <SettingsPanel
        profiles={shown}
        settings={{ ...SETTINGS, ...choice, overrides }}
        chapters={chapters}
        disabled={false}
        onChange={onChange}
      />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('tab', { name: /strength/i }))
  return onChange
}

describe('SettingsPanel', () => {
  it('shows the preset’s own numbers until something is changed', () => {
    show()
    expect(screen.getByLabelText('Walls')).toHaveValue(2)
    expect(screen.getByLabelText('Infill density')).toHaveValue(15)
    expect(screen.queryByRole('button', { name: /reset/i })).not.toBeInTheDocument()
  })

  it('stores a change as an override, and offers the way back', () => {
    const onChange = show({ wall_loops: 4 })
    expect(screen.getByLabelText('Walls')).toHaveValue(4)
    fireEvent.click(screen.getByRole('button', { name: /reset walls to the preset's 2/i }))
    expect(onChange).toHaveBeenCalledWith({ overrides: {} })
  })

  it('counts the changes on each tab', () => {
    show({ wall_loops: 4, sparse_infill_density: 30 })
    expect(screen.getByRole('tab', { name: 'Strength, 2 changed' })).toBeInTheDocument()
  })

  it('refuses a number outside the setting’s bounds without saving it', () => {
    const onChange = show()
    const walls = screen.getByLabelText('Walls')
    fireEvent.change(walls, { target: { value: '40' } })
    fireEvent.keyDown(walls, { key: 'Enter' })
    expect(screen.getByRole('alert')).toHaveTextContent('1 to 10')
    expect(walls).toHaveAttribute('aria-invalid', 'true')
    // Leaving puts the saved number back rather than showing one the plate doesn't have.
    fireEvent.blur(walls)
    expect(walls).toHaveValue(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('treats setting the preset’s own value as no change', () => {
    const onChange = show({ wall_loops: 4 })
    const walls = screen.getByLabelText('Walls')
    fireEvent.change(walls, { target: { value: '2' } })
    fireEvent.keyDown(walls, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith({ overrides: {} })
  })

  it('switches process and filament', () => {
    const onChange = show()
    fireEvent.change(screen.getByRole('combobox', { name: 'PROCESS' }), { target: { value: 'qs' } })
    expect(onChange).toHaveBeenCalledWith({ processId: 'qs' })
    fireEvent.change(screen.getByRole('combobox', { name: 'FILAMENT' }), { target: { value: 'petg' } })
    expect(onChange).toHaveBeenCalledWith({ filamentId: 'petg' })
  })

  it('names the one printer rather than offering a choice of one, and says what the filament is for', () => {
    show()
    expect(screen.getByText('CC1')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'PRINTER' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'PLA · Elegoo Rapid PLA' })).toBeInTheDocument()
    expect(screen.getByText('The default for a reason.')).toBeInTheDocument()
  })

  it('moves to another printer with one of its processes and a filament it takes', () => {
    const mk4 = printer('mk4', 'MK4', [
      { id: 'fine', label: 'Fine', name: 'Fine', description: 'Fine.', values },
      { id: 'mk4-qs', label: 'Q-S', name: 'Q-S', description: 'Q-S.', values },
    ])
    const two = {
      printers: [cc1, mk4],
      filaments: [
        { ...profiles.filaments[1]!, printers: ['cc1'] },
        { id: 'tpu', label: 'TPU', name: 'TPU', description: null, type: 'TPU', printers: ['mk4'] },
      ],
    }
    const onChange = show({}, { processId: 'qs', filamentId: 'petg' }, two)
    // The filaments on offer are the printer's own.
    expect(screen.queryByRole('option', { name: 'TPU' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'PRINTER' }), { target: { value: 'mk4' } })
    expect(onChange).toHaveBeenCalledWith({ printerId: 'mk4', processId: 'mk4-qs', filamentId: 'tpu' })
  })

  it('asks for a choice an officer has since deleted, and holds back the settings', () => {
    show({}, { processId: null, filamentId: 'gone' })
    expect(screen.getByRole('combobox', { name: 'PROCESS' })).toHaveValue('')
    expect(screen.getByRole('option', { name: 'Choose a process' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Choose a filament' })).toBeInTheDocument()
    expect(screen.getByText('Pick a process to change how it prints.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Walls')).not.toBeInTheDocument()
  })
})

describe('SettingsPanel before the optional chapters', () => {
  const basics = [...REQUIRED_CHAPTERS]

  it('locks the settings, naming the chapter that unlocks them', () => {
    show({}, {}, profiles, basics)
    expect(screen.getByLabelText('Walls')).toBeDisabled()
    expect(screen.getByLabelText('Infill pattern')).toBeDisabled()
    expect(screen.getByLabelText('Walls')).toHaveAccessibleDescription('Locked. Training chapter: Strength settings')
    expect(screen.getByRole('link', { name: 'Strength settings' })).toHaveAttribute(
      'href',
      '/dashboard/profile/training?chapter=strength',
    )
    expect(screen.getByRole('tab', { name: 'Strength, locked' })).toBeInTheDocument()
    // One line for the run of settings, not one each.
    expect(screen.getAllByRole('link', { name: 'Strength settings' })).toHaveLength(1)
  })

  it('locks the printer, filament and process while there are others to pick', () => {
    show({}, {}, profiles, basics)
    expect(screen.getByRole('combobox', { name: 'FILAMENT' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'PROCESS' })).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Printer, filament and process' })).toHaveAttribute(
      'href',
      '/dashboard/profile/training?chapter=materials',
    )
  })

  it('lets a profile an officer took away be picked again', () => {
    show({}, { filamentId: 'gone' }, profiles, basics)
    expect(screen.getByRole('combobox', { name: 'FILAMENT' })).toBeEnabled()
    expect(screen.getByRole('combobox', { name: 'PROCESS' })).toBeDisabled()
  })

  it('opens only what a finished chapter teaches, a run of settings at a time', () => {
    show({}, {}, profiles, [...basics, 'adhesion'])
    fireEvent.click(screen.getByRole('tab', { name: /others/i }))
    expect(screen.getByLabelText('Brim')).toBeEnabled()
    expect(screen.getByLabelText('Skirt loops')).toBeEnabled()
    expect(screen.getByLabelText('Vase mode')).toBeDisabled()
    expect(screen.getAllByRole('link', { name: 'Vase mode and fuzzy skin' })).toHaveLength(1)
    expect(screen.getByRole('tab', { name: 'Others' })).toBeInTheDocument()
  })

  it('still lets a locked setting go back to the process', () => {
    const onChange = show({ wall_loops: 4 }, {}, profiles, basics)
    fireEvent.click(screen.getByRole('button', { name: /reset walls to the preset's 2/i }))
    expect(onChange).toHaveBeenCalledWith({ overrides: {} })
  })
})
