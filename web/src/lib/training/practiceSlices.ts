import { useEffect, useState } from 'react'
import { type Quat, multiply, rotate } from '../slicer/orient'
import { type Preview, ROLES, SEGMENT_FLOATS } from '../slicer/preview'
import type { SettingValue } from '../slicer/processSettings'
import type { Plate } from '../slicer/useDraft'
import { type PreviewLoad, decodePreview } from '../slicer/usePreview'
import { PRACTICE_PLA, PRACTICE_STANDARD, PRACTICE_WORKSPACE } from './practiceProfiles'
import { PARTS, type PartName, partOf } from './practiceParts'

/**
 * The slices the training shows: made ahead of time by the real Orca with the club's profiles
 * (`server/src/printing/trainingSlices.ts`), since the practice plate never reaches the slicer.
 *
 * The practice plate's SLICE PLATE shows the one made from the same part, the same way up, with
 * the same settings. Where there's none, it shows the nearest one that only leaves out some of the
 * member's changes, and the workspace names them rather than pretending they were sliced.
 */

export type Values = Record<string, SettingValue>

export interface PracticeSlice {
  part: string
  /** Where the part's middle was on the plate when it was sliced. */
  at: [number, number]
  /** How the part was turned, as a quaternion: x, y, z, w. */
  turn: [number, number, number, number]
  overrides: Values
  /** The process's and filament's names, which the practice profiles share. */
  process: string
  filament: string
  grams: number
  seconds: number
  meters: number | null
  layers: number | null
  /** Path under `public/training/`, or null where only the numbers were kept. */
  preview: string | null
}

export interface SliceManifest {
  orca: string
  slices: Record<string, PracticeSlice>
}

const base = `${import.meta.env.BASE_URL}training/`

let manifest: Promise<SliceManifest> | null = null

export function loadManifest(): Promise<SliceManifest> {
  manifest ??= fetch(`${base}slices.json`)
    .then(async (response) => {
      if (!response.ok) throw new Error(String(response.status))
      return (await response.json()) as SliceManifest
    })
    .catch((error: unknown) => {
      manifest = null
      throw error
    })
  return manifest
}

/** The manifest, once it's arrived. */
export function useManifest(): SliceManifest | null | 'failed' {
  const [loaded, setLoaded] = useState<SliceManifest | null | 'failed'>(null)
  useEffect(() => {
    let live = true
    loadManifest().then(
      (value) => {
        if (live) setLoaded(value)
      },
      () => {
        if (live) setLoaded('failed')
      },
    )
    return () => {
      live = false
    }
  }, [])
  return loaded
}

const PRINTER = PRACTICE_WORKSPACE.profiles.printers[0]!

const processValues = (id: string | null): Values => PRINTER.processes.find((process) => process.id === id)?.values ?? {}

/** What a slice was made with, in the practice plate's terms. */
export interface SlicedWith {
  processId: string
  filamentId: string
  /** Every setting members can change, as the slice had it. */
  values: Values
  upsideDown: boolean
}

const quat = ([qx, qy, qz, qw]: [number, number, number, number]): Quat => ({ qx, qy, qz, qw })

export function slicedWith(slice: PracticeSlice): SlicedWith {
  const process = PRINTER.processes.find((p) => p.name === slice.process)
  return {
    processId: process?.id ?? slice.process,
    filamentId: PRACTICE_WORKSPACE.profiles.filaments.find((f) => f.name === slice.filament)?.id ?? slice.filament,
    values: { ...process?.values, ...slice.overrides },
    upsideDown: rotate(quat(slice.turn), [0, 0, 1])[2] < 0,
  }
}

/** The plate's settings the same way. */
export const plateValues = (plate: Pick<Plate, 'processId' | 'overrides'>): Values => ({
  ...processValues(plate.processId),
  ...(plate.overrides as Values),
})

const SUPPORT_DETAIL = ['support_type', 'support_threshold_angle', 'support_on_build_plate_only']

/** Nothing on these hangs over, so Orca slices them the same with supports on or off. */
const NOTHING_TO_SUPPORT: ReadonlySet<string> = new Set<PartName>(['tower', 'block'])

/**
 * `values` without the settings that can't change the slice: the support type with supports off,
 * the brim's width with no brim, the infill pattern with no infill. Set-ups that differ only in
 * those slice the same.
 */
