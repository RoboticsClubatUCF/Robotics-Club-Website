import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { afterAll, describe, expect, it } from 'vitest'
import {
  num,
  readProjectHeader,
  transformAttribute,
  writeProject,
} from './orcaProject.js'
import { placementAffine } from './plateTransform.js'

const dir = mkdtempSync(join(tmpdir(), 'rccf-project-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const fixture = new Uint8Array(
  readFileSync(new URL('./fixtures/sliced-cube.3mf', import.meta.url)),
)
const tetra = Float32Array.from([
  0, 0, 0, 0, 10, 0, 10, 0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0, 10, 0, 10, 0,
  10, 0, 0, 0, 10, 0, 0, 0, 10,
])
const place = (x: number, y: number) =>
  placementAffine(tetra, { x, y, qx: 0, qy: 0, qz: 0, qw: 1, sx: 1, sy: 1, sz: 1 })

describe('writeProject', () => {
  it('gives every object a project-wide id, and copies share their mesh', async () => {
    const path = join(dir, 'plate.3mf')
    await writeProject(path, {
      meshes: [{ positions: tetra }, { positions: tetra.map((v) => v * 2) }],
      objects: [
        { name: 'a #1', mesh: 0, affine: place(50, 50) },
        { name: 'a #2', mesh: 0, affine: place(100, 50) },
        { name: 'b <&> #3', mesh: 1, affine: place(150, 50) },
      ],
      header: readProjectHeader(fixture),
    })
    const files = unzipSync(new Uint8Array(readFileSync(path)))
    const model = strFromU8(files['3D/3dmodel.model']!)

    // Orca caches meshes by object id alone; two files both saying id 1 made every copy the
    // first model.
    const meshIds = ['3D/Objects/mesh_1.model', '3D/Objects/mesh_2.model'].map(
      (name) => /<object id="(\d+)"/.exec(strFromU8(files[name]!))![1],
    )
    expect(meshIds).toEqual(['1', '2'])
    const wrappers = [...model.matchAll(/<object id="(\d+)"/g)].map((match) => match[1])
    expect(wrappers).toEqual(['3', '4', '5'])
    const components = [...model.matchAll(/p:path="([^"]+)" objectid="(\d+)"/g)].map(
      (match) => [match[1], match[2]],
    )
    expect(components).toEqual([
      ['/3D/Objects/mesh_1.model', '1'],
      ['/3D/Objects/mesh_1.model', '1'],
      ['/3D/Objects/mesh_2.model', '2'],
    ])
    expect(model).toContain('<metadata name="Application">')
    expect(model).toContain(`transform="${transformAttribute(place(100, 50))}"`)

    const settings = strFromU8(files['Metadata/model_settings.config']!)
    expect(settings.match(/<model_instance>/g)).toHaveLength(3)
    expect(settings).toContain('value="b &lt;&amp;&gt; #3"')
    expect(strFromU8(files['Metadata/project_settings.config']!)).toContain(
      'print_settings_id',
    )
  })
})

describe('num', () => {
  it('writes numbers short, and rounding noise as zero', () => {
    expect(num(1)).toBe('1')
    expect(num(0.5)).toBe('0.5')
    expect(num(128.25)).toBe('128.25')
    expect(num(4e-17)).toBe('0')
    expect(num(-0.70710678118)).toBe('-0.707106781')
  })
})
