import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PrintSlicerPage } from './PrintSlicerPage'
import type {
  ApiDraft,
  ApiDraftSlice,
  ApiPlateObject,
  ApiPrintAllowance,
  ApiSlicerWorkspace,
  ApiTerm,
} from '../../lib/api/api'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { bodyOf, stubFetch, urlOf } from '../../test/stubFetch'
import { OPTIONAL_CHAPTERS, REQUIRED_CHAPTERS } from '../../lib/slicer/trainingChapters'

/**
 * The slicer workspace, with the 3D views stood in for: jsdom has no WebGL, and what's under test
 * is the page around them — loading, the plate's state, SLICE PLATE and REQUEST PRINT, and what the server is
 * sent. The views' maths has its own tests in `lib/slicer`.
 */

vi.mock('../../components/slicer/PlateView', () => ({
  PlateView: ({ objects }: { objects: unknown[] }) => (
    <div data-testid="plate">{objects.length} on the plate</div>
  ),
}))
vi.mock('../../components/slicer/PreviewView', () => ({
  PreviewView: () => <div data-testid="preview" />,
}))

const term: ApiTerm = {
  year: 2026,
  season: 'FALL',
  startsAt: '2026-08-24T04:00:00.000Z',
  endsAt: '2026-12-14T04:59:59.999Z',
  fromCalendar: true,
}

const values = {
  layer_height: 0.2,
  initial_layer_print_height: 0.2,
  wall_generator: 'classic',
  seam_position: 'aligned',
  ironing_type: 'no ironing',
  wall_loops: 2,
  top_shell_layers: 5,
  top_shell_thickness: 1,
  bottom_shell_layers: 3,
  bottom_shell_thickness: 0.6,
  sparse_infill_density: 15,
  sparse_infill_pattern: 'line',
  top_surface_pattern: 'monotonicline',
  bottom_surface_pattern: 'monotonic',
  enable_support: true,
  support_type: 'tree(auto)',
  support_threshold_angle: 30,
  support_on_build_plate_only: false,
  raft_layers: 0,
  brim_type: 'no_brim',
  brim_width: 5,
  skirt_loops: 0,
  spiral_mode: false,
  fuzzy_skin: 'disabled_fuzzy',
}

const workspace = (over: Partial<ApiSlicerWorkspace> = {}): ApiSlicerWorkspace => ({
  profiles: {
    printers: [
      {
        id: 'cc1',
        label: 'CC1',
        name: 'CC1',
        description: null,
        model: 'Elegoo Centauri Carbon',
        nozzle: 0.4,
        bedType: 'Textured PEI Plate',
        bed: { width: 256, depth: 256, height: 256, exclude: { minX: 246, minY: 0, maxX: 256, maxY: 20 } },
        layerHeight: { min: 0.08, max: 0.28 },
        processes: [
          { id: 'std', label: 'Standard', name: '0.20mm, 0.4 nozzle, Line, T-Support', description: '2 walls, 15% line', values },
          { id: 'q', label: 'Q', name: '0.20mm, Q, 0.4 nozzle, Line, T-Support', description: '3 walls, 10% gyroid', values: { ...values, wall_loops: 3 } },
          { id: 'qs', label: 'Q-S', name: '0.20mm, Q-S, 0.4 nozzle, Line, T-Support', description: '6 walls, 6% 3d honeycomb', values: { ...values, wall_loops: 6 } },
        ],
      },
    ],
    filaments: [
      { id: 'pla', label: 'PLA', name: 'Elegoo Rapid PLA', description: null, type: 'PLA', printers: ['cc1'] },
      { id: 'petg', label: 'PETG', name: 'Elegoo RAPID PETG Optimized', description: null, type: 'PETG', printers: ['cc1'] },
    ],
  },
  workerOnline: true,
  chapters: [...REQUIRED_CHAPTERS, ...OPTIONAL_CHAPTERS],
  limits: { drafts: 3, models: 10, objects: 50, fileMb: 30, slicesPerHour: 20 },
  ...over,
})

const allowance: ApiPrintAllowance = { limitGrams: 500, usedGrams: 480, remainingGrams: 20, term }

