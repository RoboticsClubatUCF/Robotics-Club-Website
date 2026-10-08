import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ApiSlicerWorkspace } from '../../lib/api/api'
import { SettingsPanel } from './SettingsPanel'

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

const profiles: ApiSlicerWorkspace['profiles'] = {
  printer: { name: 'CC1', model: 'Elegoo Centauri Carbon', nozzle: 0.4, bedType: 'Textured PEI Plate' },
  bed: { width: 256, depth: 256, height: 256, exclude: null },
  layerHeight: { min: 0.08, max: 0.28 },
  presets: [
    { key: 'STANDARD', label: 'Standard', name: 'Standard preset', description: '2 walls, 15% line', values },
    { key: 'QS', label: 'Q-S', name: 'Q-S preset', description: '6 walls, 6% 3d honeycomb', values: { ...values, wall_loops: 6 } },
  ],
  materials: [
    { key: 'PLA', name: 'Elegoo Rapid PLA' },
    { key: 'PETG', name: 'Elegoo RAPID PETG Optimized' },
  ],
}

const show = (overrides: Record<string, number | boolean | string> = {}) => {
  const onChange = vi.fn()
  render(
    <SettingsPanel
      profiles={profiles}
      settings={{ material: 'PLA', preset: 'STANDARD', overrides }}
      disabled={false}
      onChange={onChange}
    />,
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
    fireEvent.blur(walls)
    expect(screen.getByRole('alert')).toHaveTextContent('1 to 10')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('treats setting the preset’s own value as no change', () => {
    const onChange = show({ wall_loops: 4 })
    const walls = screen.getByLabelText('Walls')
    fireEvent.change(walls, { target: { value: '2' } })
    fireEvent.keyDown(walls, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith({ overrides: {} })
  })

  it('switches preset and filament', () => {
    const onChange = show()
    fireEvent.change(screen.getByRole('combobox', { name: 'PROCESS' }), { target: { value: 'QS' } })
    expect(onChange).toHaveBeenCalledWith({ preset: 'QS' })
    fireEvent.change(screen.getByRole('combobox', { name: 'FILAMENT' }), { target: { value: 'PETG' } })
    expect(onChange).toHaveBeenCalledWith({ material: 'PETG' })
  })
})
