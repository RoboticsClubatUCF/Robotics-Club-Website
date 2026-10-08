import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import type {
  ApiDeskProfile,
  ApiProfileFile,
  ApiSlicerDesk,
  ApiTerm,
  UserRole,
} from '../../lib/api/api'
import { bodyOf, stubFetch, stubFetchNetworkError, stubFetchPending, urlOf } from '../../test/stubFetch'
import { OfficerSlicerProfilesPage } from './OfficerSlicerProfilesPage'

/**
 * The profiles desk: what's offered, what the worker is still checking or refused, and the
 * uploads, edits and deletes. The worker itself is the server's to test.
 */

const term: ApiTerm = {
  year: 2026,
  season: 'FALL',
  startsAt: '2026-08-24T04:00:00.000Z',
  endsAt: '2026-12-14T04:59:59.999Z',
  fromCalendar: true,
}

const profile = (over: Partial<ApiDeskProfile> = {}): ApiDeskProfile => ({
  id: 'p1',
  kind: 'FILAMENT',
  name: 'Elegoo Rapid PLA',
  label: 'PLA',
  description: null,
  offered: true,
  state: 'READY',
  failure: null,
  sourceFile: 'Generic PLA.orca_filament: System/Elegoo Rapid PLA.json',
  info: { type: 'PLA', vendor: 'Generic', compatiblePrinters: [] },
  testedWith: 'CC1, Standard',
  orcaVersion: '2.4.2',
  uploadedBy: 'Officer Test',
  updatedAt: '2026-10-01T12:00:00.000Z',
  uses: { drafts: 0, sent: 0 },
  ...over,
})

const printer = profile({
  id: 'cc1',
  kind: 'PRINTER',
  name: 'CC1',
  label: 'CC1',
  sourceFile: 'CC1.orca_printer: printer/CC1.json',
  info: {
    model: 'Elegoo Centauri Carbon',
    nozzle: 0.4,
    bedType: 'Textured PEI Plate',
    bed: { width: 256, depth: 256, height: 256, exclude: null },
  },
  testedWith: null,
})

const process = (over: Partial<ApiDeskProfile> = {}) =>
  profile({
    id: 'std',
    kind: 'PROCESS',
    name: '0.20mm, 0.4 nozzle, Line, T-Support',
    label: 'Standard',
    info: { summary: '2 walls, 15% line', values: {} },
    testedWith: 'CC1, PLA',
    ...over,
  })

const desk = (over: Partial<ApiSlicerDesk> = {}): ApiSlicerDesk => ({
  printers: [{ ...printer, processes: [process(), process({ id: 'q', label: 'Q', name: 'Q preset', info: { summary: '3 walls, 10% gyroid', values: {} } })] }],
  filaments: [
    { ...profile(), fits: ['cc1'] },
    {
      ...profile({
        id: 'tpu',
        name: 'Overture TPU',
        label: 'TPU',
        state: 'FAILED',
        failure: "Orca couldn't slice a test cube with it.",
        info: null,
      }),
      fits: null,
    },
  ],
  workerOnline: true,
  limit: 100,
  ...over,
})

const context = (role: UserRole = 'OFFICER'): DashboardContext => ({
  user: {
    id: 'u1',
    fullName: 'Officer Test',
    email: null,
    slug: null,
    role,
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
    },
  },
  reloadMembership: () => Promise.resolve(),
})

