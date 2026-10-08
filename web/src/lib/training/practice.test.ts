/// <reference types="node" />
// @vitest-environment node
// Node, to read the parts and slices off disk: they're the files the site serves.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { restingFaces } from '../slicer/faces'
import { autoOrient, layFlat } from '../slicer/orient'
import { ROLES, type Preview, type RoleLines, SEGMENT_FLOATS } from '../slicer/preview'
import { parseStl } from '../slicer/stl'
import type { Plate } from '../slicer/useDraft'
import { type PracticeState, anyOverlap, atOpeningView, fits, pointing, restsOn, setting, sizeOf } from './goals'
import { PRACTICE_PETG, PRACTICE_WORKSPACE } from './practiceProfiles'
import { type PartName, modelIdOf, placed, turn } from './practiceParts'
import { matchSlice, shiftPreview } from './practiceSlices'
import { freshSettings } from './usePracticePlate'

const part = (name: PartName) =>
  parseStl(new Uint8Array(readFileSync(new URL(`../../../public/training/parts/${name}.stl`, import.meta.url))))

const manifest = JSON.parse(
  readFileSync(new URL('../../../public/training/slices.json', import.meta.url), 'utf8'),
) as { slices: Record<string, { preview: string | null }> }

const meshes = new Map((['cube', 'bracket', 'mushroom', 'tower', 'block'] as const).map((name) => [modelIdOf(name), part(name)]))
const bed = PRACTICE_WORKSPACE.profiles.printers[0]!.bed

const state = (plate: Partial<Plate>, extra: Partial<PracticeState> = {}): PracticeState => ({
  plate: { ...freshSettings(), objects: [], ...plate },
  selected: [],
  mode: 'move',
  tab: 'prepare',
  camera: null,
  layers: null,
  meshes,
  slice: null,
  sliced: null,
  sent: 0,
  bed,
  ...extra,
})

describe('the practice parts', () => {
  it('are the sizes the lessons say', () => {
    const at = (name: PartName) => sizeOf(state({ objects: [placed(name, 'p', 128, 128)] }), 'p')!.map((v) => Math.round(v))
    expect(at('cube')).toEqual([20, 20, 20])
    expect(at('bracket')).toEqual([40, 24, 30])
    expect(at('mushroom')).toEqual([30, 30, 19])
    expect(at('tower')).toEqual([8, 8, 60])
    expect(at('block')).toEqual([30, 30, 12])
  })

  it('auto-orients the mushroom onto its cap', () => {
    const q = autoOrient(meshes.get(modelIdOf('mushroom'))!)
    expect(restsOn({ ...placed('mushroom', 'm', 128, 128), ...q }, [0, 0, 1])).toBe(true)
  })

  it('gives the bracket its back and bottom as its biggest faces, and both ends to stand on', () => {
    const faces = restingFaces(meshes.get(modelIdOf('bracket'))!)
      .map((face) => ({ normal: face.normal.map((v) => Math.round(v)), area: Math.round(face.area) }))
      .sort((a, b) => b.area - a.area)
    expect(faces.slice(0, 2)).toEqual([
      { normal: [0, -1, 0], area: 1200 },
      { normal: [0, 0, -1], area: 960 },
    ])
    expect(faces.filter((face) => Math.abs(face.normal[0]!) === 1)).toHaveLength(2)

    // LAY ON FACE on the tilted bracket the lay-on-face task starts with puts its back down.
    const tilted = placed('bracket', 'b', 128, 128, { turns: [turn('x', 35), turn('y', 20)] })
    expect(restsOn(tilted, [0, -1, 0])).toBe(false)
    const down = layFlat(tilted, pointing(tilted, [0, -1, 0]))
    expect(restsOn({ ...tilted, ...down }, [0, -1, 0])).toBe(true)
  })

  it('tells a part off the plate, in the corner or too tall from one that fits', () => {
    const plate = state({
      objects: [
        placed('cube', 'off', 252, 128),
        placed('cube', 'corner', 240, 18),
        placed('tower', 'tall', 128, 128, { scale: 4.5 }),
        placed('block', 'fine', 60, 200),
      ],
    })
    expect(fits(plate, 'off')).toBe(false)
    expect(fits(plate, 'corner')).toBe(false)
    expect(fits(plate, 'tall')).toBe(false)
    expect(fits(plate, 'fine')).toBe(true)
  })

  it('sees overlapping copies', () => {
    expect(anyOverlap(state({ objects: [placed('cube', 'a', 100, 100), placed('cube', 'b', 110, 105)] }))).toBe(true)
    expect(anyOverlap(state({ objects: [placed('cube', 'a', 100, 100), placed('cube', 'b', 130, 100)] }))).toBe(false)
  })
})

