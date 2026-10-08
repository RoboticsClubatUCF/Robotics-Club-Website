import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { CHAPTERS } from '../../components/training/chapters'
import type { ApiTerm } from '../../lib/api/api'
import { flatten } from '../../lib/training/curriculum'
import { readProgress, writeProgress } from '../../lib/training/progress'
import { stubFetch, stubFetchStatus, urlOf } from '../../test/stubFetch'
import { SlicerTrainingPage } from './SlicerTrainingPage'

/**
 * The training page around its steps: moving through them, what unlocks the next one, where it
 * keeps your place, and finishing. jsdom has no WebGL, so the 3D views are stood in for, and the
 * practice parts are a stub mesh rather than files fetched from the site.
 */

vi.mock('../../components/slicer/PlateView', () => ({
  PlateView: ({ objects }: { objects: unknown[] }) => <div data-testid="plate">{objects.length} on the plate</div>,
}))
vi.mock('../../components/slicer/PreviewView', () => ({
  PreviewView: () => <div data-testid="preview" />,
}))
// As if the browser could draw 3D, so the goals that need the view are asked for.
vi.mock('../../lib/slicer/scene', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/slicer/scene')>()),
  webglAvailable: () => true,
}))
vi.mock('../../lib/training/practiceParts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/training/practiceParts')>()
  const { primeMesh } = await import('../../lib/slicer/meshes')
  // A single triangle stands in for every part; nothing here measures them. Primed into the mesh
  // cache, as the real loader does, so the workspace never asks the API for one.
  const mesh = Float32Array.from([0, 0, 0, 10, 0, 0, 0, 10, 0])
  const parts = Object.keys(actual.PARTS) as (keyof typeof actual.PARTS)[]
  return {
    ...actual,
    loadParts: () => {
      for (const part of parts) primeMesh(actual.modelIdOf(part), mesh)
      return Promise.resolve(new Map(parts.map((part) => [part, mesh])))
    },
  }
})

const STEPS = flatten(CHAPTERS)
const ids = STEPS.map(({ step }) => step.id)

const term: ApiTerm = {
  year: 2026,
  season: 'FALL',
  startsAt: '2026-08-24T04:00:00.000Z',
  endsAt: '2026-12-14T04:59:59.999Z',
  fromCalendar: true,
}

const context = (trained = false, reloadMembership = vi.fn(() => Promise.resolve())): DashboardContext => ({
  user: {
    id: 'u1',
    fullName: 'Rowan Test',
    email: null,
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
  membership: {
    status: 'ready',
    data: {
      status: 'ACTIVE',
      hasAccess: true,
      duesRequired: false,
      paidThrough: term.endsAt,
      freeThrough: null,
      term,
      billable: term,
      freeActive: false,
      canActivate: false,
      surveyPending: false,
      surveyPromptDismissed: false,
      slicerTrained: trained,
    },
  },
  reloadMembership,
})

const renderPage = (dashboard = context()) =>
  render(
    <MemoryRouter initialEntries={['/dashboard/profile/training']}>
      <Routes>
        <Route element={<Outlet context={dashboard} />}>
          <Route path="/dashboard/profile/training" element={<SlicerTrainingPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

/** Everything before `id` done, and the page opened on it. */
const startAt = (id: string) => {
  writeProgress('u1', { done: ids.slice(0, ids.indexOf(id)), at: id, total: ids.length })
}

const heading = () => document.querySelector('[data-step-heading]')?.textContent

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', stubFetch({ '/training/slices.json': { orca: '2.4.2', slices: {} } }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reading', () => {
  it('starts at the beginning and keeps your place as you go', () => {
    renderPage()
    expect(heading()).toBe('What a slicer does')
    expect(screen.getByRole('button', { name: 'BACK' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'NEXT' }))
    expect(heading()).toBe('How a print request works here')
    expect(readProgress('u1')).toEqual({ done: ['what-slicing-is'], at: 'how-requests-work', total: ids.length })
  })

  it('opens where you left off', () => {
    startAt('how-requests-work')
    renderPage()
    expect(heading()).toBe('How a print request works here')
  })

  it('won’t open a step past the first one not done yet', () => {
    startAt('how-requests-work')
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'CONTENTS' }))
    const contents = screen.getByRole('dialog', { name: 'Training contents' })
    expect(within(contents).getByRole('button', { name: /What a slicer does/ })).toBeEnabled()
    expect(within(contents).getByRole('button', { name: /Check: what the slicer makes/ })).toBeDisabled()
    fireEvent.click(within(contents).getByRole('button', { name: /What a slicer does/ }))
    expect(heading()).toBe('What a slicer does')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens every step to somebody who has finished', () => {
    renderPage(context(true))
    fireEvent.click(screen.getByRole('button', { name: 'CONTENTS' }))
    const contents = screen.getByRole('dialog', { name: 'Training contents' })
    expect(within(contents).getByRole('button', { name: /You’re ready/ })).toBeEnabled()
  })
})

