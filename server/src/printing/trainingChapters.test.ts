import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PROCESS_SETTINGS } from './processSettings.js'
import { PROFILE_KEYS, REQUIRED_CHAPTERS, UNLOCKS, unlocked } from './trainingChapters.js'

const vectors = JSON.parse(
  readFileSync(new URL('./fixtures/trainingChapters.vectors.json', import.meta.url), 'utf8'),
) as { required: string[]; unlocks: Record<string, string[]> }

// The same vectors run against web/src/lib/slicer/trainingChapters.ts, so the slicer never offers
// a setting the server would refuse, or locks one it would take.
describe('training chapters', () => {
  it('match the shared table', () => {
    expect([...REQUIRED_CHAPTERS]).toEqual(vectors.required)
    expect(Object.fromEntries(Object.entries(UNLOCKS).map(([id, keys]) => [id, [...keys]]))).toEqual(
      vectors.unlocks,
    )
  })

  it('put every setting and profile under a chapter', () => {
    for (const key of [...PROCESS_SETTINGS.map((def) => def.key), ...PROFILE_KEYS]) {
      expect(Object.keys(UNLOCKS).filter((id) => unlocked([id], key)), key).not.toHaveLength(0)
    }
  })

  it('unlock nothing for the required chapters alone', () => {
    for (const def of PROCESS_SETTINGS) expect(unlocked([...REQUIRED_CHAPTERS], def.key)).toBe(false)
  })
})