export function comparable(values: Values, part?: string): Values {
  const out = { ...values }
  const drop = (...keys: string[]) => {
    for (const key of keys) delete out[key]
  }
  if (out['enable_support'] === false) drop(...SUPPORT_DETAIL)
  if (part !== undefined && NOTHING_TO_SUPPORT.has(part)) drop('enable_support', ...SUPPORT_DETAIL)
  if (out['brim_type'] === 'no_brim' || out['brim_width'] === 0) drop('brim_type', 'brim_width')
  if (out['sparse_infill_density'] === 0) drop('sparse_infill_pattern')
  return out
}

export const same = (a: SettingValue | undefined, b: SettingValue | undefined) =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : a === b

/** The settings `a` and `b` don't agree on. */
export function differences(a: Values, b: Values): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => !same(a[key], b[key]))
}

/**
 * The turn about the vertical that takes a part as it was sliced to `object`, in radians, or null
 * when they aren't the same way up.
 */
function yawTo(turn: PracticeSlice['turn'], object: Quat): number | null {
  const sliced = quat(turn)
  const [ax, ay, az] = rotate(sliced, [0, 0, 1])
  const [bx, by, bz] = rotate(object, [0, 0, 1])
  if (ax * bx + ay * by + az * bz < 0.995) return null
  const across = rotate(multiply(object, { qx: -sliced.qx, qy: -sliced.qy, qz: -sliced.qz, qw: sliced.qw }), [1, 0, 0])
  return Math.atan2(across[1], across[0])
}

