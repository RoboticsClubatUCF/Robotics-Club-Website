import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { ApiDraftSlice } from '../../lib/api/api'
import { PRACTICE_WORKSPACE } from '../../lib/training/practiceProfiles'
import { usePracticePlate } from '../../lib/training/usePracticePlate'
import { WorkspaceView } from './SlicerWorkspace'

vi.mock('./PlateView', () => ({ PlateView: () => <div /> }))

const slice: ApiDraftSlice = {
  state: 'READY', current: true, failure: null, retryable: false,
  estimatedGrams: 4, estimatedSeconds: 800, filamentMeters: null, layerCount: 60,
  hasPreview: false, previewFailure: null, requestedAt: '2026-10-13T00:00:00Z',
}

function ReadyWorkspace({ canSubmit }: { canSubmit?: boolean }) {
  const practice = usePracticePlate(null, true)
  return <MemoryRouter><WorkspaceView plateKey="practice" plate={{
    ...practice.source, canSubmit, draft: { ...practice.source.draft!, slice },
  }} preview={{ status: 'none' }} workspace={PRACTICE_WORKSPACE} projects={[]} allowance={null} onSent={vi.fn()} /></MemoryRouter>
}

describe('REQUEST PRINT availability', () => {
  it('blocks a current ready slice when the plate disables requests, on both tabs', () => {
    render(<ReadyWorkspace canSubmit={false} />)
    const request = screen.getByRole('button', { name: 'REQUEST PRINT' })
    expect(request).toBeDisabled()
    fireEvent.click(request)
    expect(screen.queryByRole('dialog', { name: 'Send this plate to the officers?' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'PREVIEW' }))
    expect(request).toBeDisabled()
  })

  it('keeps the normal request flow available when no training restriction is set', () => {
    render(<ReadyWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: 'REQUEST PRINT' }))
    expect(screen.getByRole('dialog', { name: 'Send this plate to the officers?' })).toBeInTheDocument()
  })

  it('warns in the request dialog that a practice plate is never submitted', () => {
    render(<ReadyWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: 'REQUEST PRINT' }))
    const dialog = screen.getByRole('dialog', { name: 'Send this plate to the officers?' })
    expect(within(dialog).getByText('Practice only. Nothing will actually be submitted or printed.')).toHaveClass('text-error')
  })
})
