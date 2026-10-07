/**
 * `node --import tsx stepMeshCli.ts <in.step> <out.stl>`: the worker's child process for STEP.
 * Exits 2 on bad arguments and 3 when the file can't be meshed, printing one line of JSON.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { meshStep } from './stepMesh.js'
import { writeBinaryStl } from './stl.js'

const [source, target] = process.argv.slice(2)

if (!source || !target) {
  console.log(JSON.stringify({ error: 'usage: stepMeshCli <in.step> <out.stl>' }))
  process.exit(2)
}

try {
  const positions = await meshStep(new Uint8Array(await readFile(source)))
  await writeFile(target, writeBinaryStl(positions))
  console.log(JSON.stringify({ triangles: positions.length / 9 }))
} catch (error) {
  console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  process.exit(3)
}
