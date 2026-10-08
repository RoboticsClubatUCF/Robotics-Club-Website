import { useEffect, useState } from 'react'
import { rotate } from '../slicer/orient'
import { type Preview, ROLES, SEGMENT_FLOATS } from '../slicer/preview'
import type { Plate } from '../slicer/useDraft'
import { type PreviewLoad, decodePreview } from '../slicer/usePreview'
import { PRACTICE_STANDARD, PRACTICE_PLA, standardValue } from './practiceProfiles'
import { modelIdOf } from './practiceParts'

/**
 * The slices the training shows: made ahead of time by the real Orca with the club's profiles
 * (`server/src/printing/trainingSlices.ts`), since the practice plate never reaches the slicer.
 *
 * The practice plate's SLICE PLATE picks the one made with the same set-up as the plate: the
 * mushroom standing up or upside down, its supports and whether it has a brim. Other settings
 * don't have slices of their own, and the workspace says so rather than pretending they did.
 */

export interface PracticeSlice {
  part: string
  /** Where the part's middle was on the plate when it was sliced. */
  at: [number, number]
  overrides: Record<string, number | boolean | string>
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

const setting = (plate: Plate, key: string) => plate.overrides[key] ?? standardValue(key)

export type SliceMatch =
  | { name: string; ignored: string[]; offset: [number, number] }
  | { problem: string }

/** Which ready-made slice the plate is, or why there isn't one. */
export function matchSlice(plate: Plate): SliceMatch {
  const [only, ...rest] = plate.objects
  if (!only || rest.length > 0 || only.modelId !== modelIdOf('mushroom')) {
    return { problem: 'Practice slicing only knows the mushroom, on its own. Delete everything else on the plate.' }
  }
  if ([only.sx, only.sy, only.sz].some((s) => Math.abs(s - 1) > 0.001)) {
    return { problem: 'Practice slices are made at 100% size. Put the mushroom’s scale back to 100%.' }
  }
  const up = rotate(only, [0, 0, 1])[2]
  if (Math.abs(up) < 0.995) {
    return { problem: 'Stand the mushroom up or turn it upside down. Practice slices exist for those two.' }
  }
  const supports = setting(plate, 'enable_support') === true
  const tree = setting(plate, 'support_type') === 'tree(auto)'
  const brim = setting(plate, 'brim_type') !== 'no_brim' && Number(setting(plate, 'brim_width')) > 0
  const name =
    up > 0
      ? `mushroom-up-${supports ? (tree ? 'tree' : 'normal') : 'none'}${brim ? '-brim' : ''}`
      : `mushroom-down${brim ? '-brim' : ''}`

  const used = new Set(['enable_support', 'support_type', 'brim_type', 'brim_width'])
  const ignored = Object.keys(plate.overrides).filter((key) => !used.has(key))
  if (plate.processId !== PRACTICE_STANDARD) ignored.push('process')
  if (plate.filamentId !== PRACTICE_PLA) ignored.push('filament')
  return { name, ignored, offset: [only.x - 128, only.y - 128] }
}

/** Moves every path in a preview across the plate, so a slice made in the middle sits where the part is. */
export function shiftPreview(preview: Preview, [dx, dy]: [number, number]): Preview {
  if (dx === 0 && dy === 0) return preview
  for (const role of ROLES) {
    const { segments, layerStart } = preview.roles[role]
    const count = layerStart.at(-1) ?? 0
    for (let i = 0; i < count; i++) {
      const at = i * SEGMENT_FLOATS
      segments[at] = segments[at]! + dx
      segments[at + 1] = segments[at + 1]! + dy
      segments[at + 2] = segments[at + 2]! + dx
      segments[at + 3] = segments[at + 3]! + dy
    }
  }
  const { min, max } = preview.bounds
  return {
    ...preview,
    bounds: { min: [min[0] + dx, min[1] + dy, min[2]], max: [max[0] + dx, max[1] + dy, max[2]] },
  }
}

/** A ready-made slice's preview, or nothing while `name` is null. `key` changes on each slice. */
export function usePracticePreview(name: string | null, offset: [number, number], key: string | null): PreviewLoad {
  const [load, setLoad] = useState<PreviewLoad>({ status: 'none' })
  const [dx, dy] = offset
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
        const preview = shiftPreview(await decodePreview(await response.arrayBuffer()), [dx, dy])
        if (live) setLoad({ status: 'ready', preview })
      } catch {
        if (live) setLoad({ status: 'failed', message: `The practice preview didn't load. Try slicing again.` })
      }
    })()
    return () => {
      live = false
    }
  }, [name, key, dx, dy])
  return load
}

/** A ready-made slice's preview for a lesson, as it was sliced. */
export function useLessonPreview(name: string): PreviewLoad {
  return usePracticePreview(name, [0, 0], name)
}
