/// <reference lib="webworker" />
import { ROLES, gunzip, parsePreview } from './preview'

/**
 * Unpacks a sliced plate's preview off the main thread: a big plate is millions of segments, and
 * decoding them where the page draws would freeze it.
 */
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const preview = parsePreview(await gunzip(new Uint8Array(event.data)))
    const buffers = ROLES.flatMap((role) => [
      preview.roles[role].segments.buffer,
      preview.roles[role].layerStart.buffer,
    ])
    ;(self as unknown as Worker).postMessage({ preview }, buffers as Transferable[])
  } catch (error) {
    ;(self as unknown as Worker).postMessage({
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
