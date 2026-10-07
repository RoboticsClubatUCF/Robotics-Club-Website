import occtimportjs from 'occt-import-js'
import { MeshError } from './stl.js'

/**
 * A STEP file as one triangle soup, every body in its assembly position.
 *
 * Orca's CLI can't open STEP (only its desktop app can), so the worker meshes it first with the
 * same tolerances desktop Orca uses by default. Run through `stepMeshCli.ts` in a child process:
 * a hostile file can make OpenCascade spin, and a child can be killed.
 */
export async function meshStep(bytes: Uint8Array): Promise<Float32Array> {
  const occt = await occtimportjs()
  const result = occt.ReadStepFile(bytes, {
    linearUnit: 'millimeter',
    linearDeflectionType: 'absolute_value',
    linearDeflection: 0.003,
    angularDeflection: 0.5,
  })
  if (!result.success) throw new MeshError(`The STEP file couldn't be read.`)

  let triangles = 0
  for (const mesh of result.meshes) triangles += mesh.index.array.length / 3
  if (triangles === 0) throw new MeshError('The STEP file has no solid bodies in it.')

  const out = new Float32Array(triangles * 9)
  let at = 0
  for (const mesh of result.meshes) {
    const position = mesh.attributes.position.array
    const index = mesh.index.array
    for (let i = 0; i < index.length; i++) {
      const vertex = index[i]! * 3
      out[at++] = position[vertex]!
      out[at++] = position[vertex + 1]!
      out[at++] = position[vertex + 2]!
    }
  }
  return out
}
