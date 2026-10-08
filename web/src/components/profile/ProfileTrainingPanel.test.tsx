import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ApiMembership } from '../../lib/api/api'
import type { ApiState } from '../../lib/api/useApi'
import { writeProgress } from '../../lib/training/progress'
import { ProfileTrainingPanel } from './ProfileTrainingPanel'

const standing = (slicerTrained: boolean): ApiState<ApiMembership> => ({
  status: 'ready',
  data: { slicerTrained } as ApiMembership,
})

const renderPanel = (membership: ApiState<ApiMembership>) =>
  render(
    <MemoryRouter>
      <ProfileTrainingPanel userId="u1" membership={membership} />
    </MemoryRouter>,
  )

beforeEach(() => {
  localStorage.clear()
})

describe('the slicer training panel', () => {
  it('holds its place while the standing loads', () => {
    renderPanel({ status: 'loading' })
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('offers the training to somebody who hasn’t started', () => {
    renderPanel(standing(false))
    expect(screen.getByRole('link', { name: 'START THE TRAINING' })).toHaveAttribute('href', '/dashboard/profile/training')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('says how far along somebody is', () => {
    writeProgress('u1', { done: ['a', 'b', 'c'], at: 'd', total: 54 })
    renderPanel(standing(false))
    expect(screen.getByText('3 of 54 steps done in this browser.')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3')
    expect(screen.getByRole('link', { name: 'CONTINUE' })).toBeInTheDocument()
  })

  it('offers a look back once it’s done', () => {
    renderPanel(standing(true))
    expect(screen.getByText('Done. The slicer is open to you.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'REVIEW IT' })).toHaveAttribute('href', '/dashboard/profile/training')
  })

  it('still offers the training when the standing didn’t load', () => {
    renderPanel({ status: 'error', code: 0 })
    expect(screen.getByRole('link', { name: 'START THE TRAINING' })).toBeInTheDocument()
  })
})