const renderPage = (dashboard = context()) =>
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Outlet context={dashboard} />}>
          <Route path="/" element={<OfficerSlicerProfilesPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OfficerSlicerProfilesPage', () => {
  it('shows a skeleton while it loads', () => {
    vi.stubGlobal('fetch', stubFetchPending())
    renderPage()
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('says so when the profiles don’t load', async () => {
    vi.stubGlobal('fetch', stubFetchNetworkError())
    renderPage()
    expect(await screen.findByText(/couldn't load the profiles/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'TRY AGAIN' })).toBeInTheDocument()
  })

  it('is for officers only', () => {
    vi.stubGlobal('fetch', stubFetchPending())
    renderPage(context('MEMBER'))
    expect(screen.queryByRole('button', { name: /add from an export/i })).not.toBeInTheDocument()
  })

  it('lists printers with their processes and the filaments, with what each one is', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/slicer-profiles': desk() }))
    renderPage()

    const printers = within(await screen.findByRole('region', { name: 'PRINTERS' }))
    expect(printers.getByText('CC1')).toBeInTheDocument()
    expect(printers.getByText(/Elegoo Centauri Carbon · 0.4 mm nozzle · 256 × 256 × 256 mm/)).toBeInTheDocument()
    expect(printers.getByText('Standard')).toBeInTheDocument()
    expect(printers.getByText('2 walls, 15% line')).toBeInTheDocument()
    expect(printers.getAllByText('Test-sliced on CC1, PLA.')).toHaveLength(2)

    const filaments = within(screen.getByRole('region', { name: 'FILAMENTS' }))
    expect(filaments.getByText('PLA · Generic · for CC1')).toBeInTheDocument()
    expect(filaments.getByText('REFUSED')).toBeInTheDocument()
    expect(filaments.getByText("Orca couldn't slice a test cube with it.")).toBeInTheDocument()
    // Nothing to hide or offer until it works.
    expect(filaments.queryByRole('button', { name: 'Hide the TPU filament' })).not.toBeInTheDocument()
    expect(filaments.getByRole('button', { name: 'Delete the TPU filament' })).toBeInTheDocument()
  })

  it('asks before hiding a profile drafts use', async () => {
    const used = desk()
    used.filaments[0]!.uses = { drafts: 2, sent: 0 }
    const stub = stubFetch({ '/officer/slicer-profiles': used })
    vi.stubGlobal('fetch', stub)
    renderPage()
    expect(await screen.findByText('Used by 2 drafts.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hide the PLA filament' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText(/2 drafts use it. They can't be sliced or sent/)).toBeInTheDocument()
    expect(stub.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false)
    fireEvent.click(dialog.getByRole('button', { name: 'HIDE IT' }))
    await waitFor(() => {
      const call = stub.mock.calls.find(([, init]) => init?.method === 'PATCH')
      expect(bodyOf(call?.[1])).toEqual({ offered: false })
    })
  })

  it('adds processes to the printer they were asked for, and lists only processes', async () => {
    const contents: ApiProfileFile = {
      fileName: 'MK4.orca_printer',
      printer: { id: 'cc1', label: 'CC1' },
      presets: [
        { entry: 'printer/MK4.json', kind: 'PRINTER', name: 'MK4', inherits: 'Prusa MK4 0.4 nozzle', existing: null },
        { entry: 'process/Fine.json', kind: 'PROCESS', name: 'Fine', inherits: '0.15mm SPEED', existing: null },
        { entry: 'filament/Silk.json', kind: 'FILAMENT', name: 'Silk PLA', inherits: 'Generic PLA', existing: null },
      ],
    }
    const stub = stubFetch({ '/officer/slicer-profiles/inspect': contents, '/officer/slicer-profiles': desk() })
    vi.stubGlobal('fetch', stub)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Add processes to the CC1 printer' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByRole('heading', { name: 'Add processes to CC1' })).toBeInTheDocument()
    fireEvent.change(dialog.getByLabelText('FILE'), { target: { files: [new File(['PK'], 'MK4.orca_printer')] } })
    expect(await dialog.findByRole('checkbox', { name: /Fine/ })).toBeChecked()
    expect(dialog.queryByRole('radio', { name: /MK4/ })).not.toBeInTheDocument()
    expect(dialog.queryByRole('checkbox', { name: /Silk PLA/ })).not.toBeInTheDocument()
    fireEvent.click(dialog.getByRole('button', { name: 'ADD PRESET' }))
    await waitFor(() => {
      const call = stub.mock.calls.find(
        ([input, init]) => init?.method === 'POST' && urlOf(input).endsWith('/officer/slicer-profiles'),
      )
      const form = call?.[1]?.body as FormData | undefined
      expect(form?.get('printerId')).toBe('cc1')
      expect(JSON.parse(form?.get('entries') as string)).toEqual(['process/Fine.json'])
    })
  })

  it('forgets the last file’s ticks when the next one can’t be read', async () => {
    const contents: ApiProfileFile = {
      fileName: 'Silk.json',
      printer: null,
      presets: [{ entry: 'Silk.json', kind: 'FILAMENT', name: 'Silk PLA', inherits: 'Generic PLA', existing: null }],
    }
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request) => {
        const url = urlOf(input)
        if (url.includes('/inspect')) {
          calls++
          return Promise.resolve(
            calls === 1
              ? new Response(JSON.stringify(contents), { status: 200 })
              : new Response(JSON.stringify({ error: "qa-cube.stl isn't readable JSON." }), { status: 400 }),
          )
        }
        return Promise.resolve(new Response(JSON.stringify(desk()), { status: 200 }))
      }),
    )
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /add from an export/i }))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText('FILE'), { target: { files: [new File(['{}'], 'Silk.json')] } })
    expect(await dialog.findByRole('checkbox', { name: /Silk PLA/ })).toBeChecked()
    fireEvent.change(dialog.getByLabelText('FILE'), { target: { files: [new File(['x'], 'qa-cube.stl')] } })
    expect(await dialog.findByRole('alert')).toHaveTextContent("isn't readable JSON")
    expect(dialog.getByRole('button', { name: 'ADD PRESET' })).toBeDisabled()
  })

  it('says when there is nothing yet', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/slicer-profiles': desk({ printers: [], filaments: [] }) }))
    renderPage()
    expect(await screen.findByText(/No printers yet/)).toBeInTheDocument()
    expect(screen.getByText(/No filaments yet/)).toBeInTheDocument()
  })

  it('warns when the slicer is offline', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/officer/slicer-profiles': desk({ workerOnline: false }) }))
    renderPage()
    expect(await screen.findByText(/slicer is offline/i)).toBeInTheDocument()
  })

  it('renames a profile in place', async () => {
    const stub = stubFetch({ '/officer/slicer-profiles': desk() })
    vi.stubGlobal('fetch', stub)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit the PLA filament' }))
    fireEvent.change(screen.getByLabelText('NAME MEMBERS SEE'), { target: { value: 'Rapid PLA' } })
    fireEvent.click(screen.getByRole('button', { name: 'SAVE' }))
    await waitFor(() => {
      const call = stub.mock.calls.find(([, init]) => init?.method === 'PATCH')
      expect(call && urlOf(call[0])).toContain('/officer/slicer-profiles/p1')
      expect(bodyOf(call?.[1])).toEqual({ label: 'Rapid PLA', description: null })
    })
  })

  it('hides a profile with one press', async () => {
    const stub = stubFetch({ '/officer/slicer-profiles': desk() })
    vi.stubGlobal('fetch', stub)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Hide the PLA filament' }))
    await waitFor(() => {
      const call = stub.mock.calls.find(([, init]) => init?.method === 'PATCH')
      expect(bodyOf(call?.[1])).toEqual({ offered: false })
    })
  })

  it('moves a process down its printer’s list', async () => {
    const stub = stubFetch({ '/officer/slicer-profiles': desk() })
    vi.stubGlobal('fetch', stub)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Move Standard down' }))
    await waitFor(() => {
      const call = stub.mock.calls.find(([, init]) => init?.method === 'PATCH')
      expect(call && urlOf(call[0])).toContain('/officer/slicer-profiles/order')
      expect(bodyOf(call?.[1])).toEqual({ ids: ['q', 'std'] })
    })
    expect(screen.getByRole('button', { name: 'Move Standard up' })).toBeInTheDocument()
  })

  it('asks before deleting, saying what uses it and what goes with it', async () => {
    const used = desk()
    used.printers[0]!.uses = { drafts: 2, sent: 1 }
    const stub = stubFetch({ '/officer/slicer-profiles': used })
    vi.stubGlobal('fetch', stub)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete the CC1 printer' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText('Its 2 processes go with it.')).toBeInTheDocument()
    expect(dialog.getByText(/2 drafts use it. Their owners will be asked to pick another printer/)).toBeInTheDocument()
    expect(dialog.getByText('Requests already sent keep their sliced file.')).toBeInTheDocument()
    expect(stub.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
    fireEvent.click(dialog.getByRole('button', { name: 'DELETE' }))
    await waitFor(() => {
      const call = stub.mock.calls.find(([, init]) => init?.method === 'DELETE')
      expect(call && urlOf(call[0])).toContain('/officer/slicer-profiles/cc1')
    })
  })

  it('reads an export, then adds the presets picked from it', async () => {
    const contents: ApiProfileFile = {
      fileName: 'MK4.orca_printer',
      printer: null,
      presets: [
        { entry: 'filament/Silk.json', kind: 'FILAMENT', name: 'Silk PLA', inherits: 'Generic PLA', existing: null },
        { entry: 'printer/MK4.json', kind: 'PRINTER', name: 'MK4', inherits: 'Prusa MK4 0.4 nozzle', existing: null },
        { entry: 'process/Fine.json', kind: 'PROCESS', name: 'Fine', inherits: '0.15mm SPEED', existing: null },
        { entry: 'filament/PLA.json', kind: 'FILAMENT', name: 'Elegoo Rapid PLA', inherits: 'Generic PLA', existing: { id: 'p1', label: 'PLA' } },
      ],
    }
    const stub = stubFetch({ '/officer/slicer-profiles/inspect': contents, '/officer/slicer-profiles': desk() })
    vi.stubGlobal('fetch', stub)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /add from an export/i }))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText('FILE'), {
      target: { files: [new File(['PK'], 'MK4.orca_printer')] },
    })

    // The printer and its processes are picked; the bundle's filaments are opt-in.
    expect(await dialog.findByRole('radio', { name: /MK4/ })).toBeChecked()
    expect(dialog.getByRole('checkbox', { name: /Fine/ })).toBeChecked()
    expect(dialog.getByRole('checkbox', { name: /Silk PLA/ })).not.toBeChecked()
    // One that's already here can only be replaced.
    expect(dialog.getByRole('checkbox', { name: /Elegoo Rapid PLA/ })).toBeDisabled()
    expect(dialog.getByText(/Already here as PLA/)).toBeInTheDocument()

    fireEvent.click(dialog.getByRole('checkbox', { name: /Silk PLA/ }))
    fireEvent.click(dialog.getByRole('button', { name: 'ADD 3 PRESETS' }))
    await waitFor(() => {
      const call = stub.mock.calls.find(
        ([input, init]) => init?.method === 'POST' && urlOf(input).endsWith('/officer/slicer-profiles'),
      )
      const form = call?.[1]?.body as FormData | undefined
      expect(JSON.parse(form?.get('entries') as string)).toEqual([
        'printer/MK4.json',
        'process/Fine.json',
        'filament/Silk.json',
      ])
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('asks which printer processes are for when the file has none', async () => {
    const contents: ApiProfileFile = {
      fileName: 'Fine.json',
      printer: null,
      presets: [{ entry: 'Fine.json', kind: 'PROCESS', name: 'Fine', inherits: '', existing: null }],
    }
    vi.stubGlobal('fetch', stubFetch({ '/officer/slicer-profiles/inspect': contents, '/officer/slicer-profiles': desk() }))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /add from an export/i }))
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText('FILE'), { target: { files: [new File(['{}'], 'Fine.json')] } })
    expect(await dialog.findByRole('combobox', { name: 'FOR WHICH PRINTER' })).toBeInTheDocument()
    fireEvent.click(dialog.getByRole('button', { name: 'ADD PRESET' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent('Say which printer the processes are for.')
  })
})
