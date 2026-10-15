import { ChevronLeft, X } from 'lucide-react'
import { type ReactNode, type RefObject, useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { ApiError } from '../../lib/api/api'
import type {
  ApiBed,
  ApiMyProject,
  ApiPlacement,
  ApiPlateObject,
  ApiPrintAllowance,
  ApiSlicerWorkspace,
} from '../../lib/api/api'
import { arrange, freeSpot } from '../../lib/slicer/arrange'
import { type CameraMoves, viewKey } from '../../lib/slicer/camera'
import { restingFaces } from '../../lib/slicer/faces'
import { primeMesh, useMeshes } from '../../lib/slicer/meshes'
import { autoOrient, layFlat } from '../../lib/slicer/orient'
import { choiceProblem, defaultChoice, printerOf } from '../../lib/slicer/profiles'
import { vaseRefusal } from '../../lib/slicer/processSettings'
import { boxOn, fitOn, sizeOf } from '../../lib/slicer/plate'
import { type Box, type FitProblem, canonicalQuat } from '../../lib/slicer/plateTransform'
import { ACCEPTED_MODELS, MeshError, parseStl } from '../../lib/slicer/stl'
import type { Role } from '../../lib/slicer/preview'
import type { CameraView, Focus } from '../../lib/slicer/scene'
import { type PlateSource, useDraft } from '../../lib/slicer/useDraft'
import { type PreviewLoad, usePreview } from '../../lib/slicer/usePreview'
import { useDialogFocus } from '../../lib/useDialogFocus'
import { ErrorDialog } from '../shared/ErrorDialog'
import { FormEyebrow, FormHeading } from '../shared/formChrome'
import { ObjectPanel, type PlateWarning } from './ObjectPanel'
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
  noGo: `sits where the printer keeps the bed clear`,
}

const IDENTITY = { qx: 0, qy: 0, qz: 0, qw: 1, sx: 1, sy: 1, sz: 1 }

/** How many plate edits Ctrl+Z can step back through. */
const UNDO_DEPTH = 30

const PLACEMENT_KEYS = ['x', 'y', 'qx', 'qy', 'qz', 'qw', 'sx', 'sy', 'sz'] as const

/** Whether two plates are the same objects, in the same order, in the same places. */
const samePlate = (a: ApiPlateObject[], b: ApiPlateObject[]) =>
  a.length === b.length &&
  a.every((object, index) => {
    const other = b[index]!
    return (
      object.id === other.id &&
      object.modelId === other.modelId &&
      PLACEMENT_KEYS.every((key) => object[key] === other[key])
    )
  })

const overlap = (a: Box, b: Box) =>
  a.min[0] < b.max[0] && b.min[0] < a.max[0] && a.min[1] < b.max[1] && b.min[1] < a.max[1]

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

const CONTROL =
  'a[href], button, input, select, textarea, [role="tab"], [role="slider"], [contenteditable="true"]'

/**
 * Where the plate's own keys apply: anywhere but a control outside the plate, its toolbar and the
 * object list (`data-shortcuts`). On a tab, a link or a setting, arrows and letters already mean
 * something, and a stray A re-arranging the plate would be a surprise. Focus left on the page
 * itself, where navigation puts it, counts as the plate.
 */
const onPlate = (target: EventTarget | null) =>
  !(target instanceof Element) ||
  target.closest('[data-shortcuts]') !== null ||
  target.closest(CONTROL) === null

/** Inside a dialog, such as the training's contents, that the workspace doesn't know is open. */
const inDialog = (target: EventTarget | null) =>
  target instanceof Element && target.closest('dialog, [role="dialog"]') !== null

