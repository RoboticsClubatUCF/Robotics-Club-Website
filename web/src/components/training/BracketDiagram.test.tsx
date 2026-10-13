import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BracketDiagram } from './BracketDiagram'

describe('BracketDiagram', () => {
  it('describes each distinct orientation and its matching layer to a screen reader', () => {
    render(<BracketDiagram />)
    expect(screen.getByRole('img', { name: /A: On its foot.*short side rests/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /B: On its back.*long side rests/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /C: On its L-shaped end.*L-shaped end rests/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'A: One example layer from above, a narrow rectangle.' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'B: One example layer from above, a narrow rectangle.' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'C: One example layer from above, an L shape.' })).toBeInTheDocument()
    expect(screen.getByText('Gold marks one example layer.')).toBeInTheDocument()
    expect(screen.getByText('Short side on the plate')).toBeInTheDocument()
    expect(screen.getByText('Long side on the plate')).toBeInTheDocument()
    expect(screen.getByText('L-shaped end on the plate')).toBeInTheDocument()
  })
})
