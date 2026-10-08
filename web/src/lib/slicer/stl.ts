/**
 * STL into a flat triangle list: nine floats per triangle, no index. The same reading as the
 * server's `printing/stl.ts`, so the plate the workspace draws is the plate the worker slices.
 */

export class MeshError extends Error {}

/** What the slicer takes. The server checks the bytes as well. */
export const ACCEPTED_MODELS = ['.stl', '.step', '.stp']

function isBinary(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 84) return false
  const count = new DataView(bytes.buffer, bytes.byteOffset + 80, 4).getUint32(0, true)
  // Before the "solid" check: plenty of exporters write binary files whose header starts with it.
  return bytes.byteLength === 84 + count * 50
}

export function parseStl(bytes: Uint8Array): Float32Array {
  let out: Float32Array
  if (isBinary(bytes)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const count = view.getUint32(80, true)
    out = new Float32Array(count * 9)
    for (let i = 0; i < count; i++) {
      const base = 84 + i * 50 + 12
      for (let j = 0; j < 9; j++) out[i * 9 + j] = view.getFloat32(base + j * 4, true)
    }
  } else {
    const text = new TextDecoder().decode(bytes)
    const numbers: number[] = []
    for (const match of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) {
      numbers.push(Number(match[1]), Number(match[2]), Number(match[3]))
    }
    if (numbers.length % 9 !== 0) throw new MeshError('A facet in the STL is missing a vertex.')
    out = Float32Array.from(numbers)
  }
  if (out.length === 0) throw new MeshError('The STL has no triangles in it.')
  if (out.some((value) => !Number.isFinite(value))) {
    throw new MeshError(`The STL has a vertex that isn't a number.`)
  }
  return out
}
