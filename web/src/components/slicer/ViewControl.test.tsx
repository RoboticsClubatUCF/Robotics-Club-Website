import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { type CameraMoves, SLIDE_STEP, TURN_STEP } from '../../lib/slicer/camera'
import { ViewControl } from './ViewControl'

const moves = (): CameraMoves => ({ reset: vi.fn(), turn: vi.fn(), slide: vi.fn(), zoom: vi.fn(), look: vi.fn() })

describe('ViewControl', () => {
  it('puts the view back when pressed', () => {
    const camera = moves()
    render(<ViewControl camera={() => camera} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }))
    expect(camera.reset).toHaveBeenCalledOnce()
  })

  it('says which keys move the view', () => {
    render(<ViewControl camera={() => null} />)
    const button = screen.getByRole('button', { name: 'Reset view' })
    expect(button).toHaveAccessibleDescription(/turn.*Shift \+ arrows.*slide.*zoom in, zoom out.*back to the start/)
    expect(button).toHaveAttribute('aria-keyshortcuts', expect.stringContaining('Shift+ArrowLeft'))
    // A lesson's picture takes the keys on its button only.
    expect(screen.queryByText(/anywhere on the plate/)).not.toBeInTheDocument()
  })

  it('says the numbers work across the plate where the workspace sends them', () => {
    render(<ViewControl camera={() => null} everywhere />)
    expect(screen.getByText(/The numbers, I and O also work anywhere on the plate/)).toBeInTheDocument()
  })

  it('turns the view with the arrows and slides it with Shift, and keeps those keys from the plate', () => {
    const camera = moves()
    const plate = vi.fn()
    window.addEventListener('keydown', plate)
    render(<ViewControl camera={() => camera} />)
    const button = screen.getByRole('button', { name: 'Reset view' })

    fireEvent.keyDown(button, { key: 'ArrowRight' })
    expect(camera.turn).toHaveBeenLastCalledWith(TURN_STEP, 0)
    fireEvent.keyDown(button, { key: 'ArrowDown', shiftKey: true })
    expect(camera.slide).toHaveBeenLastCalledWith(0, -SLIDE_STEP)
    fireEvent.keyDown(button, { key: '2' })
    expect(camera.look).toHaveBeenLastCalledWith('bottom')

    // The workspace's own shortcuts skip a key something already handled; an arrow here mustn't
    // also nudge the selected parts.
    expect(plate.mock.calls.every(([event]) => (event as KeyboardEvent).defaultPrevented)).toBe(true)
    window.removeEventListener('keydown', plate)
  })

  it('does nothing with a key the view doesn’t use', () => {
    const camera = moves()
    render(<ViewControl camera={() => camera} />)
    const button = screen.getByRole('button', { name: 'Reset view' })
    fireEvent.keyDown(button, { key: 'm' })
    expect(Object.values(camera).every((move) => vi.mocked(move).mock.calls.length === 0)).toBe(true)
  })
})
