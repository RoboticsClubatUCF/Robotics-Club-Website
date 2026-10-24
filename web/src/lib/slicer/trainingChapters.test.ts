import { describe, expect, it } from 'vitest'
import raw from './fixtures/trainingChapters.vectors.json?raw'
import { PROCESS_SETTINGS } from './processSettings'
import { CHAPTER_SUMMARIES, CHAPTER_TITLES, OPTIONAL_CHAPTERS, PROFILE_KEYS, REQUIRED_CHAPTERS, UNLOCKS, chapterFor, unlocked } from './trainingChapters'

// The same vectors run against server/src/printing/trainingChapters.ts, so the slicer never
// offers a setting the server would refuse, or locks one it would take.
const vectors = JSON.parse(raw) as { required: string[]; unlocks: Record<string, string[]> }

describe('training chapters', () => {
  it('match the shared table', () => {
    expect([...REQUIRED_CHAPTERS]).toEqual(vectors.required)
    expect(Object.fromEntries(Object.entries(UNLOCKS).map(([id, keys]) => [id, [...keys]]))).toEqual(vectors.unlocks)
  })

  it('put every setting and profile under a chapter', () => {
    for (const key of [...PROCESS_SETTINGS.map((def) => def.key), ...PROFILE_KEYS]) {
      expect(chapterFor(key), key).toBeDefined()
    }
  })

  it('unlock nothing for the required chapters alone', () => {
    for (const def of PROCESS_SETTINGS) expect(unlocked([...REQUIRED_CHAPTERS], def.key)).toBe(false)
  })

  it('name and sum up every optional chapter', () => {
    expect(Object.keys(CHAPTER_TITLES)).toEqual(OPTIONAL_CHAPTERS)
    expect(Object.keys(CHAPTER_SUMMARIES)).toEqual(OPTIONAL_CHAPTERS)
  })
})
