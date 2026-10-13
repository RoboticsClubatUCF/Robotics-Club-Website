import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { RefObject } from 'react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { CHAPTERS } from '../../components/training/chapters'
import type { ApiTerm } from '../../lib/api/api'
import type { CameraMoves } from '../../lib/slicer/camera'
import type { CameraView } from '../../lib/slicer/scene'
import { flatten } from '../../lib/training/curriculum'
import { readProgress, writeProgress } from '../../lib/training/progress'
import { stubFetch, stubFetchStatus, urlOf } from '../../test/stubFetch'
import { SlicerTrainingPage } from './SlicerTrainingPage'

/**
 * The training page around its steps: moving through them, what unlocks the next one, where it
 * keeps your place, and finishing. jsdom has no WebGL, so the 3D views are stood in for, and the
 * practice parts are a stub mesh rather than files fetched from the site.
 */

// The plate's camera without the drawing: the view keys move it with the real camera maths, as the
// stage does, and the training hears where it went.
vi.mock('../../components/slicer/PlateView', async () => {
  const { useEffect } = await import('react')
  const { PerspectiveCamera, Vector3 } = await import('three')
  const moves = await import('../../lib/slicer/camera')
  const { ViewControl } = await import('../../components/slicer/ViewControl')
  return {
    PlateView: ({
      objects,
      onView,
      camera,
    }: {
      objects: unknown[]
      onView?: (view: CameraView) => void
      camera?: RefObject<CameraMoves | null>
    }) => {
      useEffect(() => {
        const eye = new PerspectiveCamera(40, 1, 1, 5_000)
        eye.up.set(0, 0, 1)
        const target = new Vector3()
        // Where `frameBed` opens on the practice printer's 256 mm bed.
        const home = () => {
          eye.position.set(128, -268.8, 332.8)
          target.set(128, 128, 0)
        }
        const report = () => {
          eye.lookAt(target)
          onView?.({ position: eye.position.toArray(), target: target.toArray() })
        }
        home()
        report()
        const rig: CameraMoves = {
          reset: () => {
            home()
            report()
          },
          turn: (around, up) => {
            moves.turnCamera(eye.position, target, around, up)
            report()
          },
          slide: (right, up) => {
            moves.slideCamera(eye, target, right, up)
            report()
          },
          zoom: (factor) => {
            moves.zoomCamera(eye.position, target, factor)
            report()
          },
          look: (view) => {
            moves.lookFrom(eye.position, target, view)
            report()
          },
        }
        if (camera) camera.current = rig
        return () => {
          if (camera) camera.current = null
        }
      }, [camera, onView])
      return (
        <div data-testid="plate">
          {objects.length} on the plate
          <ViewControl camera={() => camera?.current} />
        </div>
      )
    },
  }
})
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

/** What the task's callout says: which goal it's on, and the goal. */
const callout = () => screen.getByRole('region', { name: 'What to do' }).textContent

// The standing mushroom's slice, numbers only. The manifest is fetched once per file, so every test
// gets the same one.
const manifest = {
  orca: '2.4.2',
  slices: {
    'mushroom-up-tree': { part: 'mushroom', at: [128, 128], overrides: {}, filament: 'pla', grams: 4.45, seconds: 955, meters: null, layers: null, preview: null },
  },
}

