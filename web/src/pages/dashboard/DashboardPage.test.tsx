import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DashboardPage } from './DashboardPage'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import type { ApiProject } from '../../lib/api/api'
import { stubFetch } from '../../test/stubFetch'

/**
 * The overview's own behaviour. The panels it borrows (the lab, the calendar, dues) have suites
 * of their own; their reads are answered empty here or left to fail quietly.
 */

const context = (): DashboardContext => ({
  user: {
    id: 'u1',
    fullName: 'Rowan Test',
    email: 'rowan@ucf.edu',
    slug: null,
    role: 'MEMBER',
    discordUsername: null,
    photoUrl: null,
    photoFocalX: 50,
    photoFocalY: 50,
    photoZoom: 1,
  },
  projects: { status: 'ready', data: [] },
  reloadProjects: () => Promise.resolve(),
  membership: { status: 'loading' },
  reloadMembership: () => Promise.resolve(),
})

const project = (n: number) =>
  ({
    id: `p${String(n)}`,
    slug: `build-${String(n)}`,
    title: `Build ${String(n)}`,
    summary: `What build ${String(n)} is.`,
  }) as ApiProject

const renderPage = () =>
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={context()} />}>
          <Route path="/" element={<DashboardPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('OPEN PROJECTS', () => {
  it('shows the first five and keeps the rest behind a press', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      stubFetch({
        'status=IN_PROGRESS': [1, 2, 3, 4, 5, 6, 7].map(project),
        '/me/events': [],
      }),
    )

    renderPage()

    const more = await screen.findByRole('button', { name: 'SHOW ALL 7' })
    expect(screen.getByRole('link', { name: 'Build 5' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Build 6' })).not.toBeInTheDocument()
    expect(more).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(more)

    expect(screen.getByRole('link', { name: 'Build 7' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SHOW FEWER' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('offers no button when everything fits', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      stubFetch({
        'status=IN_PROGRESS': [1, 2, 3].map(project),
        '/me/events': [],
      }),
    )

    renderPage()

    expect(await screen.findByRole('link', { name: 'Build 3' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /SHOW ALL/ })).not.toBeInTheDocument()
  })
})