const readySlice = (over: Partial<ApiDraftSlice> = {}): ApiDraftSlice => ({
  state: 'READY',
  current: true,
  failure: null,
  retryable: false,
  estimatedGrams: 36.2,
  estimatedSeconds: 8_040,
  filamentMeters: 12.1,
  layerCount: 100,
  hasPreview: false,
  previewFailure: 'The plate is too detailed to preview.',
  requestedAt: '2026-09-01T12:00:00.000Z',
  ...over,
})

const draft = (over: Partial<ApiDraft> = {}): ApiDraft => ({
  id: 'd1',
  status: 'DRAFT',
  revision: 3,
  printerId: 'cc1',
  processId: 'std',
  filamentId: 'pla',
  slicedWith: { printer: 'CC1', process: 'Standard', filament: 'PLA' },
  overrides: {},
  fileName: 'bracket.stl',
  notes: null,
  projectId: null,
  createdAt: '2026-09-01T12:00:00.000Z',
  draftActiveAt: '2026-09-01T12:00:00.000Z',
  submittedAt: null,
  startedAt: null,
  expiresAt: '2026-09-03T12:00:00.000Z',
  models: [{ id: 'm1', fileName: 'bracket.stl', fileSize: 684, meshState: 'READY', meshFailure: null, triangles: 12 }],
  objects: [
    { id: 'o1', modelId: 'm1', name: 'bracket', x: 128, y: 128, qx: 0, qy: 0, qz: 0, qw: 1, sx: 1, sy: 1, sz: 1 },
  ],
  slice: null,
  ...over,
})

const context = (trained = true): DashboardContext => ({
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
  reloadMembership: () => Promise.resolve(),
})

const renderAt = (path: string, trained = true) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Outlet context={context(trained)} />}>
          <Route path="/dashboard/print/slicer" element={<PrintSlicerPage />} />
          <Route path="/dashboard/print/slicer/:id" element={<PrintSlicerPage />} />
          <Route path="/dashboard/print" element={<p>the printing page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the training', () => {
  it('sends somebody who hasn’t done it to the training, and asks the server nothing', () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    renderAt('/dashboard/print/slicer', false)

    expect(screen.getByRole('heading', { name: 'Do the slicer training first.' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'START THE TRAINING' })).toHaveAttribute('href', '/dashboard/profile/training')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('says what the server said when it refuses anyway', async () => {
    const said = 'Finish the slicer training on your profile page first.'
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: said }), { status: 403 }))),
    )
    renderAt('/dashboard/print/slicer')
    expect(await screen.findByText(said)).toBeInTheDocument()
  })
})

describe('loading', () => {
  it('says why when the slicer is unavailable', async () => {
    const said = 'The slicer has no printers or filaments set up yet. Ask an officer.'
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: said }), { status: 503 }))),
    )
    renderAt('/dashboard/print/slicer')
    expect(await screen.findByText(said)).toBeInTheDocument()
  })

  it('says it is unavailable when the server gives no reason', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 503 }))))
    renderAt('/dashboard/print/slicer')
    expect(await screen.findByText(/slicer is unavailable right now/i)).toBeInTheDocument()
  })

  it('names a plate that no longer exists', async () => {
    const routes = { '/print/workspace': workspace(), '/me/print-allowance': allowance }
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) =>
        urlOf(input).includes('/print/drafts/gone')
          ? Promise.resolve(new Response('{}', { status: 404 }))
          : stubFetch(routes)(input, init),
      ),
    )
    renderAt('/dashboard/print/slicer/gone')
    expect(await screen.findByText(/no such plate/i)).toBeInTheDocument()
  })
})

