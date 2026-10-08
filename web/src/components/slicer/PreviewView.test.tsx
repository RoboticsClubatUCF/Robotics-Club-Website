import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SLICED_CUBE_PREVIEW } from '../../lib/slicer/fixtures/slicedCubePreview'
import { parsePreview } from '../../lib/slicer/preview'
import { PreviewView } from './PreviewView'

const bed = { width: 256, depth: 256, height: 256, exclude: null }
const preview = parsePreview(Uint8Array.from(atob(SLICED_CUBE_PREVIEW), (c) => c.charCodeAt(0)))

// jsdom has no WebGL, so the view says it can't draw; the legend is the same either way.
describe('PreviewView legend', () => {
  it('gives each kind of path its share of Orca’s estimate', () => {
    // Orca's 3.51 g for this cube, shared by the filament each kind extrudes.
    render(<PreviewView bed={bed} preview={preview} grams={3.51} />)
    expect(screen.getByRole('button', { name: 'Outer wall 0.7 g' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sparse infill 1.3 g' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skirt, brim, purge 0.1 g' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Support/ })).not.toBeInTheDocument()
  })

  it('keeps a hidden kind’s share showing', () => {
    render(<PreviewView bed={bed} preview={preview} grams={3.51} />)
    const walls = screen.getByRole('button', { name: 'Outer wall 0.7 g' })
    fireEvent.click(walls)
    expect(walls).toHaveAttribute('aria-pressed', 'false')
    expect(walls).toHaveAccessibleName('Outer wall 0.7 g')
  })

  it('names the paths alone when Orca gave no estimate', () => {
    render(<PreviewView bed={bed} preview={preview} grams={null} />)
    expect(screen.getByRole('button', { name: 'Outer wall' })).toBeInTheDocument()
  })
})
