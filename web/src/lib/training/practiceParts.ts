import type { ApiPlateModel, ApiPlateObject } from '../api/api'
import { primeMesh } from '../slicer/meshes'
import { type Quat, multiply } from '../slicer/orient'
import { parseStl } from '../slicer/stl'

/**
 * The practice parts, made by `server/src/printing/trainingSlices.ts` and served with the site
 * from `public/training/parts/`. They go into the workspace's mesh cache under their model ids, so
 * the plate draws them the way it draws a member's upload.
 */

export const PARTS = {
  cube: { name: 'Cube', size: '20 mm' },
  bracket: { name: 'Bracket', size: '40 × 24 × 30 mm' },
  mushroom: { name: 'Mushroom', size: '30 mm across, 19 mm tall' },
  tower: { name: 'Tower', size: '8 mm across, 60 mm tall' },
  block: { name: 'Block', size: '30 × 30 × 12 mm' },
} as const

export type PartName = keyof typeof PARTS

export const modelIdOf = (part: PartName) => `practice-${part}`

export const partOf = (modelId: string): PartName | null => {
  const name = modelId.replace(/^practice-/, '')
  return name in PARTS && modelId.startsWith('practice-') ? (name as PartName) : null
}

const base = `${import.meta.env.BASE_URL}training/`

let loading: Promise<Map<PartName, Float32Array>> | null = null

/** Every part's mesh, fetched once a visit and primed into the workspace's cache. */
export function loadParts(): Promise<Map<PartName, Float32Array>> {
  loading ??= Promise.all(
    (Object.keys(PARTS) as PartName[]).map(async (part) => {
      const response = await fetch(`${base}parts/${part}.stl`)
      if (!response.ok) throw new Error(`${part}: ${String(response.status)}`)
      const positions = parseStl(new Uint8Array(await response.arrayBuffer()))
      primeMesh(modelIdOf(part), positions)
      return [part, positions] as const
    }),
  )
    .then((entries) => new Map(entries))
    .catch((error: unknown) => {
      loading = null
      throw error
    })
  return loading
}

export function practiceModel(part: PartName, positions: Float32Array): ApiPlateModel {
  return {
    id: modelIdOf(part),
    fileName: `${part}.stl`,
    fileSize: positions.byteLength,
    meshState: 'READY',
    meshFailure: null,
    triangles: positions.length / 9,
  }
}

const IDENTITY = { qx: 0, qy: 0, qz: 0, qw: 1, sx: 1, sy: 1, sz: 1 }

/** A turn of `degrees` about one of the plate's axes. */
export function turn(axis: 'x' | 'y' | 'z', degrees: number): Quat {
  const half = (degrees * Math.PI) / 360
  return {
    qx: axis === 'x' ? Math.sin(half) : 0,
    qy: axis === 'y' ? Math.sin(half) : 0,
    qz: axis === 'z' ? Math.sin(half) : 0,
    qw: Math.cos(half),
  }
}

/** One copy of a part for a task's starting plate; `id` is what the task's checks look it up by. */
export function placed(
  part: PartName,
  id: string,
  x: number,
  y: number,
  options: { turns?: Quat[]; scale?: number } = {},
): ApiPlateObject {
  const q = (options.turns ?? []).reduce<Quat>((sum, next) => multiply(next, sum), IDENTITY)
  const s = options.scale ?? 1
  return {
    ...IDENTITY,
    ...q,
    sx: s,
    sy: s,
    sz: s,
    id,
    modelId: modelIdOf(part),
    name: PARTS[part].name,
    x,
    y,
  }
}
