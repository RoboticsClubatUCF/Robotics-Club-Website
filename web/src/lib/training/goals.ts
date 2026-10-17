import type { ApiDraftSlice, ApiPlateObject } from '../api/api'
import type { PlateMode } from '../../components/slicer/PlateView'
import { boxOn, fitOn } from '../slicer/plate'
import { rotate, type RotationChange } from '../slicer/orient'
import type { Bed } from '../slicer/plateTransform'
import type { Role } from '../slicer/preview'
import type { SettingValue } from '../slicer/processSettings'
import type { CameraView } from '../slicer/scene'
import type { Plate } from '../slicer/useDraft'
import type { Aim } from './aim'
import { PRACTICE_WORKSPACE } from './practiceProfiles'
import { same } from './practiceSlices'
import type { PracticeSliceState } from './usePracticePlate'

/**
 * What a practice task can see, and the checks its goals are made of. A goal is done once its
 * check passes; the task runs them in order and doesn't take one back, so "delete one, then undo"
 * is two goals.
 */

export interface PracticeState {
  plate: Plate
  selected: string[]
  /** SELECT SEVERAL is on, so a tap adds a part rather than picking it alone. */
  selectSeveral: boolean
  mode: PlateMode
  tab: 'prepare' | 'preview'
  camera: CameraView | null
  /** The preview's layer slider and PATHS, for the slice on show only. `z` is the top layer's height. */
  layers: { top: number; count: number; z: number; hidden: Role[] } | null
  /** Meshes by model id. */
  meshes: ReadonlyMap<string, Float32Array>
  slice: (ApiDraftSlice & { current: boolean }) | null
  sliced: PracticeSliceState | null
  /** How many times the plate has been "sent". */
  sent: number
  bed: Bed
  /** Deliberate axis turns during this task, in degrees, reset by ROTATION RESET. */
  rotations?: RotationProgress
}

export type RotationProgress = Record<string, { x: number; y: number; z: number }>

export function trackRotation(progress: RotationProgress, change: RotationChange): RotationProgress {
  const next = { ...progress }
  if ('reset' in change) {
    delete next[change.objectId]
  } else {
    const before = next[change.objectId] ?? { x: 0, y: 0, z: 0 }
    next[change.objectId] = { ...before, [change.axis]: before[change.axis] + change.degrees }
  }
  return next
}

/** Scratch space a task's goals share, emptied when the task starts. */
export type Memory = Record<string, unknown>

export interface Goal {
  text: string
  done: (state: PracticeState, memory: Memory) => boolean
  /** Needs the 3D view. Counted as done in a browser that can't draw it. */
  needs3d?: boolean
  /** What an experiment slices. A test checks each has a ready-made slice of its own. */
  wants?: Want[]
  /** Where the task points while this is the next goal (`aim.ts`). Without one it just says it. */
  aim?: Aim[] | ((state: PracticeState) => Aim[])
}

export const objectOf = (state: PracticeState, id: string): ApiPlateObject | undefined =>
  state.plate.objects.find((object) => object.id === id)

/** Where one of the part's own directions points on the plate. */
export const pointing = (object: ApiPlateObject, direction: [number, number, number]) =>
  rotate(object, direction)

export const near = (a: number, b: number, within: number) => Math.abs(a - b) <= within

/** Lies on the face whose outward direction, in the part's own terms, is `face`. */
export function restsOn(object: ApiPlateObject | undefined, face: [number, number, number]): boolean {
  return !!object && pointing(object, face)[2] < -0.995
}

export function fits(state: PracticeState, id: string): boolean {
  const object = objectOf(state, id)
  const positions = object && state.meshes.get(object.modelId)
  return !!object && !!positions && fitOn(positions, object, state.bed) === null
}

/** Width, depth and height on the plate, in mm. */
export function sizeOf(state: PracticeState, id: string): [number, number, number] | null {
  const object = objectOf(state, id)
  const positions = object && state.meshes.get(object.modelId)
  if (!object || !positions) return null
  const box = boxOn(positions, object)
  return [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]]
}

