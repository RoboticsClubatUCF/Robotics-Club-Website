import { useEffect, useRef, useState } from 'react'
import type { ApiDraft, ApiDraftSlice, ApiPlacement, ApiPlateModel, ApiPlateObject } from '../api/api'
import { primeMesh } from '../slicer/meshes'
import { settingDef } from '../slicer/processSettings'
import { MeshError, parseStl } from '../slicer/stl'
import type { Plate, PlateSource } from '../slicer/useDraft'
import { PRACTICE_PLA, PRACTICE_PRINTER, PRACTICE_STANDARD, PRACTICE_WORKSPACE } from './practiceProfiles'
import { type PartName, practiceModel } from './practiceParts'
import { loadManifest, matchSlice } from './practiceSlices'

/**
 * The training's plate: the workspace's `PlateSource`, kept in the browser. Nothing is uploaded,
 * saved or sliced. SLICE PLATE takes a moment, the way the real one does, and then shows the
 * ready-made slice matching the plate (`practiceSlices.ts`); REQUEST PRINT sends nothing.
 *
 * A plate with no ready-made slice gets a notice, not a failed slice: the real slicer would have
 * sliced it, and most tasks start with a part practice can't slice.
 *
 * A task can set the plate up (`setUp`); otherwise it carries on from the last one, so what a
 * member did a step ago is still there.
 */

export interface PracticeSliceState {
  name: string
  offset: [number, number]
  /** Settings the ready-made slice doesn't show. */
  ignored: string[]
}

/** How long a practice slice "takes". Long enough to see SLICING…, short enough not to wait on. */
const SLICE_DELAY = 1_200

export const freshSettings = (): Omit<Plate, 'objects'> => ({
  printerId: PRACTICE_PRINTER,
  processId: PRACTICE_STANDARD,
  filamentId: PRACTICE_PLA,
  overrides: {},
})

const fingerprint = (plate: Plate) => JSON.stringify(plate)

const labelOf = (id: string | null, list: { id: string; label: string }[]) =>
  list.find((item) => item.id === id)?.label ?? ''

