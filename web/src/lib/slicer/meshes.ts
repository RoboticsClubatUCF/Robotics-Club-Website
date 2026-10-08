import { useEffect, useState } from 'react'
import { apiBaseUrl } from '../api/api'
import type { ApiPlateModel } from '../api/api'
import { parseStl } from './stl'

/**
 * Each model's mesh, fetched once and kept for the visit.
 *
 * A model's mesh never changes (a different file is a different model), so the cache is keyed on
 * the model id and never invalidated. It lives in memory only: the server sends these `no-store`,
 * because members' parts are deleted when the print settles.
 */

const cache = new Map<string, Promise<Float32Array>>()

export function loadMesh(modelId: string): Promise<Float32Array> {
  let pending = cache.get(modelId)
  if (!pending) {
    pending = fetch(`${apiBaseUrl}/api/print/models/${modelId}/mesh`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`mesh ${modelId}: ${String(response.status)}`)
        return parseStl(new Uint8Array(await response.arrayBuffer()))
      })
      .catch((error: unknown) => {
        // A failure isn't cached; the next render asks again.
        cache.delete(modelId)
        throw error
      })
    cache.set(modelId, pending)
  }
  return pending
}

/** A mesh the workspace already has: the STL just uploaded doesn't need fetching back. */
export function primeMesh(modelId: string, positions: Float32Array): void {
  cache.set(modelId, Promise.resolve(positions))
}

export type MeshMap = ReadonlyMap<string, Float32Array>

/** The meshes for every model that has one, as they arrive. */
export function useMeshes(models: ApiPlateModel[]): { meshes: MeshMap; failed: string[] } {
  const [meshes, setMeshes] = useState<MeshMap>(new Map())
  const [failed, setFailed] = useState<string[]>([])
  const ready = models
    .filter((model) => model.meshState === 'READY')
    .map((model) => model.id)
    .join(',')

  useEffect(() => {
    let live = true
    const ids = ready ? ready.split(',') : []
    const run = async () => {
      const results = await Promise.allSettled(ids.map(loadMesh))
      if (!live) return
      const next = new Map<string, Float32Array>()
      const missing: string[] = []
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') next.set(ids[index]!, result.value)
        else missing.push(ids[index]!)
      })
      setMeshes(next)
      setFailed(missing)
    }
    void run()
    return () => {
      live = false
    }
  }, [ready])

  return { meshes, failed }
}
