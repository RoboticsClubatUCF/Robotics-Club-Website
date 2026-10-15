import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { RefObject } from 'react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { CHAPTERS } from '../../components/training/chapters'
import type { ApiTerm } from '../../lib/api/api'
import type { CameraMoves } from '../../lib/slicer/camera'
import type { Preview } from '../../lib/slicer/preview'
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
// The preview without the drawing: just its layer slider, which reports to the training as the
// real one does.
vi.mock('../../components/slicer/PreviewView', async () => {
  const { useEffect, useEffectEvent, useState } = await import('react')
  return {
    PreviewView: ({
      preview,
      onExplore,
    }: {
      preview: Preview
      onExplore?: (layers: { top: number; count: number; z: number; hidden: [] }) => void
    }) => {
      const [top, setTop] = useState(preview.layers.length - 1)
      const report = useEffectEvent(() => {
        onExplore?.({ top, count: preview.layers.length, z: preview.layers[top]?.z ?? 0, hidden: [] })
      })
      useEffect(() => {
        report()
      }, [top, preview])
      return (
        <input
          type="range"
          aria-label="Top layer shown"
          min={0}
          max={preview.layers.length - 1}
          value={top}
          onChange={(event) => {
            setTop(Number(event.target.value))
          }}
        />
      )
    },
  }
})
// Every practice preview is 60 layers of nothing; the files themselves are tested in practice.test.ts.
vi.mock('../../lib/slicer/usePreview', async (importOriginal) => {
  const { ROLES } = await import('../../lib/slicer/preview')
  return {
    ...(await importOriginal<typeof import('../../lib/slicer/usePreview')>()),
    decodePreview: () =>
      Promise.resolve({
        bed: { width: 256, depth: 256, height: 256 },
        layers: Array.from({ length: 60 }, (_, i) => ({ z: (i + 1) * 0.2, height: 0.2 })),
        segments: 0,
        bounds: { min: [113, 113, 0], max: [143, 143, 12] },
        filament: null,
        roles: Object.fromEntries(
          ROLES.map((role) => [role, { segments: new Float32Array(0), layerStart: new Uint32Array(61) }]),
        ) as Preview['roles'],
      } satisfies Preview),
  }
})
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

// The mushroom both ways up and the block for the strength task. The manifest is fetched once per
// file, so every test gets the same one.
const made = (name: string, part: string, overrides: Record<string, number | string>, grams: number, turn = [0, 0, 0, 1]) => [
  name,
  {
    part,
    at: [128, 128],
    turn,
    overrides,
    process: '0.20mm, 0.4 nozzle, Line, T-Support',
    filament: 'Elegoo Rapid PLA',
    grams,
    seconds: 600,
    meters: null,
    layers: 60,
    preview: `slices/${name}.rcpv`,
  },
]
const manifest = {
  orca: '2.4.2',
  slices: Object.fromEntries([
    made('mushroom-up-tree', 'mushroom', {}, 4.45),
    made('mushroom-down', 'mushroom', {}, 2.94, [1, 0, 0, 0]),
    made('block-standard', 'block', {}, 4.76),
    made('block-walls-5', 'block', { wall_loops: 5 }, 6.1),
    made('block-infill-40', 'block', { sparse_infill_density: 40 }, 7.28),
    made('block-infill-40-gyroid', 'block', { sparse_infill_density: 40, sparse_infill_pattern: 'gyroid' }, 7.02),
    made(
      'block-infill-40-gyroid-concentric',
      'block',
      { sparse_infill_density: 40, sparse_infill_pattern: 'gyroid', top_surface_pattern: 'concentric' },
      7.02,
    ),
  ]),
}

/** Practice slicing waits a second or so before it lands. */
const slicing = { timeout: 3_000 }

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', stubFetch({ '/training/slices.json': manifest, '/training/slices/': {} }))
})

