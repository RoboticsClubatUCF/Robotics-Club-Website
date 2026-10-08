import { ChevronLeft, PanelLeft, PanelRight, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ApiError } from '../../lib/api/api'
import type {
  ApiMyProject,
  ApiPlacement,
  ApiPlateObject,
  ApiPrintAllowance,
  ApiSlicerWorkspace,
} from '../../lib/api/api'
import { arrange, freeSpot } from '../../lib/slicer/arrange'
import { primeMesh, useMeshes } from '../../lib/slicer/meshes'
import { autoOrient, layFlat } from '../../lib/slicer/orient'
import { boxOn, fitOn, sizeOf } from '../../lib/slicer/plate'
import { type FitProblem, canonicalQuat } from '../../lib/slicer/plateTransform'
import { ACCEPTED_MODELS, MeshError, parseStl } from '../../lib/slicer/stl'
import { useDraft } from '../../lib/slicer/useDraft'
import { usePreview } from '../../lib/slicer/usePreview'
import { ErrorDialog } from '../shared/ErrorDialog'
import { ObjectPanel } from './ObjectPanel'
import { PlateToolbar } from './PlateToolbar'
import { type PlateMode, PlateView } from './PlateView'
import { PreviewView } from './PreviewView'
import { SettingsPanel } from './SettingsPanel'
import { SliceSummary } from './SliceSummary'
import { SubmitDialog } from './SubmitDialog'
import { iconSize, loudButton, quietButton } from './slicerChrome'

const FIT_PROBLEM: Record<FitProblem, string> = {
  offPlate: 'hangs off the plate',
  tooTall: 'is taller than the printer can print',
  noGo: `sits in the purge corner`,
}

const IDENTITY = { qx: 0, qy: 0, qz: 0, qw: 1, sx: 1, sy: 1, sz: 1 }

function explain(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return `Couldn't reach the server. Try again in a moment.`
    if (error.status === 413) return 'That file is too big to upload.'
    if (error.detail) return error.detail
  }
  if (error instanceof MeshError) return error.message
  return fallback
}

/** Keys the workspace answers, unless somebody's typing or a dialog is open. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))

/**
 * The slicer workspace: Orca's Prepare and Preview, for one build plate.
 *
 * Settings on the left, the plate in the middle, its objects on the right; on a phone the two
 * columns open as drawers over the plate. SLICE PLATE sends the plate to the slicer worker, and
 * PRINT sends the sliced plate to the officers once it's current.
 */
