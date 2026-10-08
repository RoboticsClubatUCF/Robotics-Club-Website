import { describe, expect, it } from 'vitest'
import { MeshError, parseStl, weld, writeBinaryStl } from './stl.js'

const tetra = Float32Array.from([
  0, 0, 0, 0, 10, 0, 10, 0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0, 10, 0, 10, 0,
  10, 0, 0, 0, 10, 0, 0, 0, 10,
])

describe('stl', () => {
  it('round-trips through binary STL', () => {
    expect(parseStl(writeBinaryStl(tetra))).toEqual(tetra)
  })

  it('reads ASCII STL', () => {
    const text = `solid t\nfacet normal 0 0 -1\nouter loop\nvertex 0 0 0\nvertex 0 1 0\nvertex 1 0 0\nendloop\nendfacet\nendsolid t\n`
    expect(Array.from(parseStl(new TextEncoder().encode(text)))).toEqual([
      0, 0, 0, 0, 1, 0, 1, 0, 0,
    ])
  })

  it('reads a binary file whose header starts with "solid"', () => {
    const bytes = writeBinaryStl(tetra)
    bytes.set(new TextEncoder().encode('solid but binary'), 0)
    expect(parseStl(bytes)).toEqual(tetra)
  })

  it('writes a byte above 127 early, so Orca reads the file as binary', () => {
    // All-positive coordinates near the origin: zero normals would leave none.
    const bytes = writeBinaryStl(tetra)
    expect(bytes.subarray(80, 208).some((byte) => byte > 127)).toBe(true)
  })

  it('refuses an empty file', () => {
    expect(() =>
      parseStl(new TextEncoder().encode('solid empty\nendsolid empty\n')),
    ).toThrow(MeshError)
  })

  it('welds shared corners and drops flat triangles', () => {
    const withFlat = Float32Array.from([...tetra, 1, 1, 1, 1, 1, 1, 2, 2, 2])
    const { vertices, indices } = weld(withFlat)
    expect(vertices.length / 3).toBe(4)
    expect(indices.length / 3).toBe(4)
  })
})