export function anyOverlap(state: PracticeState): boolean {
  const boxes = state.plate.objects.flatMap((object) => {
    const positions = state.meshes.get(object.modelId)
    return positions ? [boxOn(positions, object)] : []
  })
  return boxes.some((a, i) =>
    boxes.some(
      (b, j) =>
        j > i && a.min[0] < b.max[0] && b.min[0] < a.max[0] && a.min[1] < b.max[1] && b.min[1] < a.max[1],
    ),
  )
}

/** A setting as the plate has it: the member's value, or the chosen process's own. */
export function setting(state: PracticeState, key: string): number | boolean | string | undefined {
  const changed = state.plate.overrides[key]
  if (changed !== undefined) return changed
  const process = PRACTICE_WORKSPACE.profiles.printers
    .flatMap((printer) => printer.processes)
    .find((p) => p.id === state.plate.processId)
  return process?.values[key]
}

export const changed = (state: PracticeState, key: string) => state.plate.overrides[key] !== undefined

/** The camera's offset from what it turns about, and how far away it is. */
export function cameraOffset(state: PracticeState): { direction: [number, number, number]; distance: number } | null {
  if (!state.camera) return null
  const { position, target } = state.camera
  const offset = [0, 1, 2].map((axis) => position[axis]! - target[axis]!) as [number, number, number]
  const distance = Math.hypot(...offset)
  if (distance === 0) return null
  return { direction: offset.map((value) => value / distance) as [number, number, number], distance }
}

/** The direction the plate opens looking from (`frameBed` in `lib/slicer/scene.ts`). */
const OPENING = (() => {
  const offset = [0, -1.55, 1.3]
  const length = Math.hypot(...offset)
  return offset.map((value) => value / length)
})()

export function atOpeningView(state: PracticeState): boolean {
  const view = cameraOffset(state)
  if (!view || !state.camera) return false
  const [tx, ty, tz] = state.camera.target
  const facing = view.direction.reduce((sum, value, axis) => sum + value * OPENING[axis]!, 0)
  return near(tx, state.bed.width / 2, 1) && near(ty, state.bed.depth / 2, 1) && near(tz, 0, 1) && facing > 0.999
}

export const isSliced = (state: PracticeState) =>
  state.slice?.state === 'READY' && state.slice.current && state.sliced !== null


/** A setting's value in the chosen process, before the member changes it. */
export function processValue(state: PracticeState, key: string): SettingValue | undefined {
  return PRACTICE_WORKSPACE.profiles.printers
    .flatMap((printer) => printer.processes)
    .find((p) => p.id === state.plate.processId)?.values[key]
}

/**
 * What a practice task asks for: a setting by its key, or `process` or `filament` by the practice
 * profile's id.
 */
export type Want = [key: string, value: SettingValue]

/** The plate is set up the way `want` says. */
export function plateHas(state: PracticeState, [key, value]: Want): boolean {
  if (key === 'process') return state.plate.processId === value
  if (key === 'filament') return state.plate.filamentId === value
  return same(setting(state, key), value)
}

/** The slice on show, still current, was made the way `want` says. */
export function slicedHas(state: PracticeState, [key, value]: Want): boolean {
  if (!isSliced(state)) return false
  const made = state.sliced!.with
  if (key === 'process') return made.processId === value
  if (key === 'filament') return made.filamentId === value
  return same(made.values[key], value)
}

/** Where a task asks for the layer slider: layer 1, about halfway up, or a height in mm. */
export type Look = 'bottom' | 'middle' | { from: number; to: number }

export function looking(state: PracticeState, look: Look): boolean {
  const { layers } = state
  if (state.tab !== 'preview' || !layers) return false
  if (look === 'bottom') return layers.top === 0
  if (look === 'middle') return layers.top >= layers.count * 0.25 && layers.top <= layers.count * 0.75
  return layers.z >= look.from - 1e-6 && layers.z <= look.to + 1e-6
}