describe('questions', () => {
  it('hold NEXT until they’re answered right, and say why a wrong answer is wrong', () => {
    startAt('check-what-slicer-makes')
    renderPage()
    const next = screen.getByRole('button', { name: 'NEXT' })
    expect(next).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /A 3D model of your part/ }))
    expect(screen.getByText(/NOT QUITE/)).toBeInTheDocument()
    expect(next).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /The list of moves/ }))
    expect(screen.getByText(/RIGHT/)).toBeInTheDocument()
    expect(next).toBeEnabled()
    expect(readProgress('u1').done).toContain('check-what-slicer-makes')
    // A right answer stays: the others can't be picked over it.
    expect(screen.getByRole('button', { name: /A 3D model of your part/ })).toBeDisabled()
  })
})

describe('practice', () => {
  it('runs a task on the practice plate and ticks a goal as it’s met', async () => {
    startAt('try-the-screen')
    renderPage()
    expect(await screen.findByText(/1 on the plate/)).toBeInTheDocument()
    expect(heading()).toBe('TRY IT · LOOK AROUND')
    expect(screen.getByRole('button', { name: 'NEXT' })).toBeDisabled()

    fireEvent.click(screen.getByRole('tab', { name: 'PREVIEW' }))
    await waitFor(() => {
      expect(within(screen.getByRole('list', { name: 'Goals' })).getAllByText('Done.')).toHaveLength(1)
    })
    // Nothing on the practice plate goes near the server.
    const fetch = vi.mocked(globalThis.fetch)
    expect(fetch.mock.calls.filter((call) => urlOf(call[0]).includes('/api/'))).toHaveLength(0)
  })

  it('lets somebody without a mouse or touch screen past the goals that need one', async () => {
    startAt('try-camera')
    renderPage()
    await screen.findByText(/on the plate/)
    expect(screen.getByRole('button', { name: 'NEXT' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /No mouse or touch screen/ }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'NEXT' })).toBeEnabled()
    })
    expect(readProgress('u1').done).toContain('try-camera')
  })

  it('starts over on a clean plate, without counting what was done before', async () => {
    startAt('try-the-screen')
    renderPage()
    await screen.findByText(/1 on the plate/)
    fireEvent.click(screen.getByRole('tab', { name: 'PREVIEW' }))
    await waitFor(() => {
      expect(within(screen.getByRole('list', { name: 'Goals' })).getAllByText('Done.')).toHaveLength(1)
    })

    fireEvent.click(screen.getByRole('button', { name: 'START OVER' }))
    await screen.findByText(/1 on the plate/)
    expect(screen.getByRole('tab', { name: 'PREPARE' })).toHaveAttribute('aria-selected', 'true')
    expect(within(screen.getByRole('list', { name: 'Goals' })).queryAllByText('Done.')).toHaveLength(0)
  })

  it('lets somebody who has finished move on without doing a task again', async () => {
    startAt('try-the-screen')
    renderPage(context(true))
    await screen.findByText(/1 on the plate/)
    expect(screen.getByRole('button', { name: 'NEXT' })).toBeEnabled()
  })
})

describe('finishing', () => {
  it('records it on the server and reloads the standing', async () => {
    startAt('finish')
    const reload = vi.fn(() => Promise.resolve())
    const fetch = stubFetch({ '/print/training': { trainedAt: '2026-10-08T12:00:00.000Z' } })
    vi.stubGlobal('fetch', fetch)
    renderPage(context(false, reload))

    fireEvent.click(screen.getByRole('button', { name: 'FINISH THE TRAINING' }))
    await waitFor(() => {
      expect(reload).toHaveBeenCalled()
    })
    const call = fetch.mock.calls.find((c) => urlOf(c[0]).includes('/print/training'))
    expect(call?.[1]?.method).toBe('POST')
    expect(readProgress('u1').done).toContain('finish')
  })

  it('says so when the server can’t be reached', async () => {
    startAt('finish')
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'FINISH THE TRAINING' }))
    expect(await screen.findByText(/Couldn't reach the server/)).toBeInTheDocument()
  })

  it('shows the server’s reason when it refuses', async () => {
    startAt('finish')
    vi.stubGlobal('fetch', stubFetchStatus(429, { error: 'Too many requests. Try again shortly.' }))
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'FINISH THE TRAINING' }))
    expect(await screen.findByText('Too many requests. Try again shortly.')).toBeInTheDocument()
  })

  it('offers the slicer once it’s done', () => {
    startAt('finish')
    renderPage(context(true))
    expect(screen.getByRole('link', { name: 'OPEN THE SLICER' })).toHaveAttribute('href', '/dashboard/print/slicer')
  })
})