/** Practice slicing waits a second or so before it lands. */
const slicing = { timeout: 3_000 }

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', stubFetch({ '/training/slices.json': manifest }))
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
  it('runs a task on the practice plate and moves on to the next goal as one is met', async () => {
    startAt('try-the-screen')
    renderPage()
    expect(await screen.findByText(/1 on the plate/)).toBeInTheDocument()
    expect(heading()).toBe('TRY IT · LOOK AROUND')
    expect(callout()).toMatch(/^STEP 1 OF 4Press SLICE PLATE/)
    expect(screen.getByRole('button', { name: 'NEXT' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'SLICE PLATE' }))
    await waitFor(() => {
      expect(callout()).toBe('STEP 2 OF 4Go back to PREPARE.')
    }, slicing)
    expect(screen.getByText('Done. Next: Go back to PREPARE.')).toBeInTheDocument()
    // The slice opened PREVIEW, which mustn't count as the next goal, going back to PREPARE.
    expect(screen.getByRole('tab', { name: 'PREVIEW' })).toHaveAttribute('aria-selected', 'true')
    // Nothing on the practice plate goes near the server.
    const fetch = vi.mocked(globalThis.fetch)
    expect(fetch.mock.calls.filter((call) => urlOf(call[0]).includes('/api/'))).toHaveLength(0)
  })

  it('says why a plate with no practice slice wasn’t sliced, without calling it a failure', async () => {
    startAt('try-scale')
    renderPage()
    await screen.findByText(/1 on the plate/)

    fireEvent.click(screen.getByRole('button', { name: 'SLICE PLATE' }))
    expect(await screen.findByText(/Practice only slices the mushroom, so nothing was sliced/)).toBeInTheDocument()
    expect(screen.getByText('Not sliced yet.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(/Practice only slices the mushroom/)).not.toBeInTheDocument()
  })

  it('can be done from the keyboard, the view task included, with no way to skip it', async () => {
    startAt('try-camera')
    renderPage()
    await screen.findByText(/on the plate/)
    const next = screen.getByRole('button', { name: 'NEXT' })
    expect(next).toBeDisabled()
    expect(screen.queryByRole('button', { name: /skip/i })).not.toBeInTheDocument()

    const goalsDone = () => {
      const step = /^STEP (\d+) OF/.exec(callout() ?? '')
      return step ? Number(step[1]) - 1 : 6
    }
    const press = (key: string, target: Element = document.body, shiftKey = false) => {
      fireEvent.keyDown(target, { key, shiftKey })
    }

    // Not from a button off the plate, where a stray key shouldn't swing the view.
    press('4', screen.getByRole('button', { name: 'START OVER' }))
    expect(goalsDone()).toBe(0)
    press('4')
    await waitFor(() => expect(goalsDone()).toBe(1))
    press('1')
    await waitFor(() => expect(goalsDone()).toBe(2))
    press('2')
    await waitFor(() => expect(goalsDone()).toBe(3))
    for (let i = 0; i < 4; i++) press('i')
    await waitFor(() => expect(goalsDone()).toBe(4))
    const house = screen.getByRole('button', { name: 'Reset view' })
    for (let i = 0; i < 3; i++) press('ArrowLeft', house, true)
    await waitFor(() => expect(goalsDone()).toBe(5))
    press('0')
    await waitFor(() => {
      expect(next).toBeEnabled()
    })
    expect(callout()).toBe('DONEPress NEXT to carry on.')
    expect(readProgress('u1').done).toContain('try-camera')
  })

  it('adds a second part without modifiers and completes the placing task', async () => {
    startAt('try-placing')
    renderPage()
    await screen.findByText(/2 on the plate/)
    fireEvent.click(screen.getByRole('button', { name: 'OBJECTS · 2' }))
    fireEvent.click(screen.getByRole('button', { name: /Cube/ }))
    expect(callout()).toMatch(/SELECT SEVERAL/)
    const toggle = screen.getByRole('checkbox', { name: 'SELECT SEVERAL' })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: /Block/ }))
    expect(callout()).toMatch(/Drag the block/)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    for (let i = 0; i < 8; i++) fireEvent.keyDown(window, { key: 'ArrowUp', shiftKey: true })
    expect(callout()).toMatch(/Turn off SELECT SEVERAL/)
    fireEvent.click(screen.getByRole('button', { name: 'OBJECTS · 2' }))
    expect(screen.getByRole('checkbox', { name: 'SELECT SEVERAL' })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'SELECT SEVERAL' }))
    fireEvent.click(screen.getByRole('button', { name: /Cube/ }))
    for (const axis of ['X', 'Y']) {
      const input = screen.getByRole('spinbutton', { name: `Position ${axis}` })
      fireEvent.change(input, { target: { value: '128' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    }
    await waitFor(() => expect(screen.getByRole('button', { name: 'NEXT' })).toBeEnabled())
    expect(readProgress('u1').done).toContain('try-placing')
  })

  it('starts over on a clean plate, without counting what was done before', async () => {
    startAt('try-the-screen')
    renderPage()
    await screen.findByText(/1 on the plate/)
    fireEvent.click(screen.getByRole('button', { name: 'SLICE PLATE' }))
    await waitFor(() => {
      expect(callout()).toMatch(/^STEP 2 OF 4/)
    }, slicing)

    fireEvent.click(screen.getByRole('button', { name: 'START OVER' }))
    await screen.findByText(/1 on the plate/)
    expect(screen.getByRole('tab', { name: 'PREPARE' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Not sliced yet.')).toBeInTheDocument()
    expect(callout()).toMatch(/^STEP 1 OF 4/)
  })

  it('lets somebody who has finished move on without doing a task again', async () => {
    startAt('try-the-screen')
    renderPage(context(true))
    await screen.findByText(/1 on the plate/)
    expect(screen.getByRole('button', { name: 'NEXT' })).toBeEnabled()
    expect(callout()).toBe('DONEPress NEXT to carry on.')
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