const listed = (names: string[]) =>
  names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`

export type SliceMatch =
  | {
      name: string
      slice: PracticeSlice
      /** The member's changes it doesn't show, by setting key, or `process` or `filament`. */
      ignored: string[]
      /** How far the part is from where it was sliced, and turned about the vertical. */
      offset: [number, number]
      yaw: number
    }
  | { problem: string }

/** Which ready-made slice the plate is, or why there isn't one. */
export function matchSlice(plate: Plate, made: SliceManifest): SliceMatch {
  const entries = Object.entries(made.slices)
  const sliceable = [...new Set(entries.map(([, slice]) => slice.part))]
  const parts = plate.objects.map((object) => partOf(object.modelId))
  if (!parts.some((part) => part !== null && sliceable.includes(part))) {
    // Most tasks before the settings chapters put a cube or a bracket on the plate.
    const names = sliceable.flatMap((part) => (part in PARTS ? [PARTS[part as PartName].name.toLowerCase()] : []))
    return {
      problem: `Practice only slices the ${listed(names)}, so nothing was sliced. The real slicer would slice this plate.`,
    }
  }
  if (plate.objects.length > 1) return { problem: 'Practice only slices one part on its own. Delete everything else to slice it.' }

  const object = plate.objects[0]!
  const part = parts[0]!
  const name = PARTS[part].name.toLowerCase()
  if ([object.sx, object.sy, object.sz].some((s) => Math.abs(s - 1) > 0.001)) {
    return { problem: `Practice slices are made at 100% size. Put the ${name}’s scale back to 100%.` }
  }
  const candidates = entries.flatMap(([key, slice]) => {
    const yaw = slice.part === part ? yawTo(slice.turn, object) : null
    return yaw === null ? [] : [{ name: key, slice, yaw }]
  })
  if (candidates.length === 0) {
    const flipped = entries.some(([, slice]) => slice.part === part && slicedWith(slice).upsideDown)
    return {
      problem: flipped
        ? `Stand the ${name} up or turn it upside down. Practice slices exist for those two.`
        : `Practice only slices the ${name} the way up it started. Press RESET beside ROTATION.`,
    }
  }

  const raw = plateValues(plate)
  // Orca refuses this outright, so the real slicer would fail too.
  if (raw['spiral_mode'] === true && raw['enable_support'] === true) {
    return { problem: 'The slicer won’t make a vase with Supports on. Switch Supports off in the Support tab.' }
  }
  const mine = comparable(raw, part)
  const fresh = comparable(processValues(PRACTICE_STANDARD), part)
  let best: ((typeof candidates)[number] & { diff: string[] }) | null = null
  for (const candidate of candidates) {
    const theirs = slicedWith(candidate.slice)
    const values = comparable(theirs.values, part)
    const diff = differences(mine, values)
    if (theirs.processId !== plate.processId) diff.push('process')
    if (theirs.filamentId !== plate.filamentId) diff.push('filament')
    // A stand-in may only leave the member's changes out: wherever it differs from the plate, it
    // has what a fresh plate has, so the notice can say which changes it doesn't show.
    const standsIn = diff.every((key) =>
      key === 'process'
        ? theirs.processId === PRACTICE_STANDARD
        : key === 'filament'
          ? theirs.filamentId === PRACTICE_PLA
          : same(values[key], fresh[key]),
    )
    if (standsIn && (!best || diff.length < best.diff.length)) best = { ...candidate, diff }
  }
  if (!best) {
    return { problem: `Practice has no slice of the ${name} set up like this. The real slicer would slice it.` }
  }
  // Settings that changed with the process aren't the member's own changes; "the process" covers them.
  const ignored = best.diff.filter((key) => key === 'process' || key === 'filament' || key in plate.overrides)
  return {
    name: best.name,
    slice: best.slice,
    ignored,
    offset: [object.x - best.slice.at[0], object.y - best.slice.at[1]],
    yaw: best.yaw,
  }
}

/**
 * Puts a preview's paths where the part is: turned by `yaw` about `at`, where it was sliced, then
 * moved by `offset`. Changes `preview` in place.
 */
export function placePreview(preview: Preview, at: [number, number], [dx, dy]: [number, number], yaw: number): Preview {
  const turned = Math.abs(yaw) > 1e-9
  if (!turned && dx === 0 && dy === 0) return preview
  const [cx, cy] = at
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const move = (x: number, y: number): [number, number] =>
    turned
      ? [cx + cos * (x - cx) - sin * (y - cy) + dx, cy + sin * (x - cx) + cos * (y - cy) + dy]
      : [x + dx, y + dy]
  for (const role of ROLES) {
    const { segments, layerStart } = preview.roles[role]
    const count = layerStart.at(-1) ?? 0
    for (let i = 0; i < count; i++) {
      const at = i * SEGMENT_FLOATS
      const [x0, y0] = move(segments[at]!, segments[at + 1]!)
      const [x1, y1] = move(segments[at + 2]!, segments[at + 3]!)
      segments[at] = x0
      segments[at + 1] = y0
      segments[at + 2] = x1
      segments[at + 3] = y1
    }
  }
  const { min, max } = preview.bounds
  const corners = [move(min[0], min[1]), move(max[0], min[1]), move(min[0], max[1]), move(max[0], max[1])]
  const xs = corners.map(([x]) => x)
  const ys = corners.map(([, y]) => y)
  return {
    ...preview,
    bounds: { min: [Math.min(...xs), Math.min(...ys), min[2]], max: [Math.max(...xs), Math.max(...ys), max[2]] },
  }
}

/** Where a preview goes: moved and turned from where it was sliced. */
export interface PreviewPlace {
  offset: [number, number]
  yaw: number
}

const WHERE_SLICED: PreviewPlace = { offset: [0, 0], yaw: 0 }

/** A ready-made slice's preview, or nothing while `name` is null. `key` changes on each slice. */
export function usePracticePreview(name: string | null, place: PreviewPlace, key: string | null): PreviewLoad {
  const [load, setLoad] = useState<PreviewLoad>({ status: 'none' })
  const [dx, dy] = place.offset
  const { yaw } = place
  useEffect(() => {
    if (!name || !key) {
      setLoad({ status: 'none' })
      return
    }
    let live = true
    setLoad({ status: 'loading' })
    void (async () => {
      try {
        const slice = (await loadManifest()).slices[name]
        if (!slice?.preview) throw new Error(`no preview for ${name}`)
        const response = await fetch(`${base}${slice.preview}`)
        if (!response.ok) throw new Error(String(response.status))
        const preview = placePreview(await decodePreview(await response.arrayBuffer()), slice.at, [dx, dy], yaw)
        if (live) setLoad({ status: 'ready', preview })
      } catch {
        if (live) setLoad({ status: 'failed', message: `The practice preview didn't load. Try slicing again.` })
      }
    })()
    return () => {
      live = false
    }
  }, [name, key, dx, dy, yaw])
  return load
}

/** A ready-made slice's preview for a lesson, as it was sliced. */
export function useLessonPreview(name: string): PreviewLoad {
  return usePracticePreview(name, WHERE_SLICED, name)
}
