/**
 * STL in and out, and welding a triangle soup into an indexed mesh for the 3MF Orca reads.
 *
 * Meshes are passed around as a flat `Float32Array` of triangles: nine floats each, no index.
 */

export class MeshError extends Error {}

const decoder = new TextDecoder()

/** Whether the bytes are binary STL: the length is exactly what the header's count says. */
function isBinary(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 84) return false
  const count = new DataView(bytes.buffer, bytes.byteOffset + 80, 4).getUint32(0, true)
  // Checked before the "solid" prefix, because plenty of exporters write binary files whose
  // 80-byte header starts with that word.
  return bytes.byteLength === 84 + count * 50
}

export function parseStl(bytes: Uint8Array): Float32Array {
  if (isBinary(bytes)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const count = view.getUint32(80, true)
    const out = new Float32Array(count * 9)
    for (let i = 0; i < count; i++) {
      const base = 84 + i * 50 + 12
      for (let j = 0; j < 9; j++) out[i * 9 + j] = view.getFloat32(base + j * 4, true)
    }
    return checked(out)
  }

  const text = decoder.decode(bytes)
  const numbers: number[] = []
  for (const match of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) {
    numbers.push(Number(match[1]), Number(match[2]), Number(match[3]))
  }
  if (numbers.length % 9 !== 0) throw new MeshError('A facet in the STL is missing a vertex.')
  return checked(Float32Array.from(numbers))
}

function checked(positions: Float32Array): Float32Array {
  if (positions.length === 0) throw new MeshError('The STL has no triangles in it.')
  for (const value of positions) {
    if (!Number.isFinite(value)) throw new MeshError(`The STL has a vertex that isn't a number.`)
  }
  return positions
}

export const triangleCount = (positions: Float32Array) => positions.length / 9

function normalOf(p: Float32Array, i: number): [number, number, number] {
  const ax = p[i + 3]! - p[i]!
  const ay = p[i + 4]! - p[i + 1]!
  const az = p[i + 5]! - p[i + 2]!
  const bx = p[i + 6]! - p[i]!
  const by = p[i + 7]! - p[i + 1]!
  const bz = p[i + 8]! - p[i + 2]!
  const nx = ay * bz - az * by
  const ny = az * bx - ax * bz
  const nz = ax * by - ay * bx
  const length = Math.hypot(nx, ny, nz) || 1
  return [nx / length, ny / length, nz / length]
}

/**
 * Binary STL with real facet normals.
 *
 * Orca 2.4.2 still decides binary versus ASCII the way admesh always has: binary only if a byte
 * among the first 128 after the header is above 127. A model near the origin with small positive
 * coordinates and zero normals has none, reads as ASCII and fails to load. Real normals fix that
 * for any closed mesh, since some face points down or away; a triangle with a negative component
 * is moved to the front to be sure.
 */
export function writeBinaryStl(positions: Float32Array): Uint8Array {
  const count = triangleCount(positions)
  const order = Array.from({ length: count }, (_, index) => index)
  const front = order.findIndex((index) => normalOf(positions, index * 9).some((n) => n < 0))
  if (front > 0) [order[0], order[front]] = [order[front]!, order[0]!]

  const bytes = new Uint8Array(84 + count * 50)
  const view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('RCCF slicer mesh'), 0)
  view.setUint32(80, count, true)
  order.forEach((triangle, slot) => {
    const at = 84 + slot * 50
    const normal = normalOf(positions, triangle * 9)
    for (let j = 0; j < 3; j++) view.setFloat32(at + j * 4, normal[j]!, true)
    for (let j = 0; j < 9; j++) view.setFloat32(at + 12 + j * 4, positions[triangle * 9 + j]!, true)
  })
  return bytes
}

/**
 * Shared vertices and an index, with degenerate triangles dropped. Orca reads a project's mesh
 * as given, so an unwelded soup would slice as thousands of separate triangles.
 */
export function weld(positions: Float32Array): { vertices: Float32Array; indices: Uint32Array } {
  const lookup = new Map<string, number>()
  const vertices: number[] = []
  const indices: number[] = []

  const key = (i: number) => `${positions[i]},${positions[i + 1]},${positions[i + 2]}`
  const vertex = (i: number, k: string) => {
    let index = lookup.get(k)
    if (index === undefined) {
      index = vertices.length / 3
      lookup.set(k, index)
      vertices.push(positions[i]!, positions[i + 1]!, positions[i + 2]!)
    }
    return index
  }

  for (let i = 0; i < positions.length; i += 9) {
    const ka = key(i)
    const kb = key(i + 3)
    const kc = key(i + 6)
    // A triangle with two equal corners is a line; 3MF forbids it and Orca would drop it anyway.
    if (ka === kb || kb === kc || ka === kc) continue
    indices.push(vertex(i, ka), vertex(i + 3, kb), vertex(i + 6, kc))
  }
  if (indices.length === 0) throw new MeshError('Every triangle in the model is flat.')
  return { vertices: Float32Array.from(vertices), indices: Uint32Array.from(indices) }
}
