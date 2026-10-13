import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InfillTiles } from './InfillTiles'

describe('InfillTiles', () => {
  it('identifies the current and previous layers and describes how each pattern builds', () => {
    render(<InfillTiles />)
    expect(screen.getByRole('figure', { name: 'Infill patterns by layer' })).toBeInTheDocument()
    expect(screen.getByText('Current layer')).toBeInTheDocument()
    expect(screen.getByText('Previous layers')).toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(6)
    expect(screen.getByRole('img', { name: /LINE: Parallel straight lines change direction/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /GRID: Two directions of lines cross on each layer/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /TRIANGLES: Three directions/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /HONEYCOMB: Hexagons repeat/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /GYROID: Curved paths change shape/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /CONCENTRIC: Nested rings/ })).toBeInTheDocument()
    for (const image of screen.getAllByRole('img')) expect(image).toHaveAccessibleName(/Current layer in blue; previous layers in gray/)
  })
})
