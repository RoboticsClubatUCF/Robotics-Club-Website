import { describe, expect, it } from 'vitest'
import { PRACTICE_PETG, PRACTICE_PLA, PRACTICE_STANDARD } from './practiceProfiles'
import { type SlicedWith, plateValues } from './practiceSlices'
import { type SliceLog, type SliceRecord, changes, labelOf } from './sliceLog'

const made = (
  overrides: Record<string, number | boolean | string> = {},
  more: Partial<SlicedWith> = {},
): SlicedWith => ({
  processId: more.processId ?? PRACTICE_STANDARD,
  filamentId: PRACTICE_PLA,
  values: plateValues({ processId: more.processId ?? PRACTICE_STANDARD, overrides }),
  upsideDown: false,
  ...more,
})

const record = (with_: SlicedWith, missing: string[] = []): SliceRecord => ({
  ...with_,
  requestedAt: String(Math.random()),
  part: 'mushroom',
  grams: 1,
  seconds: 60,
  layers: 10,
  missing,
})

describe('the slice log', () => {
  it('says what changed, the way the settings column does', () => {
    expect(changes(made(), made({ enable_support: false }))).toEqual(['Supports: Off'])
    expect(changes(made(), made({ support_type: 'normal(auto)', raft_layers: 2 }))).toEqual([
      'Support type: Normal',
      'Raft layers: 2',
    ])
    expect(changes(made(), made({ layer_height: 0.12, sparse_infill_density: 40, support_threshold_angle: 45 }))).toEqual([
      'Layer height: 0.12 mm',
      'Infill density: 40%',
      'Threshold angle: 45°',
    ])
    expect(changes(made(), made({}, { upsideDown: true }))).toEqual(['Upside down'])
  })

  it('leaves out what can’t change the slice, and what came with a new process', () => {
    // Back on, still Tree: only the switch changed what prints.
    expect(changes(made({ enable_support: false }), made())).toEqual(['Supports: On'])
    expect(changes(made(), made({ enable_support: false }), 'tower')).toEqual([])
    expect(changes(made({}, { filamentId: PRACTICE_PETG }), made({ wall_loops: 4 }, { processId: 'practice-qs', filamentId: PRACTICE_PETG }))).toEqual([
      'Process: Q-S',
      'Walls: 4',
    ])
  })

  it('labels the first slice against the task’s start and the rest against the one before', () => {
    const log: SliceLog = {
      start: made(),
      slices: [record(made()), record(made({ enable_support: false })), record(made({ enable_support: false }))],
    }
    expect([0, 1, 2].map((index) => labelOf(log, index))).toEqual(['As it is', 'Supports: Off', 'No change'])
  })

  it('says which changes a stand-in slice doesn’t show', () => {
    const log: SliceLog = { start: made(), slices: [record(made()), record(made(), ['ironing_type', 'filament'])] }
    expect(labelOf(log, 1)).toBe('No change; not shown: Ironing, Filament')
  })
})