describe('a new plate', () => {
  it('asks for a model, and offers nothing to slice yet', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/print/workspace': workspace(), '/me/print-allowance': allowance }))
    renderAt('/dashboard/print/slicer')

    expect(await screen.findByText(/drop an stl or step file here/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SLICE PLATE' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'REQUEST PRINT' })).toBeDisabled()
    expect(screen.getByText('CC1')).toBeInTheDocument()
  })
})

describe('a plate in progress', () => {
  it('shows the plate and slices it with the revision it saw', async () => {
    const fetchStub = stubFetch({
      '/print/workspace': workspace(),
      '/me/print-allowance': allowance,
      '/print/drafts/d1/slice': draft({ slice: { ...readySlice(), state: 'QUEUED' } }),
      '/print/drafts/d1': draft(),
    })
    vi.stubGlobal('fetch', fetchStub)
    renderAt('/dashboard/print/slicer/d1')

    expect(await screen.findByText('1 on the plate')).toBeInTheDocument()
    expect(screen.getByText(/not sliced yet/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'SLICE PLATE' }))

    expect(await screen.findByText(/waiting for the slicer/i)).toBeInTheDocument()
    const call = fetchStub.mock.calls.find((c) => urlOf(c[0]).endsWith('/print/drafts/d1/slice'))!
    expect(bodyOf(call[1])).toEqual({ revision: 3 })
  })

  it('says the slicer is offline instead of offering a press that would fail', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/print/workspace': workspace({ workerOnline: false }), '/me/print-allowance': allowance, '/print/drafts/d1': draft() }),
    )
    renderAt('/dashboard/print/slicer/d1')
    expect(await screen.findByText(/slicer is offline/i)).toBeInTheDocument()
  })

  it('saves a changed setting as an override, naming the revision', async () => {
    const fetchStub = stubFetch({
      '/print/workspace': workspace(),
      '/me/print-allowance': allowance,
      '/print/drafts/d1': draft(),
    })
    vi.stubGlobal('fetch', fetchStub)
    renderAt('/dashboard/print/slicer/d1')
    await screen.findByText('1 on the plate')

    fireEvent.click(screen.getByRole('tab', { name: /strength/i }))
    const walls = screen.getByLabelText('Walls')
    fireEvent.change(walls, { target: { value: '4' } })
    fireEvent.blur(walls)

    await waitFor(() => {
      const patch = fetchStub.mock.calls.find((c) => c[1]?.method === 'PATCH')
      expect(patch && bodyOf(patch[1])).toEqual({ revision: 3, overrides: { wall_loops: 4 } })
    })
  })

  it('locks what the member hasn’t taken the chapter for, and says which', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/print/workspace': workspace({ chapters: [...REQUIRED_CHAPTERS, 'adhesion'] }),
        '/me/print-allowance': allowance,
        '/print/drafts/d1': draft(),
      }),
    )
    renderAt('/dashboard/print/slicer/d1')
    await screen.findByText('1 on the plate')

    expect(screen.getByRole('combobox', { name: 'FILAMENT' })).toBeDisabled()
    fireEvent.click(screen.getByRole('tab', { name: /strength/i }))
    expect(screen.getByLabelText('Walls')).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Strength settings' })).toHaveAttribute(
      'href',
      '/dashboard/profile/training?chapter=strength',
    )
    fireEvent.click(screen.getByRole('tab', { name: /others/i }))
    expect(screen.getByLabelText('Brim')).toBeEnabled()
    expect(screen.getByLabelText('Vase mode')).toBeDisabled()
  })

  it('undoes a move with Ctrl+Z and redoes it with Ctrl+Y', async () => {
    // A server that keeps what it's sent, so each save comes back as the plate it saved.
    let saved = draft()
    const patches: ApiPlateObject[][] = []
    const routes = { '/print/workspace': workspace(), '/me/print-allowance': allowance }
    const fetchStub = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (urlOf(input).endsWith('/print/drafts/d1')) {
        if (init?.method === 'PATCH') {
          const { objects } = bodyOf(init) as { objects: ApiPlateObject[] }
          patches.push(objects)
          saved = { ...saved, objects, revision: saved.revision + 1 }
        }
        return Promise.resolve(new Response(JSON.stringify(saved)))
      }
      return stubFetch(routes)(input, init)
    })
    vi.stubGlobal('fetch', fetchStub)
    renderAt('/dashboard/print/slicer/d1')
    await screen.findByText('1 on the plate')

    fireEvent.click(screen.getByRole('button', { name: /bracket/ }))
    const x = screen.getByLabelText('Position X')
    fireEvent.change(x, { target: { value: '100' } })
    fireEvent.keyDown(x, { key: 'Enter' })
    const lastX = () => patches.at(-1)?.[0]?.x
    await waitFor(() => {
      expect(lastX()).toBe(100)
    })

    // From focus on the page itself rather than a control, where navigation leaves it.
    fireEvent.keyDown(screen.getByText('CC1'), { key: 'z', ctrlKey: true })
    await waitFor(() => {
      expect(lastX()).toBe(128)
    })
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true })
    await waitFor(() => {
      expect(lastX()).toBe(100)
    })
    expect(screen.getByLabelText('Position X')).toHaveValue(100)
  })

  it('says why a plate can’t be sliced when a model can’t be read', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/print/workspace': workspace(),
        '/me/print-allowance': allowance,
        '/print/drafts/d1': draft({ models: [{ ...draft().models[0]!, meshState: 'FAILED', meshFailure: 'Not a solid.' }] }),
      }),
    )
    renderAt('/dashboard/print/slicer/d1')
    expect(await screen.findByText(/couldn't be read. Remove it/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SLICE PLATE' })).toBeDisabled()
  })
})

