import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PROCESS_SETTINGS, fromOrca, orcaOverrides, processOverrides, toOrca } from './processSettings.js'

const vectors = JSON.parse(
  readFileSync(new URL('./fixtures/processSettings.vectors.json', import.meta.url), 'utf8'),
) as {
  valid: { input: Record<string, unknown>; stored: Record<string, unknown>; orca: Record<string, string> }[]
  invalid: Record<string, unknown>[]
}

// The same vectors run against web/src/lib/slicer/processSettings.ts, so the workspace and the
// worker can't disagree about what a setting accepts or how Orca spells it.
describe('processOverrides', () => {
  it.each(vectors.valid)('accepts $input', ({ input, stored, orca }) => {
    const parsed = processOverrides.parse(input)
    expect(parsed).toEqual(stored)
    expect(orcaOverrides(parsed)).toEqual(orca)
  })

  it.each(vectors.invalid)('refuses %j', (input) => {
    expect(processOverrides.safeParse(input).success).toBe(false)
  })

  it('reads every value back the way it writes it', () => {
    for (const def of PROCESS_SETTINGS) {
      const sample =
        def.kind === 'bool'
          ? true
          : def.kind === 'choice'
            ? def.choices[0]!.value
            : def.max
      expect(fromOrca(def, toOrca(def, sample))).toEqual(sample)
    }
  })

  it('never offers a key outside what the table names', () => {
    const keys = PROCESS_SETTINGS.map((def) => def.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).not.toContain('nozzle_temperature')
  })
})