describe('settings', () => {
  it('reads the process’s own value until the member changes it', () => {
    expect(setting(state({}), 'wall_loops')).toBe(2)
    expect(setting(state({ processId: 'practice-qs' }), 'wall_loops')).toBe(6)
    expect(setting(state({ overrides: { wall_loops: 4 } }), 'wall_loops')).toBe(4)
  })
})

describe('the camera', () => {
  it('knows the view the plate opens with', () => {
    const opening = { position: [128, -128 * 1.05 * 2, 256 * 1.3 * 2] as [number, number, number], target: [128, 128, 0] as [number, number, number] }
    // Not the opening direction: the camera above is twice as far up as back.
    expect(atOpeningView(state({}, { camera: opening }))).toBe(false)
    const d = 256
    const right = { position: [128, -d * 1.05, d * 1.3] as [number, number, number], target: [128, 128, 0] as [number, number, number] }
    expect(atOpeningView(state({}, { camera: right }))).toBe(true)
  })
})

describe('practice slicing', () => {
  const mushroom = (turns = [] as ReturnType<typeof turn>[], x = 128, y = 128) => placed('mushroom', 'm', x, y, { turns })

  it('picks the ready-made slice for the mushroom’s set-up', () => {
    expect(matchSlice({ ...freshSettings(), objects: [mushroom()] })).toMatchObject({ name: 'mushroom-up-tree', ignored: [] })
    expect(
      matchSlice({ ...freshSettings(), overrides: { enable_support: false }, objects: [mushroom()] }),
    ).toMatchObject({ name: 'mushroom-up-none' })
    expect(
      matchSlice({ ...freshSettings(), overrides: { support_type: 'normal(auto)', brim_type: 'outer_only' }, objects: [mushroom()] }),
    ).toMatchObject({ name: 'mushroom-up-normal-brim' })
    expect(
      matchSlice({ ...freshSettings(), filamentId: PRACTICE_PETG, overrides: { wall_loops: 4 }, objects: [mushroom([turn('x', 180)], 100, 150)] }),
    ).toEqual({ name: 'mushroom-down', ignored: ['wall_loops', 'filament'], offset: [-28, 22] })
  })

  it('names a ready-made slice for every set-up it can pick, with a preview', () => {
    for (const supports of ['none', 'normal', 'tree']) {
      for (const brim of ['', '-brim']) {
        expect(manifest.slices[`mushroom-up-${supports}${brim}`]?.preview).toBeTruthy()
      }
    }
    expect(manifest.slices['mushroom-down']?.preview).toBeTruthy()
    expect(manifest.slices['mushroom-down-brim']?.preview).toBeTruthy()
  })

  it('says why it can’t slice a plate it has nothing for', () => {
    expect(matchSlice({ ...freshSettings(), objects: [] })).toHaveProperty('problem')
    expect(matchSlice({ ...freshSettings(), objects: [placed('cube', 'c', 128, 128)] })).toHaveProperty('problem')
    expect(matchSlice({ ...freshSettings(), objects: [mushroom([turn('x', 90)])] })).toHaveProperty('problem')
    expect(matchSlice({ ...freshSettings(), objects: [{ ...mushroom(), sx: 2, sy: 2, sz: 2 }] })).toHaveProperty('problem')
  })

  it('moves a preview’s paths, and only the real ones', () => {
    const lines = (count: number): RoleLines => {
      const segments = new Float32Array(2048 * SEGMENT_FLOATS)
      for (let i = 0; i < count; i++) segments.set([1, 2, 3, 4, 0.2, 0.4, 0.2, 0], i * SEGMENT_FLOATS)
      return { segments, layerStart: Uint32Array.from([0, count]) }
    }
    const preview = {
      bed: { width: 256, depth: 256, height: 256 },
      layers: [{ z: 0.2, height: 0.2 }],
      segments: 2,
      bounds: { min: [1, 2, 0], max: [3, 4, 0.2] },
      filament: null,
      roles: Object.fromEntries(ROLES.map((role) => [role, lines(role === 'outerWall' ? 2 : 0)])),
    } as Preview
    const moved = shiftPreview(preview, [10, -1])
    expect([...moved.roles.outerWall.segments.slice(0, 4)]).toEqual([11, 1, 13, 3])
    expect([...moved.roles.outerWall.segments.slice(16, 20)]).toEqual([0, 0, 0, 0])
    expect(moved.bounds.min).toEqual([11, 1, 0])
  })
})
