import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { placed } from '../../lib/training/practiceParts'
import { ObjectPanel } from './ObjectPanel'

const objects = [placed('cube', 'cube', 64, 64), placed('block', 'block', 190, 80)]

function Panel({ initial = ['cube'], parts = objects }: { initial?: string[]; parts?: typeof objects }) {
  const [selected, onSelect] = useState(initial)
  const [selectSeveral, onSelectSeveral] = useState(false)
  return <ObjectPanel objects={parts} models={[]} meshes={new Map()} problems={new Map()}
    selected={selected} onSelect={onSelect} selectSeveral={selectSeveral} onSelectSeveral={onSelectSeveral}
    disabled={false} onChange={vi.fn()} onCopy={vi.fn()} onDelete={vi.fn()} />
}

describe('ObjectPanel selection', () => {
  it('lets SELECT SEVERAL be turned off after only one part is left', () => {
    const { rerender } = render(<Panel />)
    const toggle = screen.getByRole('checkbox', { name: 'SELECT SEVERAL' })
    fireEvent.click(toggle)
    rerender(<Panel parts={[objects[0]!]} />)
    expect(toggle).toBeChecked()
    expect(toggle).toBeEnabled()
    fireEvent.click(toggle)
    expect(toggle).not.toBeChecked()
    expect(toggle).toBeDisabled()
  })

  it('adds and removes parts without modifiers when SELECT SEVERAL is on', () => {
    render(<Panel />)
    const toggle = screen.getByRole('checkbox', { name: 'SELECT SEVERAL' })
    const cube = screen.getByRole('button', { name: /Cube/ })
    const block = screen.getByRole('button', { name: /Block/ })
    expect(toggle.closest('[data-coach]')).toHaveAttribute('data-coach', 'select-several:off')
    fireEvent.click(toggle)
    fireEvent.click(block)
    expect(cube).toHaveAttribute('aria-pressed', 'true')
    expect(block).toHaveAttribute('aria-pressed', 'true')
    expect(toggle.closest('[data-coach]')).toHaveAttribute('data-coach', 'select-several:on')
    fireEvent.click(block)
    expect(block).toHaveAttribute('aria-pressed', 'false')
    expect(cube).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(toggle)
    fireEvent.click(block)
    expect(cube).toHaveAttribute('aria-pressed', 'false')
    expect(block).toHaveAttribute('aria-pressed', 'true')
  })

  it.each(['shiftKey', 'ctrlKey', 'metaKey'])('keeps %s selection with the toggle off', (modifier) => {
    render(<Panel />)
    const cube = screen.getByRole('button', { name: /Cube/ })
    const block = screen.getByRole('button', { name: /Block/ })
    fireEvent.click(block, { [modifier]: true })
    expect(cube).toHaveAttribute('aria-pressed', 'true')
    expect(block).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(cube, { [modifier]: true })
    expect(cube).toHaveAttribute('aria-pressed', 'false')
    expect(block).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps ordinary clicks selecting only one part', () => {
    render(<Panel initial={['cube', 'block']} />)
    fireEvent.click(screen.getByRole('button', { name: /Cube/ }))
    expect(screen.getByRole('button', { name: /Block/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('spinbutton', { name: 'Position X' })).toBeInTheDocument()
  })
})
