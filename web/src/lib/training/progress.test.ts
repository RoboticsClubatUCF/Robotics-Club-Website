import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiTraining } from '../api/api'
import { bodyOf, urlOf } from '../../test/stubFetch'
import { readLegacyProgress, useTrainingProgress } from './progress'

const saved = (over: Partial<ApiTraining> = {}): ApiTraining => ({
  steps: [],
  at: null,
  restarted: [],
  chapters: [],
  trainedAt: null,
  ...over,
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** A server holding one record, whose saves can be held back to see what's sent while one is out. */
function server(start: ApiTraining) {
  let record = start
  const held: (() => void)[] = []
  let hold = false
  let failSaves = false
  const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    if (!urlOf(input).includes('/print/training')) return Promise.reject(new Error('no stub'))
    if (init?.method !== 'PUT') return Promise.resolve(json(record))
    if (failSaves) return Promise.reject(new TypeError('Failed to fetch'))
    const body = bodyOf(init) as Omit<ApiTraining, 'trainedAt'>
    record = { ...record, ...body }
    const answer = () => json(record)
    if (!hold) return Promise.resolve(answer())
    return new Promise<Response>((resolve) => held.push(() => resolve(answer())))
  })
  return {
    fetch,
    saves: () => fetch.mock.calls.filter(([, init]) => init?.method === 'PUT').map(([, init]) => bodyOf(init)),
    hold: (on: boolean) => {
      hold = on
    },
    failSaves: (on: boolean) => {
      failSaves = on
    },
    release: () => held.splice(0).forEach((resolve) => resolve()),
  }
}

// Finishing step `b` finishes the chapter `ab`.
const finished = (done: readonly string[]) => (done.includes('a') && done.includes('b') ? ['ab'] : [])

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('training progress', () => {
  it('reads where somebody is from the server', async () => {
    const api = server(saved({ steps: ['a'], at: 'b', chapters: ['basics'], trainedAt: '2026-10-01T00:00:00.000Z' }))
    vi.stubGlobal('fetch', api.fetch)
    const { result } = renderHook(() => useTrainingProgress('u1', finished))
    expect(result.current.load.status).toBe('loading')
    await waitFor(() => expect(result.current.load).toEqual({ status: 'ready', trainedAt: '2026-10-01T00:00:00.000Z' }))
    expect(result.current.progress).toEqual({ done: ['a'], at: 'b', restarted: [], chapters: ['basics'] })
    expect(api.saves()).toEqual([])
  })

  it('adds the chapters a change finishes, and keeps the ones it had', async () => {
    const api = server(saved({ steps: ['a'], chapters: ['basics'] }))
    vi.stubGlobal('fetch', api.fetch)
    const { result } = renderHook(() => useTrainingProgress('u1', finished))
    await waitFor(() => expect(result.current.load.status).toBe('ready'))

    act(() => {
      result.current.update((was) => ({ ...was, done: [...was.done, 'b'], at: 'c' }))
    })
    expect(result.current.progress.chapters).toEqual(['basics', 'ab'])
    // Starting `b` over leaves the chapter finished.
    act(() => {
      result.current.update((was) => ({ ...was, done: ['a'], restarted: ['b'] }))
    })
    expect(result.current.progress.chapters).toEqual(['basics', 'ab'])
    await waitFor(() =>
      expect(api.saves().at(-1)).toEqual({ steps: ['a'], at: 'c', restarted: ['b'], chapters: ['basics', 'ab'] }),
    )
  })

  it('saves one at a time, sending the latest once the one out is back', async () => {
    const api = server(saved())
    vi.stubGlobal('fetch', api.fetch)
    const { result } = renderHook(() => useTrainingProgress('u1', finished))
    await waitFor(() => expect(result.current.load.status).toBe('ready'))
    api.hold(true)

    act(() => {
      result.current.update((was) => ({ ...was, at: 'one' }))
    })
    act(() => {
      result.current.update((was) => ({ ...was, at: 'two' }))
    })
    act(() => {
      result.current.update((was) => ({ ...was, at: 'three' }))
    })
    expect(api.saves().map((body) => (body as { at: string }).at)).toEqual(['one'])

    api.hold(false)
    await act(async () => {
      api.release()
      await Promise.resolve()
    })
    await waitFor(() => expect(api.saves().map((body) => (body as { at: string }).at)).toEqual(['one', 'three']))
  })

  it('says when a save failed, and saves again', async () => {
    const api = server(saved())
    vi.stubGlobal('fetch', api.fetch)
    const { result } = renderHook(() => useTrainingProgress('u1', finished))
    await waitFor(() => expect(result.current.load.status).toBe('ready'))

    api.failSaves(true)
    act(() => {
      result.current.update((was) => ({ ...was, at: 'b' }))
    })
    await waitFor(() => expect(result.current.saveFailed).toBe(true))

    api.failSaves(false)
    let worked = false
    await act(async () => {
      worked = await result.current.retrySave()
    })
    expect(worked).toBe(true)
    expect(result.current.saveFailed).toBe(false)
    expect(api.saves().at(-1)).toMatchObject({ at: 'b' })
  })

  it('uploads what an older page kept in this browser, once', async () => {
    localStorage.setItem(
      'rccf.slicer-training.u1',
      JSON.stringify({ done: ['a', 'b', 7], at: 'c', total: 54, restarted: ['b', null] }),
    )
    const api = server(saved({ chapters: ['basics'] }))
    vi.stubGlobal('fetch', api.fetch)
    const { result } = renderHook(() => useTrainingProgress('u1', finished))
    await waitFor(() => expect(result.current.load.status).toBe('ready'))

    expect(result.current.progress).toEqual({ done: ['a', 'b'], at: 'c', restarted: ['b'], chapters: ['basics', 'ab'] })
    await waitFor(() => expect(readLegacyProgress('u1')).toBeNull())
    expect(api.saves()).toEqual([{ steps: ['a', 'b'], at: 'c', restarted: ['b'], chapters: ['basics', 'ab'] }])
  })

  it('leaves what this browser kept alone when the server already has a place', async () => {
    localStorage.setItem('rccf.slicer-training.u1', JSON.stringify({ done: ['a'], at: 'a' }))
    vi.stubGlobal('fetch', server(saved({ steps: ['x'], at: 'y' })).fetch)
    const { result } = renderHook(() => useTrainingProgress('u1', finished))
    await waitFor(() => expect(result.current.load.status).toBe('ready'))
    expect(result.current.progress.done).toEqual(['x'])
  })

  it('says so when it can’t load, and tries again', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    const { result } = renderHook(() => useTrainingProgress('u1', finished))
    await waitFor(() => expect(result.current.load.status).toBe('failed'))

    vi.stubGlobal('fetch', server(saved({ at: 'b' })).fetch)
    act(() => {
      result.current.reload()
    })
    await waitFor(() => expect(result.current.load.status).toBe('ready'))
    expect(result.current.progress.at).toBe('b')
  })
})
