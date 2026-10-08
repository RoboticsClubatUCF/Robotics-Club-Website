import { createWriteStream } from 'node:fs'
import { Zip, ZipDeflate, strFromU8, unzipSync } from 'fflate'
import type { Affine } from './plateTransform.js'
import { weld } from './stl.js'

/**
 * The plate as an OrcaSlicer project, for the worker's Orca to slice.
 *
 * Orca's CLI only keeps the placement it's given when the input is one of its own projects. Given
 * bare STLs with arranging off, it slices them but exports a plate listing nothing, which desktop
 * Orca opens as empty. So the project is written here in the layout Orca 2.4.2 exports: one
 * component object per copy pointing at a shared mesh, one build item per copy carrying its exact
 * transform, and plate 1 naming every instance in `model_settings.config`.
 *
 * Copies are named `<name> #<n>` so each one shows up in desktop Orca's object list.
 */

export interface ProjectMesh {
  positions: Float32Array
}

export interface ProjectObject {
  name: string
  /** Index into `meshes`. */
  mesh: number
  affine: Affine
}

/** What Orca stamps on its own projects, copied from one it exported with the same profiles. */
export interface ProjectHeader {
  /** `Metadata/project_settings.config`, verbatim. */
  settings: string
  /** The `<metadata>` lines of Orca's `3D/3dmodel.model`: application, version, format. */
  metadata: string[]
}

const NAMESPACES =
  'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"'

/** The lines that make Orca read a file as one of its own projects rather than a plain 3MF. */
const HEADER_KEYS = ['Application', 'OrcaSlicer', 'BambuStudio:3mfVersion']

export const escapeXml = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  )

/** A number as Orca reads it: single precision, written short, rounding noise as zero. */
export const num = (value: number): string => {
  if (Math.abs(value) < 1e-12) return '0'
  const text = value.toPrecision(9)
  return text.includes('e') ? text : text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

/** The 3MF `transform`: the 3×3 part column by column, then the translation. */
export function transformAttribute({ m, t }: Affine): string {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8], t[0], t[1], t[2]]
    .map(num)
    .join(' ')
}

/** Reads the settings and the identifying metadata out of a project Orca exported. */
export function readProjectHeader(bytes: Uint8Array): ProjectHeader {
  const entries = unzipSync(bytes, {
    filter: (file) =>
      file.name === 'Metadata/project_settings.config' ||
      file.name === '3D/3dmodel.model',
  })
  const settings = entries['Metadata/project_settings.config']
  const model = entries['3D/3dmodel.model']
  if (!settings || !model) throw new Error('Orca exported a project without its settings')

  // Orca writes some of these twice; the first of each is kept.
  const found = new Map<string, string>()
  for (const match of strFromU8(model).matchAll(
    /<metadata name="([^"]+)">[^<]*<\/metadata>/g,
  )) {
    if (HEADER_KEYS.includes(match[1]!) && !found.has(match[1]!))
      found.set(match[1]!, match[0])
  }
  const metadata = HEADER_KEYS.map((key) => found.get(key)).filter(
    (line) => line !== undefined,
  )
  if (metadata.length !== HEADER_KEYS.length) {
    throw new Error('Orca exported a project without its application metadata')
  }
  return { settings: strFromU8(settings), metadata }
}

const meshPath = (index: number) => `3D/Objects/mesh_${String(index + 1)}.model`

/** A fixed-suffix id in the shape Orca writes. */
const uuid = (n: number, suffix: string) => `${n.toString(16).padStart(8, '0')}${suffix}`

/**
 * Mesh and component ids in Orca's own `<object><volume>` form: the object's number in the top
 * four hex digits, the volume's in the bottom four. Orca reads them back that way, so numbering
 * these 1, 2, 3 makes every copy a volume of the first object.
 */
const partUuid = (object: number, suffix: string) =>
  `${object.toString(16).padStart(4, '0')}0000${suffix}`

function* meshModel(mesh: ProjectMesh, index: number, id: number): Generator<string> {
  const { vertices, indices } = weld(mesh.positions)
  yield `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" ${NAMESPACES}>\n`
  yield ' <metadata name="BambuStudio:3mfVersion">1</metadata>\n <resources>\n'
  yield `  <object id="${String(id)}" p:UUID="${partUuid(index + 1, '-81cb-4c03-9d28-80fed5dfa1dc')}" type="model">\n   <mesh>\n    <vertices>\n`
  for (let i = 0; i < vertices.length; i += 3) {
    yield `     <vertex x="${num(vertices[i]!)}" y="${num(vertices[i + 1]!)}" z="${num(vertices[i + 2]!)}"/>\n`
  }
  yield '    </vertices>\n    <triangles>\n'
  for (let i = 0; i < indices.length; i += 3) {
    yield `     <triangle v1="${String(indices[i])}" v2="${String(indices[i + 1])}" v3="${String(indices[i + 2])}"/>\n`
  }
  yield '    </triangles>\n   </mesh>\n  </object>\n </resources>\n <build/>\n</model>\n'
}

