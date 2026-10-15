import { describe, expect, it } from 'vitest'
import raw from './fixtures/processSettings.vectors.json?raw'
import {
  PROCESS_SETTINGS,
  fromOrca,
  orcaOverrides,
  overridesLine,
  parseOverrides,
  toOrca,
  vaseRefusal,
} from './processSettings'

// The same vectors run against server/src/printing/processSettings.ts. CI fails if the two copies
// of the file differ, so the workspace can't offer what the server would refuse.
const vectors = JSON.parse(raw) as {
  valid: { input: Record<string, unknown>; stored: Record<string, unknown>; orca: Record<string, string> }[]
  invalid: Record<string, unknown>[]
  vase: {
    process: Record<string, number | boolean | string>
    overrides: Record<string, number | boolean | string>
    copies: number
    refusal: string | null
  }[]
}

describe('parseOverrides', () => {
  it.each(vectors.valid)('accepts $input', ({ input, stored, orca }) => {
    const parsed = parseOverrides(input)
    expect(parsed).toEqual(stored)
    expect(orcaOverrides(parsed!)).toEqual(orca)
  })

  it.each(vectors.invalid)('refuses %j', (input) => {
    expect(parseOverrides(input)).toBeNull()
  })

  it('reads every value back the way it writes it', () => {
    for (const def of PROCESS_SETTINGS) {
      const sample = def.kind === 'bool' ? true : def.kind === 'choice' ? def.choices[0]!.value : def.max
      expect(fromOrca(def, toOrca(def, sample))).toEqual(sample)
    }
  })
})

// The worker and the SLICE route give the same sentence, so the workspace can say it first.
describe('vaseRefusal', () => {
  it.each(vectors.vase)('$overrides with $copies copies', ({ process, overrides, copies, refusal }) => {
    expect(vaseRefusal(process, overrides, copies)).toBe(refusal)
  })
})

describe('overridesLine', () => {
  it('names what was changed, in the table’s order', () => {
    expect(overridesLine({ sparse_infill_density: 25, wall_loops: 4, brim_type: 'outer_only' })).toBe(
      'Walls 4 · Infill density 25% · Brim Outer only',
    )
    expect(overridesLine({})).toBe('')
    expect(overridesLine(null)).toBe('')
  })
})