export function usePracticePlate(parts: Map<PartName, Float32Array> | null) {
  const [plate, setPlate] = useState<Plate>(() => ({ ...freshSettings(), objects: [] }))
  const [uploads, setUploads] = useState<ApiPlateModel[]>([])
  const [slice, setSlice] = useState<(ApiDraftSlice & { fingerprint: string }) | null>(null)
  const [sliced, setSliced] = useState<PracticeSliceState | null>(null)
  const [sent, setSent] = useState(0)
  // The notice about settings a ready-made slice doesn't show, put away for this slice.
  const [dismissed, setDismissed] = useState<string | null>(null)
  // Why SLICE PLATE made nothing, for as long as the plate is the one it was pressed on.
  const [unsliced, setUnsliced] = useState<{ problem: string; fingerprint: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const models: ApiPlateModel[] = [
    ...(parts ? [...parts].map(([part, positions]) => practiceModel(part, positions)) : []),
    ...uploads,
  ]
  const current = slice !== null && slice.fingerprint === fingerprint(plate)
  const showing = current && slice.state === 'READY' ? sliced : null
  const ignored = showing?.ignored.map((key) =>
    key === 'process' ? 'the process' : key === 'filament' ? 'the filament' : (settingDef(key)?.label ?? key),
  )
  const [sentNotice, setSentNotice] = useState(false)
  const unslicedNow = unsliced !== null && unsliced.fingerprint === fingerprint(plate)
  const notice = sentNotice
    ? 'Practice only, so nothing was sent. The real slicer takes you to the printing page, with the plate in your list as WAITING.'
    : unslicedNow
      ? unsliced.problem
      : ignored && ignored.length > 0 && dismissed !== slice?.requestedAt
        ? `Practice slices are made ahead of time for the mushroom's supports and brim. This one doesn't show your change to ${ignored.join(', ')}; the real slicer would.`
        : null
  const printer = PRACTICE_WORKSPACE.profiles.printers[0]!

  const draft: ApiDraft = {
    id: 'practice',
    status: 'DRAFT',
    revision: 1,
    printerId: plate.printerId,
    processId: plate.processId,
    filamentId: plate.filamentId,
    slicedWith: {
      printer: printer.label,
      process: labelOf(plate.processId, printer.processes),
      filament: labelOf(plate.filamentId, PRACTICE_WORKSPACE.profiles.filaments),
    },
    overrides: plate.overrides as Record<string, number | boolean | string>,
    fileName: plate.objects[0]?.name ?? 'Practice plate',
    notes: null,
    projectId: null,
    createdAt: new Date(0).toISOString(),
    draftActiveAt: null,
    submittedAt: null,
    startedAt: null,
    expiresAt: null,
    models,
    objects: plate.objects,
    slice: slice ? { ...slice, current } : null,
  }

  const edit = (change: Partial<Plate>) => {
    setPlate((was) => ({ ...was, ...change }))
  }

  const source: PlateSource = {
    load: { status: 'ready' },
    draft,
    plate,
    edit,
    preview: (placements: ReadonlyMap<string, Partial<ApiPlacement>>) => {
      setPlate((was) => ({
        ...was,
        objects: was.objects.map((object) => (placements.has(object.id) ? { ...object, ...placements.get(object.id) } : object)),
      }))
    },
    reload: () => Promise.resolve(),
    addModel: async (file: File, object: { id: string } & ApiPlacement) => {
      if (!file.name.toLowerCase().endsWith('.stl')) {
        throw new MeshError('Practice takes STL files only. The real slicer takes STEP files too.')
      }
      const positions = parseStl(new Uint8Array(await file.arrayBuffer()))
      const model: ApiPlateModel = {
        id: `upload-${object.id}`,
        fileName: file.name,
        fileSize: file.size,
        meshState: 'READY',
        meshFailure: null,
        triangles: positions.length / 9,
      }
      primeMesh(model.id, positions)
      const added: ApiPlateObject = { ...object, modelId: model.id, name: file.name.replace(/\.stl$/i, '') }
      const next = { ...plate, objects: [...plate.objects, added] }
      setUploads((was) => [...was, model])
      setPlate(next)
      return { ...draft, models: [...models, model], objects: next.objects }
    },
    slice: async () => {
      const match = matchSlice(plate)
      const requestedAt = new Date().toISOString()
      const base: ApiDraftSlice & { fingerprint: string } = {
        state: 'RUNNING',
        current: true,
        failure: null,
        retryable: true,
        estimatedGrams: null,
        estimatedSeconds: null,
        filamentMeters: null,
        layerCount: null,
        hasPreview: false,
        previewFailure: null,
        requestedAt,
        fingerprint: fingerprint(plate),
      }
      if ('problem' in match) {
        setSentNotice(false)
        setUnsliced({ problem: match.problem, fingerprint: base.fingerprint })
        return
      }
      const made = (await loadManifest()).slices[match.name]
      if (!made) throw new Error(`no practice slice called ${match.name}`)
      setUnsliced(null)
      setSliced(null)
      setSlice(base)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        setSlice({
          ...base,
          state: 'READY',
          estimatedGrams: made.grams,
          estimatedSeconds: made.seconds,
          filamentMeters: made.meters,
          layerCount: made.layers,
          hasPreview: made.preview !== null,
        })
        setSliced({ name: match.name, offset: match.offset, ignored: match.ignored })
      }, SLICE_DELAY)
    },
    submit: () => {
      setSent((count) => count + 1)
      setSentNotice(true)
      return Promise.resolve({ fileName: draft.fileName })
    },
    saving: false,
    unsaved: false,
    notice,
    clearNotice: () => {
      if (sentNotice) setSentNotice(false)
      else if (unslicedNow) setUnsliced(null)
      else setDismissed(slice?.requestedAt ?? null)
    },
  }

  return {
    source,
    /** The ready-made slice on show, while it's still the plate's. */
    sliced: showing,
    sliceState: slice ? { ...slice, current } : null,
    /** How many times REQUEST PRINT has been pressed and confirmed. */
    sent,
    /** A task's starting plate. Settings go back to the Standard preset unless it says otherwise. */
    setUp: (objects: ApiPlateObject[], settings: Partial<Omit<Plate, 'objects'>> = {}) => {
      if (timer.current) clearTimeout(timer.current)
      setSentNotice(false)
      setUnsliced(null)
      setPlate({ ...freshSettings(), ...settings, objects })
      setSlice(null)
      setSliced(null)
    },
  }
}

export type PracticePlate = ReturnType<typeof usePracticePlate>