/**
 * The slicer workspace for one of the member's plates: the plate saved as they work, its slice
 * and preview from the worker. The view is `WorkspaceView`, which the slicer training also runs
 * on a practice plate.
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
  const arrived = useLocation().state as { unsubmitted?: boolean } | null
  const plate = useDraft(draftId, defaultChoice(workspace.profiles))
  const preview = usePreview(plate.draft?.id, plate.draft?.slice ?? null)
  return (
    <WorkspaceView
      plateKey={draftId}
      plate={plate}
      preview={preview}
      workspace={workspace}
      projects={projects}
      allowance={allowance}
      fromQueue={arrived?.unsubmitted === true}
      onCreated={(id) => {
        void navigate(`/dashboard/print/slicer/${id}`, { replace: true })
      }}
      onSent={(fileName) => {
        void navigate('/dashboard/print', { state: { sent: fileName } })
      }}
    />
  )
}

/** What the slicer training watches to tell when a practice task is done. */
export interface WorkspaceWatch {
  onState?: (state: { selected: string[]; selectSeveral: boolean; mode: PlateMode; tab: 'prepare' | 'preview' }) => void
  onCamera?: (view: CameraView) => void
  onLayers?: (layers: { top: number; count: number; z: number; hidden: Role[] }) => void
}

const PRINTING_LINK = (
  <Link
    to="/dashboard/print"
    className="text-dim hover:text-base-content inline-flex min-h-11 items-center gap-1 font-mono text-[11px] font-semibold tracking-[0.12em] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary wide:min-h-9"
  >
    <ChevronLeft className={iconSize} aria-hidden="true" /> PRINTING
  </Link>
)

/**
 * The slicer workspace: Orca's Prepare and Preview, for one build plate.
 *
 * Settings on the left, the plate in the middle, its objects on the right; on a phone the two
 * columns open as drawers over the plate. SLICE PLATE sends the plate to the slicer worker, and
 * REQUEST PRINT sends the sliced plate to the officers once it's current. Nothing here talks to a
 * printer: an officer prints it.
 *
 * `data-coach` names what the slicer training's callouts point at (`lib/training/aim.ts`).
 */