export function SlicerWorkspace({
  draftId,
  workspace,
  projects,
  allowance,
}: {
  draftId: string | undefined
  workspace: ApiSlicerWorkspace
  projects: ApiMyProject[]
  allowance: ApiPrintAllowance | null
}) {
  const navigate = useNavigate()
  const plate = useDraft(draftId)
  const { draft, plate: local } = plate
  const models = draft?.models ?? []
  const { meshes } = useMeshes(models)
  const preview = usePreview(draft?.id, draft?.slice ?? null)
  const bed = workspace.profiles.bed
  const objects = local.objects

  const [tab, setTab] = useState<'prepare' | 'preview'>('prepare')
  const [selected, setSelected] = useState<string[]>([])
  const [mode, setMode] = useState<PlateMode>('move')
  const [drawer, setDrawer] = useState<'settings' | 'objects' | null>(null)
  const [problem, setProblem] = useState<{ title: string; message: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [slicing, setSlicing] = useState(false)
  const [sending, setSending] = useState<'closed' | 'open' | 'sending'>('closed')

  const problems = new Map<string, FitProblem>()
  for (const object of objects) {
    const positions = meshes.get(object.modelId)
    const fit = positions ? fitOn(positions, object, bed) : null
    if (fit) problems.set(object.id, fit)
  }

  const slice = draft?.slice ?? null
  const converting = models.some((model) => model.meshState === 'QUEUED' || model.meshState === 'RUNNING')
  const unreadable = models.find((model) => model.meshState === 'FAILED')
  const sliced = slice?.state === 'READY' && slice.current && !plate.saving
  const slicingNow = slice?.state === 'QUEUED' || slice?.state === 'RUNNING'
  const editable = !draft || draft.status === 'DRAFT'

  // Orca opens Preview when a slice it was waiting on lands; so does this. Not on opening a plate
  // that was sliced before.
  const waited = useRef(false)
  useEffect(() => {
    if (slice?.state === 'QUEUED' || slice?.state === 'RUNNING') {
      waited.current = true
    } else if (waited.current && slice?.state === 'READY' && slice.current) {
      waited.current = false
      setTab('preview')
    } else if (slice?.state === 'FAILED') {
      waited.current = false
    }
  }, [slice])

  const setObjects = (next: ApiPlateObject[]) => {
    plate.edit({ objects: next })
  }
  const change = (id: string, placement: Partial<ApiPlacement>) => {
    setObjects(objects.map((object) => (object.id === id ? { ...object, ...placement } : object)))
  }

  const add = async (files: File[]) => {
    setUploading(true)
    try {
      const taken = objects.flatMap((object) => {
        const positions = meshes.get(object.modelId)
        return positions ? [boxOn(positions, object)] : []
      })
      for (const file of files) {
        const name = file.name.toLowerCase()
        if (!ACCEPTED_MODELS.some((extension) => name.endsWith(extension))) {
          throw new MeshError(`The slicer takes ${ACCEPTED_MODELS.join(', ')} files. ${file.name} is something else.`)
        }
        if (file.size > workspace.limits.fileMb * 1024 * 1024) {
          throw new MeshError(`${file.name} is over the ${String(workspace.limits.fileMb)} MB limit.`)
        }
        // An STL can be read here, so it goes where there's room; a STEP waits for the worker.
        const positions = name.endsWith('.stl') ? parseStl(new Uint8Array(await file.arrayBuffer())) : null
        const spot = positions
          ? freeSpot(taken, sizeOf(positions, { ...IDENTITY, x: 0, y: 0 }), bed)
          : { x: bed.width / 2, y: bed.depth / 2 }
        const object = { id: crypto.randomUUID(), ...IDENTITY, ...spot }
        const next = await plate.addModel(file, object)
        const placed = next.objects.find((o) => o.id === object.id)
        if (placed && positions) {
          primeMesh(placed.modelId, positions)
          taken.push(boxOn(positions, placed))
        }
        if (!draftId) void navigate(`/dashboard/print/slicer/${next.id}`, { replace: true })
        setSelected([object.id])
      }
    } catch (error) {
      setProblem({ title: `That model didn't go on the plate`, message: explain(error, `The upload didn't go through. Try again in a moment.`) })
    } finally {
      setUploading(false)
    }
  }

  const copy = () => {
    const taken = objects.flatMap((object) => {
      const positions = meshes.get(object.modelId)
      return positions ? [boxOn(positions, object)] : []
    })
    const copies: ApiPlateObject[] = []
    for (const id of selected) {
      const original = objects.find((object) => object.id === id)
      if (!original) continue
      const positions = meshes.get(original.modelId)
      const spot = positions
        ? freeSpot(taken, sizeOf(positions, original), bed)
        : { x: original.x + 10, y: original.y + 10 }
      const twin = { ...original, ...spot, id: crypto.randomUUID() }
      if (positions) taken.push(boxOn(positions, twin))
      copies.push(twin)
    }
    if (objects.length + copies.length > workspace.limits.objects) {
      setProblem({ title: 'No room for more copies', message: `A plate holds ${String(workspace.limits.objects)} objects at most.` })
      return
    }
    setObjects([...objects, ...copies])
    setSelected(copies.map((object) => object.id))
  }

  const remove = () => {
    setObjects(objects.filter((object) => !selected.includes(object.id)))
    setSelected([])
  }

  const arrangePlate = () => {
    const items = objects.flatMap((object) => {
      const positions = meshes.get(object.modelId)
      return positions ? [{ id: object.id, positions, placement: object }] : []
    })
    const result = arrange(items, bed)
    setObjects(objects.map((object) => ({ ...object, ...(result.placed.get(object.id) ?? {}) })))
    if (result.unplaced.length > 0) {
      setProblem({
        title: `Everything didn't fit`,
        message: `${String(result.unplaced.length)} ${result.unplaced.length === 1 ? 'object was' : 'objects were'} left where ${result.unplaced.length === 1 ? 'it was' : 'they were'}. Remove some copies or make them smaller.`,
      })
    }
  }

  const orient = () => {
    const targets = selected.length > 0 ? selected : objects.map((object) => object.id)
    setObjects(
      objects.map((object) => {
        const positions = meshes.get(object.modelId)
        if (!targets.includes(object.id) || !positions) return object
        return { ...object, ...canonicalQuat(autoOrient(positions, [object.sx, object.sy, object.sz])) }
      }),
    )
  }

  const flatten = (id: string, normal: [number, number, number]) => {
    const object = objects.find((o) => o.id === id)
    if (!object) return
    change(id, canonicalQuat(layFlat(object, normal)))
    setMode('move')
  }

  const runSlice = async () => {
    setSlicing(true)
    try {
      await plate.slice()
    } catch (error) {
      setProblem({ title: `The plate wasn't sliced`, message: explain(error, `The slicer didn't answer. Try again in a moment.`) })
    } finally {
      setSlicing(false)
    }
  }

  const send = async (details: { projectId: string | null; notes: string }) => {
    setSending('sending')
    try {
      const sent = await plate.submit(details)
      void navigate('/dashboard/print', { state: { sent: sent.fileName } })
    } catch (error) {
      setSending('closed')
      setProblem({ title: `The plate wasn't sent`, message: explain(error, `It didn't go through. Try again in a moment.`) })
      if (error instanceof ApiError && error.status === 409) void plate.reload()
    }
  }

  // Shortcuts, as in Orca. Never while typing or with a dialog open.
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined)
  useEffect(() => {
    keys.current = (event: KeyboardEvent) => {
      if (typing(event.target) || problem || sending !== 'closed' || tab !== 'prepare' || !editable) return
      const ctrl = event.ctrlKey || event.metaKey
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected.length > 0) {
        event.preventDefault()
        remove()
      } else if (ctrl && event.key.toLowerCase() === 'd' && selected.length > 0) {
        event.preventDefault()
        copy()
      } else if (ctrl && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setSelected(objects.map((object) => object.id))
      } else if (event.key === 'Escape') {
        setSelected([])
        setMode('move')
      } else if (event.key.startsWith('Arrow') && selected.length > 0) {
        event.preventDefault()
        const step = event.shiftKey ? 10 : 1
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
        const dy = event.key === 'ArrowDown' ? -step : event.key === 'ArrowUp' ? step : 0
        setObjects(objects.map((object) => (selected.includes(object.id) ? { ...object, x: object.x + dx, y: object.y + dy } : object)))
      } else if (!ctrl && !event.altKey) {
        const next = ({ m: 'move', r: 'rotate', s: 'scale', f: 'flat' } as const)[event.key.toLowerCase() as 'm']
        if (next) setMode(next)
        else if (event.key.toLowerCase() === 'a') arrangePlate()
      }
    }
  })
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      keys.current(event)
    }
    window.addEventListener('keydown', listener)
    return () => {
      window.removeEventListener('keydown', listener)
    }
  }, [])

  const placementWarning = [...problems.entries()][0]
  const sliceBlocked = !draft
    ? 'Add a model first.'
    : !editable
      ? null
      : objects.length === 0
        ? 'Put something on the plate first.'
        : unreadable
          ? `${unreadable.fileName} couldn't be read. Remove it to slice the rest.`
          : converting
            ? 'A STEP file is still converting.'
            : placementWarning
              ? `${objects.find((o) => o.id === placementWarning[0])?.name ?? 'An object'} ${FIT_PROBLEM[placementWarning[1]]}.`
              : null

  if (plate.load.status !== 'ready') return <Unavailable load={plate.load.status} onRetry={() => void plate.reload()} />

  const tabButton = (key: 'prepare' | 'preview', label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => {
        setTab(key)
      }}
      className={`min-h-11 cursor-pointer border-b-2 px-3 font-mono text-[11px] font-semibold tracking-[0.12em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary wide:min-h-9 ${
        tab === key ? 'border-primary text-primary' : 'text-dim hover:text-base-content border-transparent'
      }`}
    >
      {label}
    </button>
  )

  const drawerClass = (which: 'settings' | 'objects') =>
    `bg-base-100 border-rule min-h-0 overflow-y-auto ${
      drawer === which ? 'absolute inset-y-0 z-20 w-[min(22rem,100%)] shadow-2xl' : 'hidden'
    } ${which === 'settings' ? 'left-0 border-r' : 'right-0 border-l'} wide:static wide:block wide:shadow-none ${
      which === 'settings' ? 'wide:w-[20rem]' : 'wide:w-[17rem]'
    } wide:shrink-0`

  return (
    <div className="flex h-[calc(100dvh-var(--spacing-nav))] min-h-[30rem] flex-col">
      <header className="border-rule bg-base-100 flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5">
        <Link
          to="/dashboard/print"
          className="text-dim hover:text-base-content inline-flex min-h-11 items-center gap-1 font-mono text-[11px] font-semibold tracking-[0.12em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary wide:min-h-9"
        >
          <ChevronLeft className={iconSize} aria-hidden="true" /> PRINTING
        </Link>
        <div role="tablist" aria-label="Workspace" className="flex">
          {tabButton('prepare', 'PREPARE')}
          {tabButton('preview', 'PREVIEW')}
        </div>
        <div className="order-last flex min-w-0 basis-full items-center gap-2 wide:order-none wide:basis-auto wide:flex-1">
          <SliceSummary draft={draft} workerOnline={workspace.workerOnline} dirty={plate.saving} />
          {plate.saving && <span className="text-faint shrink-0 font-mono text-[10px] tracking-[0.12em]">SAVING…</span>}
        </div>
        <span className="ml-auto flex items-center gap-2 wide:ml-0">
          <button
            type="button"
            onClick={() => {
              void runSlice()
            }}
            disabled={!editable || slicing || slicingNow || sliceBlocked !== null}
            title={sliceBlocked ?? undefined}
            className={sliced ? quietButton : loudButton}
          >
            {slicing || slicingNow ? 'SLICING…' : 'SLICE PLATE'}
          </button>
          <button
            type="button"
            onClick={() => {
              setSending('open')
            }}
            disabled={!editable || !sliced}
            className={sliced ? loudButton : quietButton}
          >
            PRINT
          </button>
        </span>
      </header>

      {(plate.notice || !editable || (sliceBlocked && objects.length > 0)) && (
        <div role="status" className="border-rule bg-wash flex items-start justify-between gap-3 border-b px-4 py-2 text-[12.5px] leading-[1.5]">
          <span className={plate.notice ? 'text-base-content' : 'text-dim'}>
            {plate.notice ??
              (!editable
                ? 'This plate has been sent. Take it back from the printing page to change it.'
                : sliceBlocked)}
          </span>
          {plate.notice && (
            <button
              type="button"
              onClick={plate.clearNotice}
              aria-label="Dismiss"
              className="text-dim hover:text-base-content -m-1 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center"
            >
              <X className={iconSize} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        <aside aria-label="Print settings" className={drawerClass('settings')}>
          <DrawerClose open={drawer === 'settings'} onClose={() => setDrawer(null)} />
          <SettingsPanel
            profiles={workspace.profiles}
            settings={local}
            disabled={!editable}
            onChange={(settings) => {
              plate.edit(settings)
            }}
          />
        </aside>

        <section aria-label={tab === 'prepare' ? 'Build plate' : 'Sliced preview'} className="relative min-w-0 flex-1">
          {tab === 'prepare' ? (
            <>
              <PlateView
                bed={bed}
                objects={objects}
                meshes={meshes}
                selected={selected}
                problems={problems}
                mode={editable ? mode : 'move'}
                onSelect={setSelected}
                onDrag={editable ? plate.preview : () => undefined}
                onCommit={editable ? change : () => undefined}
                onLayFlat={editable ? flatten : () => undefined}
              />
              {editable && (
                <PlateToolbar
                  mode={mode}
                  hasSelection={selected.length > 0}
                  hasObjects={objects.length > 0}
                  disabled={uploading}
                  onMode={setMode}
                  onAdd={(files) => {
                    void add(files)
                  }}
                  onArrange={arrangePlate}
                  onOrient={orient}
                  onCopy={copy}
                  onDelete={remove}
                />
              )}
              {objects.length === 0 && (
                <EmptyPlate
                  uploading={uploading}
                  onAdd={(files) => {
                    void add(files)
                  }}
                />
              )}
              {mode === 'flat' && editable && (
                <p className="border-rule bg-base-100/90 absolute top-3 right-3 left-16 border px-3 py-1.5 text-[12px] wide:top-auto wide:right-auto wide:bottom-3 wide:left-1/2 wide:-translate-x-1/2">
                  Click a face of the selected object to put it on the bed.
                </p>
              )}
            </>
          ) : (
            <PreviewPane preview={preview} bed={bed} sliced={sliced} failure={slice?.previewFailure ?? null} />
          )}

          <span className="absolute top-3 left-3 flex flex-col gap-1 wide:hidden">
            <button type="button" onClick={() => setDrawer('settings')} className={`${quietButton} bg-base-100 px-2.5`} aria-label="Open the print settings">
              <PanelLeft className={iconSize} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setDrawer('objects')} className={`${quietButton} bg-base-100 px-2.5`} aria-label="Open the object list">
              <PanelRight className={iconSize} aria-hidden="true" />
            </button>
          </span>
        </section>

        <aside aria-label="Objects" className={drawerClass('objects')}>
          <DrawerClose open={drawer === 'objects'} onClose={() => setDrawer(null)} />
          <ObjectPanel
            objects={objects}
            models={models}
            meshes={meshes}
            selected={selected}
            problems={problems}
            disabled={!editable}
            onSelect={setSelected}
            onChange={change}
            onCopy={copy}
            onDelete={remove}
          />
        </aside>
      </div>

      {problem && (
        <ErrorDialog title={problem.title} onDismiss={() => setProblem(null)}>
          {problem.message}
        </ErrorDialog>
      )}

      {sending !== 'closed' && slice?.estimatedGrams != null && (
        <SubmitDialog
          grams={slice.estimatedGrams}
          seconds={slice.estimatedSeconds}
          projects={projects}
          allowance={allowance}
          busy={sending === 'sending'}
          onSubmit={(details) => {
            void send(details)
          }}
          onDismiss={() => {
            if (sending !== 'sending') setSending('closed')
          }}
        />
      )}
    </div>
  )
}

function Unavailable({ load, onRetry }: { load: 'loading' | 'missing' | 'failed'; onRetry: () => void }) {
  if (load === 'loading') {
    return <div aria-busy="true" className="h-[calc(100dvh-var(--spacing-nav))]" />
  }
  return (
    <div className="px-page py-9 wide:py-12">
      <p className="text-faint mb-3 font-mono text-[11px] font-medium tracking-[0.18em]">/ 3D PRINTING · SLICER</p>
      <h1 className="mb-4 text-2xl font-bold">{load === 'missing' ? 'No such plate.' : `The plate didn't load.`}</h1>
      <p className="text-dim mb-4 max-w-[42rem] text-sm leading-[1.7]">
        {load === 'missing'
          ? 'It may have been sent, discarded or expired.'
          : `We couldn't reach the server. Try again in a moment.`}
      </p>
      <span className="flex gap-2">
        {load === 'failed' && (
          <button type="button" onClick={onRetry} className={quietButton}>
            TRY AGAIN
          </button>
        )}
        <Link to="/dashboard/print" className={quietButton}>
          BACK TO PRINTING
        </Link>
      </span>
    </div>
  )
}

function DrawerClose({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return (
    <div className="flex justify-end p-1 wide:hidden">
      <button type="button" onClick={onClose} aria-label="Close" className="text-dim hover:text-base-content inline-flex size-11 cursor-pointer items-center justify-center">
        <X className={iconSize} aria-hidden="true" />
      </button>
    </div>
  )
}

function EmptyPlate({ uploading, onAdd }: { uploading: boolean; onAdd: (files: File[]) => void }) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  return (
    <div
      className="absolute inset-0 flex items-center justify-center p-6"
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        onAdd([...event.dataTransfer.files])
      }}
    >
      <div className={`border-rule bg-base-100/90 max-w-sm border border-dashed p-6 text-center ${over ? 'border-primary' : ''}`}>
        <p className="mb-1 text-sm font-medium">{uploading ? 'Uploading…' : 'Drop an STL or STEP file here.'}</p>
        <p className="text-faint mb-4 text-[12px] leading-[1.5]">Several models can share one plate.</p>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPTED_MODELS.join(',')}
          className="hidden"
          aria-label="Choose model files"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])]
            event.target.value = ''
            if (files.length > 0) onAdd(files)
          }}
        />
        <button type="button" disabled={uploading} onClick={() => input.current?.click()} className={loudButton}>
          ADD A MODEL
        </button>
      </div>
    </div>
  )
}

function PreviewPane({
  preview,
  bed,
  sliced,
  failure,
}: {
  preview: ReturnType<typeof usePreview>
  bed: ApiSlicerWorkspace['profiles']['bed']
  sliced: boolean
  /** Why a sliced plate has no preview, in the worker's words. */
  failure: string | null
}) {
  if (preview.status === 'ready') return <PreviewView bed={bed} preview={preview.preview} />
  const text =
    preview.status === 'loading'
      ? 'Loading the sliced layers…'
      : preview.status === 'failed'
        ? preview.message
        : sliced
          ? `${failure ?? 'This plate has no preview.'} It's sliced and can be sent.`
          : 'Slice the plate to see its layers.'
  return (
    <div className="flex h-full items-center justify-center p-6" aria-busy={preview.status === 'loading'}>
      <p className="text-dim max-w-sm text-center text-[13px] leading-[1.6]">{text}</p>
    </div>
  )
}
