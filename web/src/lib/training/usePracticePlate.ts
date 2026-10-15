import { useEffect, useRef, useState } from 'react'
import type { ApiDraft, ApiDraftSlice, ApiPlacement, ApiPlateModel, ApiPlateObject } from '../api/api'
import { primeMesh } from '../slicer/meshes'
import { rotate } from '../slicer/orient'
import { boxOn } from '../slicer/plate'
import type { Box } from '../slicer/plateTransform'
import { settingDef } from '../slicer/processSettings'
import type { Focus } from '../slicer/scene'
import { MeshError, parseStl } from '../slicer/stl'
import type { Plate, PlateSource } from '../slicer/useDraft'
import { PRACTICE_PLA, PRACTICE_PRINTER, PRACTICE_STANDARD, PRACTICE_WORKSPACE } from './practiceProfiles'
import { type PartName, partOf, practiceModel } from './practiceParts'
import { type PreviewPlace, type SlicedWith, loadManifest, matchSlice, plateValues, slicedWith } from './practiceSlices'
import type { SliceLog } from './sliceLog'

/**
 * The training's plate: the workspace's `PlateSource`, kept in the browser. Nothing is uploaded,
 * saved or sliced. SLICE PLATE takes a moment, the way the real one does, and then shows the
 * ready-made slice matching the plate (`practiceSlices.ts`). Only the sending module allows
 * REQUEST PRINT, which simulates a request locally and sends nothing.
 *
 * A plate with no ready-made slice gets a notice, not a failed slice: the real slicer would have
 * sliced it, and most tasks start with a part practice can't slice.
 *
 * A task can set the plate up (`setUp`); otherwise it carries on from the last one, so what a
 * member did a step ago is still there. Each task keeps a log of its slices to compare.
 */

export interface PracticeSliceState extends PreviewPlace {
  name: string
  /** Settings the ready-made slice doesn't show. */
  ignored: string[]
  /** What the slice on show was made with, which a task's goals check. */
  with: SlicedWith
  /** The part with room around it for a brim, which PREVIEW opens on. */
  focus: Focus
}

/** Room around the part in the preview's opening view, for a brim and a skirt. */
const FOCUS_MARGIN = 10

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

const settingsOf = (plate: Plate): SlicedWith => ({
  processId: plate.processId ?? '',
  filamentId: plate.filamentId ?? '',
  values: plateValues(plate),
  upsideDown: plate.objects[0] ? rotate(plate.objects[0], [0, 0, 1])[2] < 0 : false,
})

export function usePracticePlate(parts: Map<PartName, Float32Array> | null, allowSubmission = false) {
  const [plate, setPlate] = useState<Plate>(() => ({ ...freshSettings(), objects: [] }))
  const [uploads, setUploads] = useState<ApiPlateModel[]>([])
  const [slice, setSlice] = useState<(ApiDraftSlice & { fingerprint: string }) | null>(null)
  const [sliced, setSliced] = useState<PracticeSliceState | null>(null)
  const [sent, setSent] = useState(0)
  const [log, setLog] = useState<SliceLog>({ start: null, slices: [] })
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
        ? `Practice slices are made ahead of time, and none has your change to ${ignored.join(', ')}. This is the nearest. The real slicer would show it.`
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
      const match = matchSlice(plate, await loadManifest())
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
      const made = match.slice
      const object = plate.objects[0]!
      const positions = parts?.get(partOf(object.modelId)!)
      const box: Box = positions ? boxOn(positions, object) : { min: [object.x, object.y, 0], max: [object.x, object.y, 20] }
      const focus: Focus = {
        min: [box.min[0] - FOCUS_MARGIN, box.min[1] - FOCUS_MARGIN, 0],
        max: [box.max[0] + FOCUS_MARGIN, box.max[1] + FOCUS_MARGIN, box.max[2]],
      }
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
        const settings = slicedWith(made)
        setSliced({ name: match.name, offset: match.offset, yaw: match.yaw, ignored: match.ignored, with: settings, focus })
        setLog((was) => ({
          ...was,
          slices: [
            ...was.slices,
            {
              ...settings,
              requestedAt,
              part: made.part,
              grams: made.grams,
              seconds: made.seconds,
              layers: made.layers,
              missing: match.ignored,
            },
          ],
        }))
      }, SLICE_DELAY)
    },
    submit: () => {
      if (!allowSubmission) return Promise.reject(new Error('Practice requests are only available in Sending it to print.'))
      setSent((count) => count + 1)
      setSentNotice(true)
      return Promise.resolve({ fileName: draft.fileName })
    },
    canSubmit: allowSubmission,
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
    /** This task's slices, oldest first. */
    log,
    /** A task's starting plate. Settings go back to the Standard preset unless it says otherwise. */
    setUp: (objects: ApiPlateObject[], settings: Partial<Omit<Plate, 'objects'>> = {}) => {
      if (timer.current) clearTimeout(timer.current)
      const next = { ...freshSettings(), ...settings, objects }
      setSentNotice(false)
      setUnsliced(null)
      setPlate(next)
      setSlice(null)
      setSliced(null)
      setLog({ start: settingsOf(next), slices: [] })
    },
  }
}

export type PracticePlate = ReturnType<typeof usePracticePlate>
