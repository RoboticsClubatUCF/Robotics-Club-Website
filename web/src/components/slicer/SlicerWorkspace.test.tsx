import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useEffectEvent } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiPlacement, ApiPlateObject } from '../../lib/api/api'
import { primeMesh } from '../../lib/slicer/meshes'
import { placed } from '../../lib/training/practiceParts'
import { PRACTICE_WORKSPACE } from '../../lib/training/practiceProfiles'
import { usePracticePlate } from '../../lib/training/usePracticePlate'
import { WorkspaceView } from './SlicerWorkspace'

vi.mock('./PlateView', () => ({
  PlateView: ({ objects, onSelect, onDrag, onCommit }: {
    objects: ApiPlateObject[]
    onSelect: (ids: string[]) => void
    onDrag: (placements: ReadonlyMap<string, Partial<ApiPlacement>>) => void
    onCommit: (placements: ReadonlyMap<string, Partial<ApiPlacement>>) => void
  }) => <>
    <output data-testid="placements">{objects.map(o => `${o.id}:${String(o.x)},${String(o.y)}`).join(';')}</output>
    <button onClick={() => onSelect(['cube', 'block'])}>Select group</button>
    <button onClick={() => {
      const next = new Map([['cube', { x: 74, y: 144 }], ['block', { x: 200, y: 160 }]])
      onDrag(next)
      onCommit(next)
    }}>Quick group drag</button>
    <button onClick={() => {
      const next = new Map([['block', { x: 300, y: 80 }]])
      onDrag(next)
      onCommit(next)
    }}>Move off plate</button>
  </>,
}))

const mesh = Float32Array.from([0, 0, 0, 20, 0, 0, 0, 20, 0])

function Workspace({ notice = false }: { notice?: boolean }) {
  const practice = usePracticePlate(new Map([['cube', mesh], ['block', mesh]]))
  const setUp = useEffectEvent(() => {
    practice.setUp([placed('cube', 'cube', 64, 64), placed('block', 'block', 190, 80)])
  })
  useEffect(() => {
    setUp()
  }, [])
  return <MemoryRouter><WorkspaceView plateKey="practice" plate={{ ...practice.source,
    ...(notice ? { notice: 'Practice notice.', clearNotice: vi.fn() } : {}),
  }} preview={{ status: 'none' }} workspace={PRACTICE_WORKSPACE} projects={[]} allowance={null}
    onSent={vi.fn()} back={null} /></MemoryRouter>
}

beforeEach(() => {
  primeMesh('practice-cube', mesh)
  primeMesh('practice-block', mesh)
})

describe('WorkspaceView', () => {
  it('commits both parts after a quick drag and undoes/redoes them as one step', () => {
    render(<Workspace />)
    fireEvent.click(screen.getByRole('button', { name: 'Select group' }))
    fireEvent.click(screen.getByRole('button', { name: 'Quick group drag' }))
    expect(screen.getByTestId('placements')).toHaveTextContent('cube:74,144;block:200,160')
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(screen.getByTestId('placements')).toHaveTextContent('cube:64,64;block:190,80')
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true })
    expect(screen.getByTestId('placements')).toHaveTextContent('cube:74,144;block:200,160')
  })

  it('keeps warnings in the same status region and blocks slicing until the part fits', async () => {
    render(<Workspace />)
    const status = screen.getByRole('status', { name: 'Plate status' })
    expect(status.textContent).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Move off plate' }))
    expect(screen.getByRole('status', { name: 'Plate status' })).toBe(status)
    await waitFor(() => expect(status).toHaveTextContent('Block hangs off the plate.'))
    expect(screen.getByRole('button', { name: 'SLICE PLATE' })).toBeDisabled()
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(status).not.toHaveTextContent('hangs off')
    expect(screen.getByRole('button', { name: 'SLICE PLATE' })).toBeEnabled()
  })

  it('shows dismissible notices in the plate status region', () => {
    render(<Workspace notice />)
    const status = screen.getByRole('status', { name: 'Plate status' })
    expect(status).toHaveTextContent('Practice notice.')
    expect(screen.getByRole('button', { name: 'Dismiss' }).closest('[role="status"]')).toBe(status)
  })
})