export function WorkspaceView({
  plateKey,
  plate,
  preview,
  workspace,
  projects,
  allowance,
  fromQueue = false,
  onCreated,
  onSent,
  back = PRINTING_LINK,
  watch,
  previewFocus,
  className = 'h-[calc(100dvh-var(--spacing-nav))] min-h-[30rem]',
}: {
  /** The plate's id, or undefined before its first upload. A new key starts undo over. */
  plateKey: string | undefined
  plate: PlateSource
  preview: PreviewLoad
  workspace: ApiSlicerWorkspace
  projects: ApiMyProject[]
  allowance: ApiPrintAllowance | null
  /** Arrived from the printing page's EDIT, which is said once. */
  fromQueue?: boolean
  /** The first upload made the draft. */
  onCreated?: (id: string) => void
  onSent: (fileName: string) => void
  /** The way out at the left of the top bar; null for none. */
  back?: ReactNode
  watch?: WorkspaceWatch
  /**
   * What PREVIEW opens looking at, instead of the whole bed: the training's part, so slices made
   * one after another open on the same close-up. A new object rebuilds the view.
   */
  previewFocus?: Focus
  /** The workspace's height. */
  className?: string
}) {
  const id = useId()
  const { draft, plate: local } = plate
  const models = draft?.models ?? []
  const { meshes } = useMeshes(models)
  // A plate whose printer was deleted is still drawn, on the first printer's bed, until it picks one.
  const bed = (printerOf(workspace.profiles, local.printerId) ?? workspace.profiles.printers[0]!).bed
  const objects = local.objects

  const [tab, setTab] = useState<'prepare' | 'preview'>('prepare')
  const [selected, setSelected] = useState<string[]>([])
  const [selectSeveral, setSelectSeveral] = useState(false)
  const [mode, setMode] = useState<PlateMode>('move')
  // UNIFORM or PER AXIS, which both the panel's boxes and the plate's handles keep to. A part starts
  // on whichever its scale already is, and keeps what was clicked for as long as it stays selected.
  const lone = selected.length === 1 ? objects.find((object) => object.id === selected[0]) : undefined
  const [scaleLock, setScaleLock] = useState<{ id: string; uniform: boolean } | null>(null)
  if (lone && scaleLock?.id !== lone.id) {
    setScaleLock({ id: lone.id, uniform: lone.sx === lone.sy && lone.sy === lone.sz })
  }
  const uniform = scaleLock?.uniform ?? true
  const [drawer, setDrawer] = useState<'settings' | 'objects' | null>(null)
  const drawerOpener = useRef<HTMLButtonElement | null>(null)
  const [problem, setProblem] = useState<{ title: string; message: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [slicing, setSlicing] = useState(false)
  const [sending, setSending] = useState<'closed' | 'open' | 'sending'>('closed')
  // Said once, on arriving from the printing page's EDIT.
  const [backFromQueue, setBackFromQueue] = useState(fromQueue)
  // Plates to step back to and forward to again, newest last.
  const history = useRef<{ back: ApiPlateObject[][]; forward: ApiPlateObject[][] }>({
    back: [],
    forward: [],
  })
  // A drag moves the plate as it goes (`plate.preview`), so undo takes it back to the plate from
  // before the drag began, not to its last frame.
  const beforeDrag = useRef<ApiPlateObject[] | null>(null)

  // Opening a drawer makes its button inert before the dialog can remember focus.
  useEffect(() => {
    if (drawer === null && drawerOpener.current) {
      drawerOpener.current.focus({ preventScroll: true })
      drawerOpener.current = null
    }
  }, [drawer])

  const problems = new Map<string, FitProblem>()
  const boxes = new Map<string, Box>()
  for (const object of objects) {
    const positions = meshes.get(object.modelId)
    if (!positions) continue
    boxes.set(object.id, boxOn(positions, object))
    const fit = fitOn(positions, object, bed)
    if (fit) problems.set(object.id, fit)
  }
  // Overlapping copies print fused. A warning, not a refusal: footprints are boxes, so an L with a
  // part in its corner reads as overlapping when it isn't.
  const warnings = new Map<string, PlateWarning>(problems)
  const placed = [...boxes.entries()]
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      if (!overlap(placed[i]![1], placed[j]![1])) continue
      for (const key of [placed[i]![0], placed[j]![0]]) if (!warnings.has(key)) warnings.set(key, 'overlaps')
    }
  }

  const slice = draft?.slice ?? null
  // A model whose copies were all deleted is kept for undo; it doesn't hold up a slice.
  const used = models.filter((model) => objects.some((object) => object.modelId === model.id))
  const converting = used.some((model) => model.meshState === 'QUEUED' || model.meshState === 'RUNNING')
  const unreadable = used.find((model) => model.meshState === 'FAILED')
  // Something an officer has hidden or deleted since, which the member has to pick again.
  const unchosen = choiceProblem(workspace.profiles, local, draft)
  const sliced = slice?.state === 'READY' && slice.current && !plate.unsaved && unchosen === null
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

  /** Remembers `before` as a step to undo back to. A new step ends anything there was to redo. */
  const remember = (before: ApiPlateObject[]) => {
    history.current = {
      back: [...history.current.back.slice(-(UNDO_DEPTH - 1)), before],
      forward: [],
    }
  }

  const setObjects = (next: ApiPlateObject[], before = objects) => {
    if (samePlate(next, before) && samePlate(next, objects)) return
    if (!samePlate(next, before)) remember(before)
    plate.edit({ objects: next })
  }

  const step = (direction: 'back' | 'forward') => {
    const { back, forward } = history.current
    const [from, to] = direction === 'back' ? [back, forward] : [forward, back]
    // A model kept for undo is deleted once a new upload needs its room; its copies can't return.
    const known = new Set(models.map((model) => model.id))
    const target = from.pop()?.filter((object) => known.has(object.modelId))
    if (!target) return
    to.push(objects)
    plate.edit({ objects: target })
    setSelected((current) => current.filter((key) => target.some((object) => object.id === key)))
  }
  const undo = () => {
    step('back')
  }
  const redo = () => {
    step('forward')
  }

  // A different plate starts with nothing to undo.
  useEffect(() => {
    history.current = { back: [], forward: [] }
  }, [plateKey])

  const report = useEffectEvent(() => {
    watch?.onState?.({ selected, selectSeveral, mode, tab })
  })
  useEffect(() => {
    report()
  }, [selected, selectSeveral, mode, tab])

  // A STEP lands in the middle of the plate because its shape isn't known until the worker meshes
  // it. Once it is, a copy sitting on top of another part moves to the nearest free spot.
  const meshing = useRef(new Set<string>())
  const waiting = models
    .filter((model) => model.meshState !== 'READY')
    .map((model) => model.id)
    .join(' ')
  const placeMeshed = useEffectEvent(() => {
    const ready = [...meshing.current].filter((modelId) => meshes.has(modelId))
    if (ready.length === 0) return
    let next = objects
    for (const modelId of ready) {
      meshing.current.delete(modelId)
      const positions = meshes.get(modelId)!
      for (const object of next.filter((o) => o.modelId === modelId)) {
        const mine = boxOn(positions, object)
        const others = next.flatMap((o) => {
          const other = o.id === object.id ? undefined : meshes.get(o.modelId)
          return other ? [boxOn(other, o)] : []
        })
        if (!others.some((box) => overlap(box, mine))) continue
        const spot = freeSpot(others, sizeOf(positions, object), bed)
        next = next.map((o) => (o.id === object.id ? { ...o, ...spot } : o))
      }
    }
    if (next !== objects && editable) plate.edit({ objects: next })
  })
  useEffect(() => {
    for (const modelId of waiting.split(' ')) if (modelId) meshing.current.add(modelId)
    placeMeshed()
  }, [meshes, waiting])

  const commit = (placements: ReadonlyMap<string, Partial<ApiPlacement>>) => {
    const before = beforeDrag.current ?? objects
    beforeDrag.current = null
    setObjects(
      objects.map((object) => (placements.has(object.id) ? { ...object, ...placements.get(object.id) } : object)),
      before,
    )
  }

  const change = (id: string, placement: Partial<ApiPlacement>) => commit(new Map([[id, placement]]))

  const drag = (placements: ReadonlyMap<string, Partial<ApiPlacement>>) => {
    beforeDrag.current ??= objects
    plate.preview(placements)
  }

  const add = async (files: File[]) => {
    setUploading(true)
    try {
      const taken = objects.flatMap((object) => {
        const positions = meshes.get(object.modelId)
        return positions ? [boxOn(positions, object)] : []
      })
      let before = objects
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
        // Undone, the new copy comes off and its model is kept, as for a deleted one.
        remember(before)
        before = next.objects
        const placed = next.objects.find((o) => o.id === object.id)
        if (placed && positions) {
          primeMesh(placed.modelId, positions)
          taken.push(boxOn(positions, placed))
        }
        if (!plateKey) onCreated?.(next.id)
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
    if (selected.length === 0) return
    setObjects(
      objects.map((object) => {
        if (!selected.includes(object.id)) return object
        const positions = meshes.get(object.modelId)
        if (!positions) return object
        return { ...object, ...canonicalQuat(autoOrient(positions, [object.sx, object.sy, object.sz])) }
      }),
    )
  }

  const flatten = (id: string, normal: [number, number, number]) => {
    const object = objects.find((o) => o.id === id)
    if (!object) return
    // The mode stays, as Orca's does, so another face can be tried.
    change(id, canonicalQuat(layFlat(object, normal)))
  }

  /** What LAY ON FACE is waiting for: an object, a face, or a turn it can't make. */
  const flatHint = () => {
    if (selected.length === 0) return 'Click or tap an object to see the faces it can lie on.'
    const faces = objects
      .filter((object) => selected.includes(object.id))
      .reduce((sum, object) => {
        const positions = meshes.get(object.modelId)
        return sum + (positions ? restingFaces(positions).length : 0)
      }, 0)
    return faces === 0
      ? 'No flat face to lie on. Turn it with ROTATE instead.'
      : 'Click or tap a highlighted face to put it down on the bed.'
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
    if (plate.canSubmit === false) return
    setSending('sending')
    try {
      const sent = await plate.submit(details)
      // The real workspace has navigated away by now; the practice one stays on the plate.
      setSending('closed')
      onSent(sent.fileName)
    } catch (error) {
      setSending('closed')
      setProblem({ title: `The plate wasn't sent`, message: explain(error, `It didn't go through. Try again in a moment.`) })
      if (error instanceof ApiError && error.status === 409) void plate.reload()
    }
  }

  // The view on either tab, while it's up: the view keys go to it.
  const camera = useRef<CameraMoves | null>(null)

  // Shortcuts, as in Orca. Never while typing, with a dialog or drawer open, or away from the plate.
  // The view keys (`viewKey`) only look, so they also work on PREVIEW and on a sent plate.
  const keys = useRef<(event: KeyboardEvent) => void>(() => undefined)
  useEffect(() => {
    keys.current = (event: KeyboardEvent) => {
      if (event.defaultPrevented || typing(event.target)) return
      if (problem || sending !== 'closed' || drawer || inDialog(event.target)) return
      if (onPlate(event.target) && viewKey(event, camera.current, false)) {
        event.preventDefault()
        return
      }
      if (tab !== 'prepare' || !editable) return
      if (event.key === 'Escape') {
        setSelected([])
        setMode('move')
        return
      }
      if (!onPlate(event.target)) return
      const ctrl = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if (ctrl && (key === 'y' || (key === 'z' && event.shiftKey))) {
        event.preventDefault()
        redo()
      } else if (ctrl && key === 'z') {
        event.preventDefault()
        undo()
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selected.length > 0) {
        event.preventDefault()
        remove()
      } else if (ctrl && event.key.toLowerCase() === 'd' && selected.length > 0) {
        event.preventDefault()
        copy()
      } else if (ctrl && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setSelected(objects.map((object) => object.id))
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
  const overlapping = [...warnings.values()].filter((w) => w === 'overlaps').length
  // Orca refuses these, or slices something else, and the worker would only say so after a wait.
  const vase = vaseRefusal(
    printerOf(workspace.profiles, local.printerId)?.processes.find((p) => p.id === local.processId)?.values ?? {},
    local.overrides,
    objects.length,
  )
  const sliceBlocked = !draft
    ? 'Add a model first.'
    : !editable
      ? null
      : objects.length === 0
        ? 'Put something on the plate first.'
        : unchosen
          ? unchosen
          : unreadable
            ? `${unreadable.fileName} couldn't be read. Remove it to slice the rest.`
            : converting
              ? 'A STEP file is still converting.'
              : placementWarning
                ? `${objects.find((o) => o.id === placementWarning[0])?.name ?? 'An object'} ${FIT_PROBLEM[placementWarning[1]]}.`
                : vase

  if (plate.load.status !== 'ready') return <Unavailable load={plate.load.status} onRetry={() => void plate.reload()} />

  const tabButton = (key: 'prepare' | 'preview', label: string) => (
    <button
      type="button"
      role="tab"
      id={`${id}-tab-${key}`}
      data-coach={`tab:${key}`}
      aria-selected={tab === key}
      aria-controls={`${id}-panel`}
      tabIndex={tab === key ? 0 : -1}
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

  const notice = plate.notice
    ? { text: plate.notice, dismiss: plate.clearNotice }
    : backFromQueue
      ? {
          text: `Taken back from the queue. Send it again when you're done, or it expires like any draft.`,
          dismiss: () => setBackFromQueue(false),
        }
      : null

  // The status line under the plate says why SLICE PLATE is off, unless a notice is up.
  const showsBlock = !notice && sliceBlocked !== null && objects.length > 0

  const drawerClass = (which: 'settings' | 'objects') =>
    `bg-base-100 border-rule min-h-0 overflow-y-auto ${
      drawer === which ? 'absolute inset-y-0 z-20 w-[min(22rem,100%)] shadow-2xl' : 'hidden'
    } ${which === 'settings' ? 'left-0 border-r' : 'right-0 border-l'} wide:static wide:block wide:shadow-none ${
      which === 'settings' ? 'wide:w-[20rem]' : 'wide:w-[17rem]'
    } wide:shrink-0`

  return (
    <div className={`flex flex-col ${className}`}>
      <header className="border-rule bg-base-100 flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5">
        {back}
        <div
          role="tablist"
          aria-label="Workspace"
          className="flex"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            const next = tab === 'prepare' ? 'preview' : 'prepare'
            setTab(next)
            document.getElementById(`${id}-tab-${next}`)?.focus()
          }}
        >
          {tabButton('prepare', 'PREPARE')}
          {tabButton('preview', 'PREVIEW')}
        </div>
        <div className="order-last flex min-w-0 basis-full items-center gap-2 wide:order-none wide:basis-auto wide:flex-1">
          <SliceSummary draft={draft} workerOnline={workspace.workerOnline} dirty={plate.unsaved} />
          {plate.saving && <span className="text-faint shrink-0 font-mono text-[10px] tracking-[0.12em]">SAVING…</span>}
        </div>
        <span className="ml-auto flex items-center gap-2 wide:ml-0">
          <button
            type="button"
            data-coach="slice"
            onClick={() => {
              void runSlice()
            }}
            disabled={!editable || slicing || slicingNow || sliceBlocked !== null}
            title={sliceBlocked ?? undefined}
            aria-describedby={showsBlock ? `${id}-status` : undefined}
            className={sliced ? quietButton : loudButton}
          >
            {slicing || slicingNow ? 'SLICING…' : 'SLICE PLATE'}
          </button>
          <button
            type="button"
            data-coach="request"
            onClick={() => {
              if (plate.canSubmit === false) return
              setSending('open')
            }}
            disabled={!editable || !sliced || plate.canSubmit === false}
            title={plate.canSubmit === false ? 'Practice requests are only available in Sending it to print.' : undefined}
            className={sliced && plate.canSubmit !== false ? loudButton : quietButton}
          >
            REQUEST PRINT
          </button>
        </span>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <Drawer label="Print settings" open={drawer === 'settings'} className={drawerClass('settings')} onClose={() => setDrawer(null)}>
          <SettingsPanel
            profiles={workspace.profiles}
            settings={local}
            disabled={!editable}
            onChange={(settings) => {
              plate.edit(settings)
            }}
          />
        </Drawer>

        <section
          id={`${id}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${tab}`}
          data-shortcuts
          data-coach="stage"
          inert={drawer !== null}
          // A canvas can't hold focus, so pressing on the plate brings it here; otherwise a
          // setting changed a moment ago keeps it and swallows Delete and the arrows.
          tabIndex={-1}
          onPointerDown={(event) => {
            if (event.target instanceof HTMLCanvasElement) event.currentTarget.focus({ preventScroll: true })
          }}
          className="relative min-w-0 flex-1 outline-none"
        >
          {tab === 'prepare' ? (
            <>
              <PlateView
                bed={bed}
                objects={objects}
                meshes={meshes}
                selected={selected}
                problems={problems}
                mode={editable ? mode : 'move'}
                selectSeveral={selectSeveral}
                uniformScale={uniform}
                onSelect={setSelected}
                onDrag={editable ? drag : () => undefined}
                onCommit={editable ? commit : () => undefined}
                onLayFlat={editable ? flatten : () => undefined}
                onView={watch?.onCamera}
                camera={camera}
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
                <p className="border-rule bg-base-100/90 absolute top-16 right-3 left-3 border px-3 py-1.5 text-[12px] wide:top-auto wide:right-auto wide:bottom-3 wide:left-1/2 wide:-translate-x-1/2">
                  {flatHint()}
                </p>
              )}
            </>
          ) : (
            <PreviewPane
              preview={preview}
              bed={bed}
              sliced={sliced}
              grams={slice?.estimatedGrams ?? null}
              failure={slice?.previewFailure ?? null}
              onExplore={watch?.onLayers}
              camera={camera}
              focus={previewFocus}
            />
          )}

          <span className="absolute top-3 left-3 flex gap-1.5 wide:hidden">
            <button
              type="button"
              data-coach="drawer:settings"
              onClick={(event) => {
                drawerOpener.current = event.currentTarget
                setDrawer('settings')
              }}
              className={`${quietButton} bg-base-100`}
            >
              SETTINGS
            </button>
            <button
              type="button"
              data-coach="drawer:objects"
              onClick={(event) => {
                drawerOpener.current = event.currentTarget
                setDrawer('objects')
              }}
              className={`${quietButton} bg-base-100`}
            >
              OBJECTS · {objects.length}
            </button>
          </span>
        </section>

        <Drawer label="Objects" open={drawer === 'objects'} className={drawerClass('objects')} onClose={() => setDrawer(null)} shortcuts>
          <ObjectPanel
            objects={objects}
            models={models}
            meshes={meshes}
            selected={selected}
            selectSeveral={selectSeveral}
            problems={warnings}
            disabled={!editable}
            uniform={uniform}
            onSelect={setSelected}
            onSelectSeveral={setSelectSeveral}
            onUniform={(on) => {
              if (lone) setScaleLock({ id: lone.id, uniform: on })
            }}
            onChange={change}
            onCopy={copy}
            onDelete={remove}
          />
        </Drawer>
      </div>

      <div
        id={`${id}-status`}
        role="status"
        aria-label="Plate status"
        className="border-rule bg-base-100 flex h-16 shrink-0 items-start justify-between gap-3 overflow-y-auto border-t px-4 py-2 text-[12.5px] leading-[1.5] wide:h-12"
      >
        <span className={notice ? 'text-base-content' : 'text-dim'}>
          {notice ? (
            notice.text
          ) : !editable ? (
            <>
              This plate has been sent.{' '}
              <Link to="/dashboard/print" className="text-primary underline underline-offset-2">
                Take it back from the printing page
              </Link>{' '}
              to change it.
            </>
          ) : showsBlock ? (
            sliceBlocked
          ) : overlapping > 0 ? (
            `${String(overlapping)} objects overlap and would print joined. Spread them out or press Arrange.`
          ) : null}
        </span>
        {notice && (
          <button
            type="button"
            onClick={notice.dismiss}
            aria-label="Dismiss"
            className="text-dim hover:text-base-content -m-1 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary wide:size-8"
          >
            <X className={iconSize} aria-hidden="true" />
          </button>
        )}
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
      <FormEyebrow>/ 3D PRINTING · SLICER</FormEyebrow>
      <FormHeading>{load === 'missing' ? 'No such plate.' : `The plate didn't load.`}</FormHeading>
      <p className="text-dim mb-4 max-w-[42rem] text-sm leading-[1.7]">
        {load === 'missing'
          ? 'It may have been discarded or expired.'
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

/**
 * A side column: always shown at `wide`, a drawer over the plate below it. Open as a drawer it
 * holds focus like a dialog (`useDialogFocus`): focus starts on Close, Tab stays inside, Escape
 * closes it and focus goes back to the button that opened it.
 */
function Drawer({
  label,
  open,
  className,
  shortcuts = false,
  onClose,
  children,
}: {
  label: string
  open: boolean
  className: string
  shortcuts?: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  // A drawer left open while the window widens past the breakpoint would trap focus in a column.
  useEffect(() => {
    if (!open || typeof matchMedia !== 'function') return
    const wide = matchMedia('(min-width: 56.25rem)')
    const close = () => {
      if (wide.matches) onClose()
    }
    close()
    wide.addEventListener('change', close)
    return () => {
      wide.removeEventListener('change', close)
    }
  }, [open, onClose])

  return (
    <aside aria-label={label} className={className} data-shortcuts={shortcuts || undefined}>
      {open ? <DrawerFocus onClose={onClose}>{children}</DrawerFocus> : children}
    </aside>
  )
}

function DrawerFocus({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  useDialogFocus(panel, close, onClose)
  return (
    <div ref={panel} role="dialog" aria-modal="true" className="contents">
      <div className="flex justify-end p-1">
        <button
          ref={close}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-dim hover:text-base-content inline-flex size-11 cursor-pointer items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <X className={iconSize} aria-hidden="true" />
        </button>
      </div>
      {children}
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
  grams,
  failure,
  onExplore,
  camera,
  focus,
}: {
  preview: PreviewLoad
  bed: ApiBed
  sliced: boolean
  grams: number | null
  /** Why a sliced plate has no preview, in the worker's words. */
  failure: string | null
  onExplore?: WorkspaceWatch['onLayers']
  camera: RefObject<CameraMoves | null>
  focus?: Focus
}) {
  if (preview.status === 'ready') {
    return <PreviewView bed={bed} preview={preview.preview} grams={grams} onExplore={onExplore} camera={camera} focus={focus} />
  }
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