function projectFiles(input: {
  meshes: ProjectMesh[]
  objects: ProjectObject[]
  header: ProjectHeader
}): { name: string; lines: () => Iterable<string> }[] {
  const { meshes, objects, header } = input
  // Ids are unique across every file in the project, not per file: Orca caches the meshes it
  // loads by object id alone, so two mesh files that both said id 1 made every copy the first
  // model. Meshes take 1..m and the copies' wrapper objects come after.
  const meshId = (index: number) => index + 1
  const wrapperId = (index: number) => meshes.length + index + 1

  const model = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<model unit="millimeter" xml:lang="en-US" ${NAMESPACES}>`,
    ...header.metadata.map((line) => ` ${line}`),
    ' <resources>',
    ...objects.flatMap((object, index) => [
      `  <object id="${String(wrapperId(index))}" p:UUID="${uuid(index + 1, '-61cb-4c03-9d28-80fed5dfa1dc')}" type="model">`,
      '   <components>',
      `    <component p:path="/${meshPath(object.mesh)}" objectid="${String(meshId(object.mesh))}" p:UUID="${partUuid(index + 1, '-b206-40ff-9872-83e8017abed1')}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`,
      '   </components>',
      '  </object>',
    ]),
    ' </resources>',
    ' <build p:UUID="2c7c17d8-22b5-4d84-8835-1976022ea369">',
    ...objects.map(
      (object, index) =>
        `  <item objectid="${String(wrapperId(index))}" p:UUID="${uuid(index + 1, '-b1ec-4553-aec9-835e5b724bb4')}" transform="${transformAttribute(object.affine)}" printable="1"/>`,
    ),
    ' </build>',
    '</model>',
    '',
  ].join('\n')

  const rels = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ...meshes.map(
      (_, index) =>
        ` <Relationship Target="/${meshPath(index)}" Id="rel-${String(index + 1)}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>`,
    ),
    '</Relationships>',
    '',
  ].join('\n')

  const modelSettings = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<config>',
    ...objects.flatMap((object, index) => [
      `  <object id="${String(wrapperId(index))}">`,
      `    <metadata key="name" value="${escapeXml(object.name)}"/>`,
      '    <metadata key="extruder" value="1"/>',
      `    <part id="${String(meshId(object.mesh))}" subtype="normal_part">`,
      `      <metadata key="name" value="${escapeXml(object.name)}"/>`,
      '      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>',
      '    </part>',
      '  </object>',
    ]),
    '  <plate>',
    '    <metadata key="plater_id" value="1"/>',
    '    <metadata key="plater_name" value=""/>',
    '    <metadata key="locked" value="false"/>',
    ...objects.flatMap((_, index) => [
      '    <model_instance>',
      `      <metadata key="object_id" value="${String(wrapperId(index))}"/>`,
      '      <metadata key="instance_id" value="0"/>',
      `      <metadata key="identify_id" value="${String(1000 + index)}"/>`,
      '    </model_instance>',
    ]),
    '  </plate>',
    '</config>',
    '',
  ].join('\n')

  const once = (text: string) => () => [text]
  return [
    {
      name: '[Content_Types].xml',
      lines: once(
        '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n <Default Extension="png" ContentType="image/png"/>\n <Default Extension="gcode" ContentType="text/x.gcode"/>\n</Types>\n',
      ),
    },
    {
      name: '_rels/.rels',
      lines: once(
        '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>\n',
      ),
    },
    { name: '3D/3dmodel.model', lines: once(model) },
    { name: '3D/_rels/3dmodel.model.rels', lines: once(rels) },
    ...meshes.map((mesh, index) => ({
      name: meshPath(index),
      lines: () => meshModel(mesh, index, meshId(index)),
    })),
    { name: 'Metadata/model_settings.config', lines: once(modelSettings) },
    { name: 'Metadata/project_settings.config', lines: once(header.settings) },
  ]
}

/**
 * Writes the project to `path`, deflating as it goes so a large mesh is never one string in
 * memory.
 */
export function writeProject(
  path: string,
  input: { meshes: ProjectMesh[]; objects: ProjectObject[]; header: ProjectHeader },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(path)
    out.on('error', reject)
    out.on('finish', () => resolve())

    const zip = new Zip((error, chunk, final) => {
      if (error) {
        reject(error)
        out.destroy()
        return
      }
      out.write(chunk)
      if (final) out.end()
    })

    const encoder = new TextEncoder()
    for (const file of projectFiles(input)) {
      const entry = new ZipDeflate(file.name, { level: 6 })
      zip.add(entry)
      let buffer = ''
      for (const line of file.lines()) {
        buffer += line
        if (buffer.length >= 256 * 1024) {
          entry.push(encoder.encode(buffer))
          buffer = ''
        }
      }
      entry.push(encoder.encode(buffer), true)
    }
    zip.end()
  })
}
