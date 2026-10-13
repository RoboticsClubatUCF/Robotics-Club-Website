import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PlateToolbar } from './PlateToolbar'
import type { PlateMode } from './PlateView'

const actions = () => ({ onAdd: vi.fn(), onArrange: vi.fn(), onOrient: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn() })

describe('plate tools with Orca artwork', () => {
  it('keeps named actions and shortcuts usable with decorative icons', () => {
    const callbacks = actions()
    render(<PlateToolbar mode="move" hasSelection hasObjects disabled={false} onMode={vi.fn()} {...callbacks} />)
    const tools = within(screen.getByRole('toolbar', { name: 'Plate tools' }))
    for (const [label, callback] of [['Arrange', callbacks.onArrange], ['Auto-orient', callbacks.onOrient], ['Copy', callbacks.onCopy], ['Delete', callbacks.onDelete]] as const) {
      const button = tools.getByRole('button', { name: label })
      expect(button.querySelector('[aria-hidden="true"]')).toBeInTheDocument()
      fireEvent.click(button)
      expect(callback).toHaveBeenCalledOnce()
    }
    expect(tools.getByRole('button', { name: 'Copy' })).toHaveAttribute('title', 'Copy (Ctrl+D)')
    expect(tools.getByRole('button', { name: 'Lay on face' })).toHaveAttribute('data-coach', 'tool:lay-on-face')
  })

  it('keeps a single pressed tool as members switch modes', () => {
    function Tools() {
      const [mode, setMode] = useState<PlateMode>('move')
      return <PlateToolbar mode={mode} hasSelection hasObjects disabled={false} onMode={setMode} {...actions()} />
    }
    render(<Tools />)
    for (const label of ['Move', 'Rotate', 'Scale', 'Lay on face']) {
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1)
    }
  })

  it('keeps unavailable actions disabled on an empty or locked plate', () => {
    const callbacks = actions()
    const props = { mode: 'move' as const, hasSelection: false, hasObjects: false, onMode: vi.fn(), ...callbacks }
    const { rerender } = render(<PlateToolbar {...props} disabled={false} />)
    expect(screen.getByRole('button', { name: 'Add a model' })).toBeEnabled()
    for (const label of ['Arrange', 'Auto-orient', 'Copy', 'Delete']) {
      expect(screen.getByRole('button', { name: label })).toBeDisabled()
      fireEvent.click(screen.getByRole('button', { name: label }))
    }
    expect(callbacks.onCopy).not.toHaveBeenCalled()
    rerender(<PlateToolbar {...props} hasSelection hasObjects disabled />)
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
  })
})
