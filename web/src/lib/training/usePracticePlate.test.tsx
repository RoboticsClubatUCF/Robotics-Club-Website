import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePracticePlate } from './usePracticePlate'

afterEach(() => vi.unstubAllGlobals())

describe('practice requests', () => {
  it('rejects submission outside the sending module, including direct calls', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const { result } = renderHook(() => usePracticePlate(null))
    expect(result.current.source.canSubmit).toBe(false)
    await expect(result.current.source.submit({ projectId: null, notes: '' })).rejects.toThrow('only available in Sending it to print')
    expect(result.current.sent).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('simulates a request locally in the sending module and blocks it when leaving', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const { result, rerender } = renderHook(({ allowed }) => usePracticePlate(null, allowed), { initialProps: { allowed: true } })
    expect(result.current.source.canSubmit).toBe(true)
    await act(async () => {
      await expect(result.current.source.submit({ projectId: null, notes: 'Practice' })).resolves.toEqual({ fileName: 'Practice plate' })
    })
    expect(result.current.sent).toBe(1)
    expect(result.current.source.notice).toContain('nothing was sent')
    rerender({ allowed: false })
    expect(result.current.source.canSubmit).toBe(false)
    await expect(result.current.source.submit({ projectId: null, notes: '' })).rejects.toThrow('only available in Sending it to print')
    expect(result.current.sent).toBe(1)
    expect(fetch).not.toHaveBeenCalled()
  })
})
