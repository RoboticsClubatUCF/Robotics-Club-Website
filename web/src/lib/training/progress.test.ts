import { beforeEach, describe, expect, it } from 'vitest'
import { readProgress, writeProgress } from './progress'

beforeEach(() => localStorage.clear())

describe('training progress', () => {
  it('reads saved progress from before task restarts were recorded', () => {
    const legacy = { done: ['first'], at: 'second', total: 3 }
    writeProgress('member', legacy)
    expect(readProgress('member')).toEqual(legacy)
  })

  it('remembers unfinished restarts for the corresponding user', () => {
    const progress = { done: ['first'], at: 'task', total: 3, restarted: ['task'] }
    writeProgress('member', progress)
    expect(readProgress('member')).toEqual(progress)
    expect(readProgress('someone-else').restarted).toBeUndefined()
  })

  it('ignores invalid restart entries in saved browser data', () => {
    localStorage.setItem('rccf.slicer-training.member', JSON.stringify({ restarted: [false, 'task', null, 123] }))
    expect(readProgress('member').restarted).toEqual(['task'])
  })
})
