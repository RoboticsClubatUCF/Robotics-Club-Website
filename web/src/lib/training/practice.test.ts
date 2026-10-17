/// <reference types="node" />
// @vitest-environment node
// Node, to read the parts and slices off disk: they're the files the site serves.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CHAPTERS } from '../../components/training/chapters'
import { restingFaces } from '../slicer/faces'
import { autoOrient, layFlat } from '../slicer/orient'
import { ROLES, type Preview, type RoleLines, SEGMENT_FLOATS } from '../slicer/preview'
import { parseStl } from '../slicer/stl'
import type { Plate } from '../slicer/useDraft'
import { type PracticeState, anyOverlap, atOpeningView, fits, pointing, restsOn, setting, sizeOf, trackRotation } from './goals'
import { PRACTICE_PETG, PRACTICE_WORKSPACE } from './practiceProfiles'
import { type PartName, modelIdOf, placed, turn } from './practiceParts'
import { type SliceManifest, matchSlice, placePreview, same, slicedWith } from './practiceSlices'
import { flatten } from './curriculum'
import { freshSettings } from './usePracticePlate'

const part = (name: PartName) =>
  parseStl(new Uint8Array(readFileSync(new URL(`../../../public/training/parts/${name}.stl`, import.meta.url))))

const manifest = JSON.parse(
  readFileSync(new URL('../../../public/training/slices.json', import.meta.url), 'utf8'),
) as SliceManifest

const meshes = new Map((['cube', 'bracket', 'mushroom', 'tower', 'block'] as const).map((name) => [modelIdOf(name), part(name)]))
const bed = PRACTICE_WORKSPACE.profiles.printers[0]!.bed

