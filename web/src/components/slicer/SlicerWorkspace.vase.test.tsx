import { fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useEffectEvent } from 'react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { primeMesh } from '../../lib/slicer/meshes'
import { PRACTICE_WORKSPACE } from '../../lib/training/practiceProfiles'
import { modelIdOf, placed } from '../../lib/training/practiceParts'
import { usePracticePlate } from '../../lib/training/usePracticePlate'
import { WorkspaceView } from './SlicerWorkspace'

vi.mock('./PlateView', () => ({ PlateView: () => <div /> }))

const mesh = Float32Array.from([0, 0, 0, 20, 0, 0, 0, 20, 0])

function Workspace({ copies }: { copies: number }) {
  const practice = usePracticePlate(new Map([['tower', mesh]]))
  const setUp = useEffectEvent(() => {
    practice.setUp(Array.from({ length: copies }, (_, i) => placed('tower', `tower-${String(i)}`, 60 + i * 60, 128)))
  })
  useEffect(() => {
    primeMesh(modelIdOf('tower'), mesh)
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
const sliceButton = () => screen.getByRole('button', { name: 'SLICE PLATE' })
const toggle = (tab: string, name: string) => {
  fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${tab}`) }))
  fireEvent.click(screen.getByRole('switch', { name }))
}

// The worker and the SLICE route refuse the same plates; the workspace says so before slicing.
describe('vase mode', () => {
  it('keeps SLICE PLATE off while the process’s supports are on, and says to switch them off', () => {
    render(<Workspace copies={1} />)
    expect(sliceButton()).toBeEnabled()
    toggle('Others', 'Vase mode')
    expect(sliceButton()).toBeDisabled()
    expect(status()).toHaveTextContent("Vase mode can't have supports. Switch Supports off in the Support tab")
    toggle('Support', 'Supports')
    expect(sliceButton()).toBeEnabled()
  })

  it('names the walls, infill or top a member changed, since vase mode prints one wall and no more', () => {
    render(<Workspace copies={1} />)
    toggle('Support', 'Supports')
    toggle('Others', 'Vase mode')
    fireEvent.click(screen.getByRole('tab', { name: /^Strength/ }))
    const walls = screen.getByRole('spinbutton', { name: 'Walls' })
    fireEvent.change(walls, { target: { value: '4' } })
    fireEvent.keyDown(walls, { key: 'Enter' })
    expect(sliceButton()).toBeDisabled()
    expect(status()).toHaveTextContent('Reset Walls, or turn Vase mode off.')
    fireEvent.change(walls, { target: { value: '1' } })
    fireEvent.keyDown(walls, { key: 'Enter' })
    expect(sliceButton()).toBeEnabled()
  })

  it('says one object at a time before anything else', () => {
    render(<Workspace copies={2} />)
    toggle('Others', 'Vase mode')
    expect(sliceButton()).toBeDisabled()
    expect(status()).toHaveTextContent('Vase mode prints one object at a time.')
  })
})