/** Presses SLICE PLATE, waits for the preview, and moves its slider to `layer` if there is one. */
async function sliceAndLook(layer?: number) {
  fireEvent.click(screen.getByRole('button', { name: 'SLICE PLATE' }))
  await waitFor(() => expect(screen.queryByRole('slider', { name: 'Top layer shown' })).not.toBeInTheDocument())
  const slider = await screen.findByRole('slider', { name: 'Top layer shown' }, slicing)
  if (layer !== undefined) fireEvent.change(slider, { target: { value: String(layer) } })
}

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
    expect(await screen.findByText(/Practice only slices the mushroom and block, so nothing was sliced/)).toBeInTheDocument()
    expect(screen.getByText('Not sliced yet.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(/Practice only slices/)).not.toBeInTheDocument()
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
    const toggle = screen.getByRole('switch', { name: 'SELECT SEVERAL' })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: /Block/ }))
    expect(callout()).toMatch(/Drag the block/)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    for (let i = 0; i < 8; i++) fireEvent.keyDown(window, { key: 'ArrowUp', shiftKey: true })
    expect(callout()).toMatch(/Turn off SELECT SEVERAL/)
    fireEvent.click(screen.getByRole('button', { name: 'OBJECTS · 2' }))
    expect(screen.getByRole('switch', { name: 'SELECT SEVERAL' })).toBeChecked()
    fireEvent.click(screen.getByRole('switch', { name: 'SELECT SEVERAL' }))
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

  it('keeps REQUEST PRINT disabled outside the sending module, even after a successful slice', async () => {
    startAt('try-the-screen')
    renderPage()
    await screen.findByText(/1 on the plate/)
    fireEvent.click(screen.getByRole('button', { name: 'SLICE PLATE' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'PREVIEW' })).toHaveAttribute('aria-selected', 'true'), slicing)
    const request = screen.getByRole('button', { name: 'REQUEST PRINT' })
    expect(request).toBeDisabled()
    fireEvent.click(request)
    expect(screen.queryByRole('dialog', { name: 'Send this plate to the officers?' })).not.toBeInTheDocument()
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('allows the sending module to finish with a browser-only practice request', async () => {
    startAt('try-send')
    renderPage()
    await screen.findByText(/1 on the plate/)
    const request = screen.getByRole('button', { name: 'REQUEST PRINT' })
    expect(request).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'SLICE PLATE' }))
    await waitFor(() => expect(request).toBeEnabled(), slicing)
    fireEvent.click(request)
    expect(screen.getByRole('dialog', { name: 'Send this plate to the officers?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'SEND IT' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'NEXT' })).toBeEnabled())
    expect(screen.getByRole('status', { name: 'Plate status' })).toHaveTextContent('nothing was sent')
    expect(readProgress('u1').done).toContain('try-send')
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('lets somebody who has finished move on without doing a task again', async () => {
    startAt('try-the-screen')
    renderPage(context(true))
    await screen.findByText(/1 on the plate/)
    expect(screen.getByRole('button', { name: 'NEXT' })).toBeEnabled()
    expect(callout()).toBe('DONEPress NEXT to carry on.')
  })

  it.each([false, true])('resets only a completed task, persists the reset and lets it be finished again (trained=%s)', async (trained) => {
    writeProgress('u1', { done: ids, at: 'try-strength', total: ids.length })
    const page = renderPage(context(trained))
    await screen.findByText(/1 on the plate/)
    expect(screen.getByRole('button', { name: 'NEXT' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'START OVER' }))
    expect(callout()).toMatch(/^STEP 1 OF 5Press SLICE PLATE, then drag the layer slider halfway down/)
    expect(screen.getByRole('button', { name: 'NEXT' })).toBeDisabled()
    await waitFor(() => expect(readProgress('u1').done).toEqual(ids.filter((id) => id !== 'try-strength')))
    expect(readProgress('u1').restarted).toEqual(['try-strength'])
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(ids.length - 1))
    fireEvent.click(screen.getByRole('button', { name: 'CONTENTS' }))
    expect(within(screen.getByRole('dialog', { name: 'Training contents' })).getByRole('button', { name: /Check: a part that snaps/ })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'CLOSE' }))

    page.unmount()
    const resumed = renderPage(context(trained))
    await screen.findByText(/1 on the plate/)
    expect(callout()).toMatch(/^STEP 1 OF 5/)
    expect(screen.getByRole('button', { name: 'NEXT' })).toBeDisabled()
    const type = (name: string, value: string) => {
      const input = screen.getByRole('spinbutton', { name })
      fireEvent.change(input, { target: { value } })
      fireEvent.keyDown(input, { key: 'Enter' })
    }
    // Each step is a slice; looking inside means the slider about halfway down.
    await sliceAndLook(30)
    await waitFor(() => expect(callout()).toMatch(/^STEP 2 OF 5Set Walls to 5/))
    // Looking at the slice before doesn't count for the next one.
    fireEvent.click(screen.getByRole('button', { name: 'SETTINGS' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Strength' }))
    type('Walls', '5')
    await sliceAndLook()
    expect(callout()).toMatch(/^STEP 2 OF 5/)
    fireEvent.change(screen.getByRole('slider', { name: 'Top layer shown' }), { target: { value: '30' } })
    await waitFor(() => expect(callout()).toMatch(/^STEP 3 OF 5/))
    type('Walls', '2')
    type('Infill density', '40')
    await sliceAndLook(30)
    await waitFor(() => expect(callout()).toMatch(/^STEP 4 OF 5/))
    fireEvent.change(screen.getByRole('combobox', { name: 'Infill pattern' }), { target: { value: 'gyroid' } })
    await sliceAndLook(30)
    await waitFor(() => expect(callout()).toMatch(/^STEP 5 OF 5/))
    fireEvent.change(screen.getByRole('combobox', { name: 'Top surface pattern' }), { target: { value: 'concentric' } })
    await sliceAndLook()
    await waitFor(() => expect(screen.getByRole('button', { name: 'NEXT' })).toBeEnabled())
    const log = within(screen.getByRole('region', { name: 'YOUR SLICES' }))
    expect(log.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringMatching(/^1 As it is · 4\.76 g/),
      expect.stringMatching(/^2 Walls: 5 · 6\.10 g \(\+1\.34\)/),
      expect.stringMatching(/^3 Walls: 2, Infill density: 40% · 7\.28 g/),
      expect.stringMatching(/^4 Infill pattern: Gyroid · 7\.02 g \(−0\.26\)/),
      expect.stringMatching(/^5 Top surface pattern: Concentric · 7\.02 g · 10 min · 60 layers$/),
    ])
    // DONE shows after several slices too, even where it covers part of the log.
    expect(callout()).toBe('DONECompare your slices, then press NEXT.')
    await waitFor(() => expect(readProgress('u1').done).toContain('try-strength'))
    expect(new Set(readProgress('u1').done)).toEqual(new Set(ids))
    expect(readProgress('u1').restarted).toBeUndefined()

    resumed.unmount()
    renderPage(context(trained))
    await screen.findByText(/1 on the plate/)
    expect(callout()).toBe('DONEPress NEXT to carry on.')
    // Five practice slices of a second or so each.
  }, 20_000)

  it('keeps an explicitly restarted task incomplete even when training completion supplied its original DONE state', async () => {
    startAt('try-strength')
    const page = renderPage(context(true))
    await screen.findByText(/1 on the plate/)
    expect(screen.getByRole('button', { name: 'NEXT' })).toBeEnabled()
    const previous = readProgress('u1').done
    fireEvent.click(screen.getByRole('button', { name: 'START OVER' }))
    expect(screen.getByRole('button', { name: 'NEXT' })).toBeDisabled()
    await waitFor(() => expect(readProgress('u1').restarted).toEqual(['try-strength']))
    expect(readProgress('u1').done).toEqual(previous)
    page.unmount()
    renderPage(context(true))
    await screen.findByText(/1 on the plate/)
    expect(callout()).toMatch(/^STEP 1 OF 5/)
    expect(screen.getByRole('button', { name: 'NEXT' })).toBeDisabled()
  })

  it('keeps the step somebody had reached open after they start an earlier task over', async () => {
    const reached = ids.indexOf('check-strength')
    writeProgress('u1', { done: ids.slice(0, reached), at: 'try-strength', total: ids.length })
    renderPage()
    await screen.findByText(/1 on the plate/)
    fireEvent.click(screen.getByRole('button', { name: 'START OVER' }))
    await waitFor(() => expect(readProgress('u1').restarted).toEqual(['try-strength']))

    fireEvent.click(screen.getByRole('button', { name: 'CONTENTS' }))
    const contents = screen.getByRole('dialog', { name: 'Training contents' })
    expect(within(contents).getByRole('button', { name: /Check: a part that snaps/ })).toBeEnabled()
    expect(within(contents).getByRole('button', { name: /The rest of the Others tab/ })).toBeDisabled()
    // Finishing still waits for the task to be done again.
    expect(within(contents).getByRole('button', { name: /You’re ready/ })).toBeDisabled()
  })

  it('reopens a saved restart before membership has loaded, even with no other local progress', async () => {
    writeProgress('u1', { done: [], at: 'try-strength', total: ids.length, restarted: ['try-strength'] })
    renderPage({ ...context(true), membership: { status: 'loading' } })
    await waitFor(() => expect(heading()).toBe('TRY IT · STRENGTH SETTINGS'))
    expect(callout()).toMatch(/^STEP 1 OF 5/)
    expect(screen.getByRole('button', { name: 'NEXT' })).toBeDisabled()
    expect(readProgress('u1').at).toBe('try-strength')
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
    // Progress is stored by an effect after the render, which can land after `reload` is called.
    await waitFor(() => {
      expect(reload).toHaveBeenCalled()
      expect(readProgress('u1').done).toContain('finish')
    })
    const call = fetch.mock.calls.find((c) => urlOf(c[0]).includes('/print/training'))
    expect(call?.[1]?.method).toBe('POST')
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