describe('a sliced plate', () => {
  it('shows Orca’s estimate and makes REQUEST PRINT the next step', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/print/workspace': workspace(), '/me/print-allowance': allowance, '/print/drafts/d1': draft({ slice: readySlice() }) }),
    )
    renderAt('/dashboard/print/slicer/d1')

    expect(await screen.findByText(/2 h 14 min · 36.2 g · 12.10 m/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'REQUEST PRINT' })).toBeEnabled()
  })

  it('warns before sending a personal print past the allowance, then sends it', async () => {
    const fetchStub = stubFetch({
      '/print/workspace': workspace(),
      '/me/print-allowance': allowance,
      '/print/drafts/d1/submit': { id: 'd1', fileName: 'bracket.stl' },
      '/print/drafts/d1': draft({ slice: readySlice() }),
    })
    vi.stubGlobal('fetch', fetchStub)
    renderAt('/dashboard/print/slicer/d1')

    fireEvent.click(await screen.findByRole('button', { name: 'REQUEST PRINT' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/16.2 g past what you have left/i)).toBeInTheDocument()
    expect(within(dialog).queryByText(/Practice only/)).not.toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText(/special requests/i), { target: { value: 'Black please' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'SEND IT' }))

    expect(await screen.findByText('the printing page')).toBeInTheDocument()
    const call = fetchStub.mock.calls.find((c) => urlOf(c[0]).endsWith('/submit'))!
    expect(bodyOf(call[1])).toEqual({ revision: 3, projectId: null, notes: 'Black please' })
  })

  it('says a stale slice is stale', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/print/workspace': workspace(), '/me/print-allowance': allowance, '/print/drafts/d1': draft({ slice: readySlice({ current: false }) }) }),
    )
    renderAt('/dashboard/print/slicer/d1')
    expect(await screen.findByText(/changed since it was sliced/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'REQUEST PRINT' })).toBeDisabled()
  })

  it('names a filament an officer has hidden, and holds back REQUEST PRINT', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/print/workspace': workspace(),
        '/me/print-allowance': allowance,
        // Still current by the server's last word: the officer hid it after this tab loaded.
        '/print/drafts/d1': draft({
          filamentId: 'silk',
          slicedWith: { printer: 'CC1', process: 'Standard', filament: 'Silk PLA' },
          slice: readySlice(),
        }),
      }),
    )
    renderAt('/dashboard/print/slicer/d1')
    expect(await screen.findAllByText("Silk PLA isn't offered any more. Pick a filament.")).not.toHaveLength(0)
    expect(screen.getByRole('button', { name: 'REQUEST PRINT' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'SLICE PLATE' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'FILAMENT' })).toHaveAttribute('aria-invalid', 'true')
  })

  it('explains a missing preview in the worker’s words', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({ '/print/workspace': workspace(), '/me/print-allowance': allowance, '/print/drafts/d1': draft({ slice: readySlice() }) }),
    )
    renderAt('/dashboard/print/slicer/d1')
    fireEvent.click(await screen.findByRole('tab', { name: 'PREVIEW' }))
    expect(screen.getByText(/too detailed to preview. It's sliced and can be sent/i)).toBeInTheDocument()
  })
})
