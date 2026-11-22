import { parentPort, workerData } from 'node:worker_threads'
import { type Placement, placementAffine } from './plateTransform.js'
import { parseStl } from './stl.js'
import { renderThumbnail } from './thumbnailRender.js'

/** One picture in its own thread, so a heavy model can't stall the API. Imports no database. */

export interface ThumbnailJob {
  models: { stl: Uint8Array; placements: Placement[] }[]
}

const { models } = workerData as ThumbnailJob

const png = renderThumbnail(
  models.map(({ stl, placements }) => {
    const positions = parseStl(stl)
    return {
      positions,
      affines: placements.map((placement) => placementAffine(positions, placement)),
    }
  }),
)
parentPort!.postMessage(png)