const state = (plate: Partial<Plate>, extra: Partial<PracticeState> = {}): PracticeState => ({
  plate: { ...freshSettings(), objects: [], ...plate },
  selected: [],
  selectSeveral: false,
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

describe('the turn-a-part task', () => {
  const task = flatten(CHAPTERS).find(({ step }) => step.id === 'try-rotate')!.step
  if (task.kind !== 'try') throw new Error('Expected a practice task')
  const rotated = task.goals[1]!
  const reset = task.goals[2]!

  it.each(['x', 'y'] as const)('credits a Z quarter-turn after an accidental %s tilt, then still requires reset', (axis) => {
    let rotations = trackRotation({}, { objectId: 'bracket', axis, degrees: 35 })
    const tilted = placed('bracket', 'bracket', 128, 128, { turns: [turn(axis, 35)] })
    expect(rotated.done(state({ objects: [tilted] }, { rotations }), {})).toBe(false)
    rotations = trackRotation(rotations, { objectId: 'bracket', axis: 'z', degrees: 90 })
    const turned = placed('bracket', 'bracket', 128, 128, { turns: [turn(axis, 35), turn('z', 90)] })
    const now = state({ objects: [turned] }, { rotations })
    expect(rotated.done(now, {})).toBe(true)
    expect(reset.done(now, {})).toBe(false)
    expect(reset.done(state({ objects: [placed('bracket', 'bracket', 128, 128)] }), {})).toBe(true)
  })

  it('accumulates smaller Z turns and clears them on reset', () => {
    const objects = [placed('bracket', 'bracket', 128, 128)]
    let rotations = trackRotation({}, { objectId: 'bracket', axis: 'z', degrees: 45 })
    expect(rotated.done(state({ objects }, { rotations }), {})).toBe(false)
    rotations = trackRotation(rotations, { objectId: 'bracket', axis: 'z', degrees: 45 })
    expect(rotated.done(state({ objects }, { rotations }), {})).toBe(true)
    rotations = trackRotation(rotations, { objectId: 'bracket', reset: true })
    expect(rotated.done(state({ objects }, { rotations }), {})).toBe(false)
    expect(trackRotation(rotations, { objectId: 'other', axis: 'z', degrees: 90 }).bracket).toBeUndefined()
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
  const plate = (objects: Plate['objects'], settings: Partial<Plate> = {}): Plate => ({ ...freshSettings(), ...settings, objects })

  it('picks the ready-made slice made the same way up, with the same settings', () => {
    expect(matchSlice(plate([mushroom()]), manifest)).toMatchObject({ name: 'mushroom-up-tree', ignored: [] })
    expect(matchSlice(plate([mushroom()], { overrides: { enable_support: false } }), manifest)).toMatchObject({
      name: 'mushroom-up-none',
      ignored: [],
    })
    expect(
      matchSlice(plate([mushroom()], { overrides: { support_type: 'normal(auto)', brim_type: 'outer_only' } }), manifest),
    ).toMatchObject({ name: 'mushroom-up-normal-brim', ignored: [] })
    expect(
      matchSlice(
        plate([placed('block', 'b', 128, 128)], { processId: 'practice-qs', filamentId: PRACTICE_PETG, overrides: { wall_loops: 4 } }),
        manifest,
      ),
    ).toMatchObject({ name: 'block-petg-qs-walls-4', ignored: [] })
  })

  it('leaves out settings that can’t change the slice', () => {
    // No support type without supports, and nothing on the tower to support.
    expect(
      matchSlice(plate([mushroom()], { overrides: { enable_support: false, support_type: 'normal(auto)' } }), manifest),
    ).toMatchObject({ name: 'mushroom-up-none', ignored: [] })
    expect(
      matchSlice(plate([placed('tower', 't', 128, 128)], { overrides: { enable_support: false, fuzzy_skin: 'external' } }), manifest),
    ).toMatchObject({ name: 'tower-fuzzy', ignored: [] })
  })

  it('stands in a slice without some of the member’s changes, and names them', () => {
    expect(
      matchSlice(plate([mushroom([turn('x', 180)], 100, 150)], { filamentId: PRACTICE_PETG, overrides: { wall_loops: 4 } }), manifest),
    ).toMatchObject({ name: 'mushroom-down', ignored: ['wall_loops', 'filament'], offset: [-28, 22] })
    // Q-S was only sliced with PETG, and PETG isn't a change the member made, so it can't stand in.
    expect(matchSlice(plate([placed('block', 'b', 128, 128)], { processId: 'practice-qs' }), manifest)).toMatchObject({
      name: 'block-standard',
      ignored: ['process'],
    })
  })

  it('turns the paths with a part turned flat on the plate', () => {
    const match = matchSlice(plate([placed('block', 'b', 100, 90, { turns: [turn('z', 30)] })]), manifest)
    expect(match).toMatchObject({ name: 'block-standard', offset: [-28, -38] })
    expect('yaw' in match ? match.yaw : null).toBeCloseTo(Math.PI / 6)
  })

  it('says why it can’t slice a plate it has nothing for', () => {
    const problem = (p: Plate) => {
      const match = matchSlice(p, manifest)
      return 'problem' in match ? match.problem : null
    }
    expect(problem(plate([]))).toMatch(/only slices the mushroom, tower and block/)
    expect(problem(plate([placed('cube', 'c', 128, 128)]))).toMatch(/only slices the mushroom, tower and block/)
    expect(problem(plate([mushroom(), placed('cube', 'c', 40, 40)]))).toMatch(/one part on its own/)
    expect(problem(plate([mushroom([turn('x', 90)])]))).toMatch(/Stand the mushroom up or turn it upside down/)
    expect(problem(plate([placed('block', 'b', 128, 128, { turns: [turn('x', 90)] })]))).toMatch(/the way up it started/)
    expect(problem(plate([{ ...mushroom(), sx: 2, sy: 2, sz: 2 }]))).toMatch(/100% size/)
    // Orca refuses it, so practice doesn't pretend.
    expect(problem(plate([placed('tower', 't', 128, 128)], { overrides: { spiral_mode: true } }))).toMatch(/Supports off/)
  })

  it('has every slice’s preview on disk', () => {
    for (const [name, slice] of Object.entries(manifest.slices)) {
      expect(slice.preview, name).toBeTruthy()
      expect(existsSync(new URL(`../../../public/training/${slice.preview!}`, import.meta.url)), name).toBe(true)
    }
  })

  it('has a slice for every experiment in the training, showing every change it asks for', () => {
    let experiments = 0
    for (const { step } of flatten(CHAPTERS)) {
      if (step.kind !== 'try' || !step.setUp) continue
      // Each experiment carries on from the one before, the way the member would.
      let at = plate(step.setUp.objects(), step.setUp.settings)
      for (const goal of step.goals) {
        if (!goal.wants) continue
        experiments++
        for (const [key, value] of goal.wants) {
          if (key === 'process') at = { ...at, processId: String(value) }
          else if (key === 'filament') at = { ...at, filamentId: String(value) }
          else at = { ...at, overrides: { ...at.overrides, [key]: value } }
        }
        const match = matchSlice(at, manifest)
        const where = `${step.id}: ${goal.text}`
        expect(match, where).toMatchObject({ ignored: [] })
        if (!('slice' in match)) continue
        const made = slicedWith(match.slice)
        for (const [key, value] of goal.wants) {
          const got = key === 'process' ? made.processId : key === 'filament' ? made.filamentId : made.values[key]
          expect(same(got, value), `${where} ${key}`).toBe(true)
        }
      }
    }
    expect(experiments).toBeGreaterThan(15)
  })

  const preview = () => {
    const lines = (count: number): RoleLines => {
      const segments = new Float32Array(2048 * SEGMENT_FLOATS)
      for (let i = 0; i < count; i++) segments.set([1, 2, 3, 4, 0.2, 0.4, 0.2, 0], i * SEGMENT_FLOATS)
      return { segments, layerStart: Uint32Array.from([0, count]) }
    }
    return {
      bed: { width: 256, depth: 256, height: 256 },
      layers: [{ z: 0.2, height: 0.2 }],
      segments: 2,
      bounds: { min: [1, 2, 0], max: [3, 4, 0.2] },
      filament: null,
      roles: Object.fromEntries(ROLES.map((role) => [role, lines(role === 'outerWall' ? 2 : 0)])),
    } as Preview
  }

  it('moves a preview’s paths, and only the real ones', () => {
    const moved = placePreview(preview(), [2, 3], [10, -1], 0)
    expect([...moved.roles.outerWall.segments.slice(0, 4)]).toEqual([11, 1, 13, 3])
    expect([...moved.roles.outerWall.segments.slice(4, 8)].map((v) => Math.round(v * 10) / 10)).toEqual([0.2, 0.4, 0.2, 0])
    expect([...moved.roles.outerWall.segments.slice(16, 20)]).toEqual([0, 0, 0, 0])
    expect(moved.bounds.min).toEqual([11, 1, 0])
  })

  it('turns a preview’s paths about where the part was sliced', () => {
    // A quarter turn about (2, 3): (1, 2) goes to (3, 2) and (3, 4) to (1, 4), then 10 to the right.
    const turned = placePreview(preview(), [2, 3], [10, 0], Math.PI / 2)
    const round = (values: Iterable<number>) => [...values].map((v) => Math.round(v * 1000) / 1000)
    expect(round(turned.roles.outerWall.segments.slice(0, 4))).toEqual([13, 2, 11, 4])
    expect(round(turned.bounds.min)).toEqual([11, 2, 0])
  })
})
