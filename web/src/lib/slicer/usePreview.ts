import { useEffect, useState } from 'react'
import { apiBaseUrl } from '../api/api'
import type { ApiDraftSlice } from '../api/api'
import { type Preview, gunzip, parsePreview } from './preview'

export type PreviewLoad =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; preview: Preview }

/** Unpacks a preview file, in a Web Worker where there is one. */
export async function decodePreview(bytes: ArrayBuffer): Promise<Preview> {
  if (typeof Worker === 'undefined') return parsePreview(await gunzip(new Uint8Array(bytes)))
  const worker = new Worker(new URL('./previewWorker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise<Preview>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<{ preview?: Preview; error?: string }>) => {
        if (event.data.preview) resolve(event.data.preview)
        else reject(new Error(event.data.error ?? 'the preview could not be read'))
      }
      worker.onerror = () => {
        reject(new Error('the preview could not be read'))
      }
      worker.postMessage(bytes, [bytes])
    })
  } finally {
    worker.terminate()
  }
}

/** The sliced plate's layers, once there's a current slice with a preview. */
export function usePreview(draftId: string | undefined, slice: ApiDraftSlice | null): PreviewLoad {
  const [load, setLoad] = useState<PreviewLoad>({ status: 'none' })
  const wanted = !!draftId && slice?.state === 'READY' && slice.current && slice.hasPreview
  // A new slice of the same plate is a new preview; the time it was asked for tells them apart.
  const key = wanted ? `${draftId}:${slice.requestedAt}` : null

  useEffect(() => {
    if (!key || !draftId) {
      setLoad({ status: 'none' })
      return
    }
    const controller = new AbortController()
    setLoad({ status: 'loading' })
    fetch(`${apiBaseUrl}/api/print/drafts/${draftId}/preview`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        const preview = await decodePreview(await response.arrayBuffer())
        if (!controller.signal.aborted) setLoad({ status: 'ready', preview })
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoad({ status: 'failed', message: `The preview couldn't be loaded. The plate is still sliced.` })
        }
      })
    return () => {
      controller.abort()
    }
  }, [key, draftId])

  return load
}
