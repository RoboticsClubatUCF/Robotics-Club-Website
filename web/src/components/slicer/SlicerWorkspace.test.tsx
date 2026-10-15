import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useEffectEvent } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiPlacement, ApiPlateObject } from '../../lib/api/api'
import { primeMesh } from '../../lib/slicer/meshes'
import { boxOn } from '../../lib/slicer/plate'
import { placed, turn } from '../../lib/training/practiceParts'
import { PRACTICE_WORKSPACE } from '../../lib/training/practiceProfiles'
import { usePracticePlate } from '../../lib/training/usePracticePlate'
import { WorkspaceView } from './SlicerWorkspace'

vi.mock('./PlateView', () => ({
  PlateView: ({ objects, meshes, onSelect, onDrag, onCommit }: {
    objects: ApiPlateObject[]
    meshes: ReadonlyMap<string, Float32Array>
    onSelect: (ids: string[]) => void
    onDrag: (placements: ReadonlyMap<string, Partial<ApiPlacement>>) => void
    onCommit: (placements: ReadonlyMap<string, Partial<ApiPlacement>>) => void
  }) => <>
    <output data-testid="placements">{objects.map(o => `${o.id}:${String(o.x)},${String(o.y)}`).join(';')}</output>
    <output data-testid="objects">{JSON.stringify(objects)}</output>
    <output data-testid="mesh-count">{meshes.size}</output>
    <button onClick={() => onSelect(['cube'])}>Select cube</button>
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

const tiltedObjects = [
  placed('cube', 'cube', 64, 64, { turns: [turn('x', 90)], scale: 1.25 }),
  placed('block', 'block', 190, 80, { turns: [turn('x', 90)] }),
  placed('cube', 'twin', 120, 160, { turns: [turn('y', 90)] }),
]

const readObjects = (): ApiPlateObject[] => JSON.parse(screen.getByTestId('objects').textContent!) as ApiPlateObject[]

function Workspace({ notice = false, initialObjects }: { notice?: boolean; initialObjects?: ApiPlateObject[] }) {
  const practice = usePracticePlate(new Map([['cube', mesh], ['block', mesh]]))
  const setUp = useEffectEvent(() => {
    practice.setUp(initialObjects ?? [placed('cube', 'cube', 64, 64), placed('block', 'block', 190, 80)])
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
  it('disables auto-orient without a selection, including after clearing one', () => {
    render(<Workspace initialObjects={tiltedObjects} />)
    const orient = screen.getByRole('button', { name: 'Auto-orient' })
    expect(orient).toBeDisabled()
    fireEvent.click(orient)
    expect(readObjects()).toEqual(tiltedObjects)
    fireEvent.click(screen.getByRole('button', { name: 'Select cube' }))
    expect(orient).toBeEnabled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(orient).toBeDisabled()
    fireEvent.click(orient)
    expect(readObjects()).toEqual(tiltedObjects)
  })

  it('auto-orients only the selected object and leaves other models and copies unchanged', async () => {
    render(<Workspace initialObjects={tiltedObjects} />)
    await waitFor(() => expect(screen.getByTestId('mesh-count')).toHaveTextContent('2'))
    fireEvent.click(screen.getByRole('button', { name: 'Select cube' }))
    fireEvent.click(screen.getByRole('button', { name: 'Auto-orient' }))
    const oriented = readObjects()
    expect(oriented[0]).not.toEqual(tiltedObjects[0])
    expect(oriented[0]).toEqual({
      ...tiltedObjects[0],
      qx: expect.any(Number), qy: expect.any(Number), qz: expect.any(Number), qw: expect.any(Number),
    })
    expect(boxOn(mesh, oriented[0]!).max[2]).toBeCloseTo(0)
    expect(oriented.slice(1)).toEqual(tiltedObjects.slice(1))
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(readObjects()).toEqual(tiltedObjects)
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true })
    expect(readObjects()).toEqual(oriented)
  })

  it('auto-orients a selected group without changing an unselected copy', async () => {
    render(<Workspace initialObjects={tiltedObjects} />)
    await waitFor(() => expect(screen.getByTestId('mesh-count')).toHaveTextContent('2'))
    fireEvent.click(screen.getByRole('button', { name: 'Select group' }))
    fireEvent.click(screen.getByRole('button', { name: 'Auto-orient' }))
    const oriented = readObjects()
    for (const index of [0, 1]) {
      expect(oriented[index]).not.toEqual(tiltedObjects[index])
      expect(boxOn(mesh, oriented[index]!).max[2]).toBeCloseTo(0)
    }
    expect(oriented[2]).toEqual(tiltedObjects[2])
  })

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

  it('copies with Ctrl+C and pastes with Ctrl+V as often as pressed, and leaves Ctrl+D alone', async () => {
    render(<Workspace />)
    await waitFor(() => expect(screen.getByTestId('mesh-count')).toHaveTextContent('2'))
    fireEvent.click(screen.getByRole('button', { name: 'Select cube' }))
    expect(fireEvent.keyDown(window, { key: 'd', ctrlKey: true })).toBe(true)
    expect(readObjects()).toHaveLength(2)
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true })
    expect(readObjects()).toHaveLength(2)
    // What was copied comes back even after the original is deleted.
    fireEvent.keyDown(window, { key: 'Delete' })
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'v', ctrlKey: true })
    const pasted = readObjects().slice(1)
    expect(pasted.map((object) => object.modelId)).toEqual(['practice-cube', 'practice-cube'])
    expect(pasted.map((object) => object.id)).not.toContain('cube')
    expect(boxOn(mesh, pasted[0]!)).not.toEqual(boxOn(mesh, pasted[1]!))
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(readObjects()).toHaveLength(2)
  })

  it('leaves Ctrl+C to the browser while text on the page is selected', () => {
    render(<Workspace />)
    fireEvent.click(screen.getByRole('button', { name: 'Select cube' }))
    document.getSelection()!.selectAllChildren(screen.getByRole('button', { name: 'Select cube' }))
    expect(fireEvent.keyDown(window, { key: 'c', ctrlKey: true })).toBe(true)
    document.getSelection()!.removeAllRanges()
    expect(fireEvent.keyDown(window, { key: 'v', ctrlKey: true })).toBe(true)
    expect(readObjects()).toHaveLength(2)
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
