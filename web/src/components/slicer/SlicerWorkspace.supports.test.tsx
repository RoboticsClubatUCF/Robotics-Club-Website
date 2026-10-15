import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useEffectEvent } from 'react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { Quat } from '../../lib/slicer/orient'
import { primeMesh } from '../../lib/slicer/meshes'
import { PRACTICE_WORKSPACE } from '../../lib/training/practiceProfiles'
import { modelIdOf, placed, turn } from '../../lib/training/practiceParts'
import { usePracticePlate } from '../../lib/training/usePracticePlate'
import { WorkspaceView } from './SlicerWorkspace'

vi.mock('./PlateView', () => ({ PlateView: () => <div /> }))

/** A square 10 mm across at the foot and 40 mm at the top, 5 mm up: a mushroom's cap. */
const cap = (() => {
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]
  const v = [[-5, -5, 0], [5, -5, 0], [5, 5, 0], [-5, 5, 0], [-20, -20, 5], [20, -20, 5], [20, 20, 5], [-20, 20, 5]]
  return Float32Array.from(f.flatMap((tri) => tri.flatMap((i) => v[i]!)))
})()

// Before the first render, whose mesh effect would otherwise fetch it.
primeMesh(modelIdOf('mushroom'), cap)

function Workspace({ turns = [] }: { turns?: Quat[] }) {
  const practice = usePracticePlate(new Map([['mushroom', cap]]))
  const setUp = useEffectEvent(() => {
    practice.setUp([placed('mushroom', 'mushroom', 128, 128, { turns })])
  })
  useEffect(() => {
    setUp()
  }, [])
  return (
    <MemoryRouter>
      <WorkspaceView
        plateKey="practice"
        plate={practice.source}
        preview={{ status: 'none' }}
        workspace={PRACTICE_WORKSPACE}
        projects={[]}
        allowance={null}
        onSent={vi.fn()}
      />
    </MemoryRouter>
  )
}

const status = () => screen.getByRole('status', { name: 'Plate status' })
const supportsOff = () => {
  fireEvent.click(screen.getByRole('tab', { name: /^Support/ }))
  fireEvent.click(screen.getByRole('switch', { name: 'Supports' }))
}

describe('supports off', () => {
  it('warns when a part hangs over the plate, and still slices', async () => {
    render(<Workspace />)
    supportsOff()
    await waitFor(() => {
      expect(status()).toHaveTextContent(
        'Part of Mushroom would print in mid-air. Switch Supports on in the Support tab, or turn it.',
      )
    })
    expect(screen.getByRole('button', { name: 'SLICE PLATE' })).toBeEnabled()
    fireEvent.click(screen.getByRole('switch', { name: 'Supports' }))
    expect(status()).not.toHaveTextContent('mid-air')
  })

  it('says nothing about a part with nothing hanging over', async () => {
    render(<Workspace turns={[turn('x', 180)]} />)
    supportsOff()
    // Past the mesh arriving, which is when the upright one's warning shows.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(status()).not.toHaveTextContent('mid-air')
  })
})
