import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiMembership, ApiTraining } from '../../lib/api/api'
import type { ApiState } from '../../lib/api/useApi'
import { OPTIONAL_CHAPTERS, REQUIRED_CHAPTERS } from '../../lib/slicer/trainingChapters'
import { stubFetch, stubFetchNetworkError } from '../../test/stubFetch'
import { ProfileTrainingPanel } from './ProfileTrainingPanel'

const standing = (slicerTrained: boolean): ApiState<ApiMembership> => ({
  status: 'ready',
  data: { slicerTrained } as ApiMembership,
})

const record = (over: Partial<ApiTraining> = {}): ApiTraining => ({
  steps: [],
  at: null,
  restarted: [],
  chapters: [],
  trainedAt: null,
  ...over,
})

const renderPanel = (membership: ApiState<ApiMembership>, training: ApiTraining | 'unreachable' = record()) => {
  vi.stubGlobal('fetch', training === 'unreachable' ? stubFetchNetworkError() : stubFetch({ '/print/training': training }))
  return render(
    <MemoryRouter>
      <ProfileTrainingPanel membership={membership} />
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the slicer training panel', () => {
  it('holds its place while the standing loads', () => {
    renderPanel({ status: 'loading' })
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('holds its button while the training’s record loads, so the word doesn’t change under the pointer', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    render(
      <MemoryRouter>
        <ProfileTrainingPanel membership={standing(true)} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('offers the training to somebody who hasn’t started', async () => {
    renderPanel(standing(false))
    expect(await screen.findByRole('link', { name: 'START THE TRAINING' })).toHaveAttribute(
      'href',
      '/dashboard/profile/training',
    )
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('says how far along somebody is, from any device', async () => {
    renderPanel(standing(false), record({ steps: ['a', 'b', 'c'], at: 'd', chapters: ['basics', 'screen', 'camera'] }))
    expect(await screen.findByText(`3 of ${String(REQUIRED_CHAPTERS.length)} chapters done.`)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3')
    expect(screen.getByRole('link', { name: 'CONTINUE' })).toBeInTheDocument()
  })

  it('offers the optional chapters once it’s done', async () => {
    renderPanel(standing(true), record({ chapters: [...REQUIRED_CHAPTERS, 'adhesion'] }))
    expect(await screen.findByText('Done. The slicer is open to you.')).toBeInTheDocument()
    expect(
      await screen.findByText(`1 of ${String(OPTIONAL_CHAPTERS.length)} optional chapters done. Each unlocks more settings.`),
    ).toBeInTheDocument()
    // The list of optional chapters, not wherever they last were.
    expect(screen.getByRole('link', { name: 'MORE SETTINGS' })).toHaveAttribute(
      'href',
      '/dashboard/profile/training?chapter=finish',
    )
  })

  it('offers a look back once every setting is unlocked', async () => {
    renderPanel(standing(true), record({ chapters: [...REQUIRED_CHAPTERS, ...OPTIONAL_CHAPTERS] }))
    expect(await screen.findByText('Every setting is unlocked.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'REVIEW IT' })).toBeInTheDocument()
  })

  it('still offers the way in when neither the standing nor the training loaded', async () => {
    renderPanel({ status: 'error', code: 0 }, 'unreachable')
    expect(await screen.findByRole('link', { name: 'START THE TRAINING' })).toBeInTheDocument()
    expect(screen.queryByText(/chapters done/)).not.toBeInTheDocument()
  })
})
