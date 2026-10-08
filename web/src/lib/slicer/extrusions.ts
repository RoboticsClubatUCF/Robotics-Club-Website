import {
  BufferAttribute,
  Color,
  DataTexture,
  Float32BufferAttribute,
  FloatType,
  InstancedBufferGeometry,
  Mesh,
  NearestFilter,
  RGBAFormat,
  ShaderMaterial,
} from 'three'
import { MITRE_LIMIT, MITRE_STEPS, type RoleLines, SEGMENTS_PER_ROW, SEGMENT_FLOATS } from './preview'

/**
 * Toolpaths drawn as what they print: every segment a bead as wide as Orca's line and as tall as
 * its layer, shaded round, so neighbouring lines and layers stay apart however close the camera
 * gets. A line one pixel wide at every zoom can't do that; up close it's a tangle.
 *
 * The GPU builds the beads. It reads the segments from a texture, the decoder's array as it is,
 * and fits one bead shape to each. They go 64 to an instance: an integrated GPU spends most of
 * its time starting instances, and one bead each ran the 4M-segment cap at six frames a second
 * on an Intel laptop.
 */

const BATCH = 64

/**
 * The bead in its own frame: x runs along the segment from 0 to 1, y across it and z up it, each
 * -1 to 1. Its section is a diamond whose normals are smoothed into a round line, with its widest
 * point halfway up, so stacked layers meet at a seam and read as layers. A ring at each end makes
 * the sides, and a tip (y and z both 0) closes each end. `slot` is which of the instance's beads a
 * vertex is on.
 */
function batchGeometry(): InstancedBufferGeometry {
  const ring = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as const
  const corner: number[] = []
  for (const end of [0, 1]) for (const [y, z] of ring) corner.push(end, y, z)
  corner.push(0, 0, 0, 1, 0, 0)
  const index: number[] = []
  for (let k = 0; k < 4; k++) {
    const next = (k + 1) % 4
    // Sides, then the start tip's face and the end tip's, all wound to face outwards.
    index.push(k, 4 + next, 4 + k, k, next, 4 + next, 8, next, k, 9, 4 + k, 4 + next)
  }

  const vertices = corner.length / 3
  const positions = new Float32Array(corner.length * BATCH)
  const slots = new Float32Array(vertices * BATCH)
  const indices = new Uint16Array(index.length * BATCH)
  for (let b = 0; b < BATCH; b++) {
    positions.set(corner, b * corner.length)
    slots.fill(b, b * vertices, (b + 1) * vertices)
    indices.set(
      index.map((i) => i + b * vertices),
      b * index.length,
    )
  }
  const geometry = new InstancedBufferGeometry()
  geometry.setIndex(new BufferAttribute(indices, 1))
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('slot', new Float32BufferAttribute(slots, 1))
  return geometry
}

const vertexShader = /* glsl */ `
  uniform sampler2D segments;
  uniform int count;
  attribute float slot;
  varying vec3 vNormal;

  void main() {
    int index = gl_InstanceID * ${String(BATCH)} + int(slot);
    // The last instance's spare beads, and every layer above the slider, collapse off screen.
    if (index >= count) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    // Two texels a segment: x1 y1 x2 y2, then z, width, height, mitres.
    ivec2 texel = ivec2((index % ${String(SEGMENTS_PER_ROW)}) * 2, index / ${String(SEGMENTS_PER_ROW)});
    vec4 ends = texelFetch(segments, texel, 0);
    vec4 rest = texelFetch(segments, texel + ivec2(1, 0), 0);
    int mitres = int(rest.w + 0.5);
    // The decoder leaves out segments with no length, so every one has a direction.
    vec2 along = normalize(ends.zw - ends.xy);
    float half_width = 0.5 * rest.y;
    float half_height = 0.5 * rest.z;

    bool at_end = position.x > 0.5;
    bool tip = position.y == 0.0 && position.z == 0.0;
    vec2 across = vec2(-along.y, along.x);
    float reach = half_width;
    int mitre = at_end ? mitres / 4096 : mitres - (mitres / 4096) * 4096;
    bool joined = mitre != 0;
    if (joined) {
      // Where the path carries on, the ring sits on the plane halfway between the two segments,
      // widened to meet both sides, so the beads join flush and shade as one.
      float angle = (float(mitre - 1) / ${(MITRE_STEPS - 1).toFixed(1)} * 2.0 - 1.0) * ${MITRE_LIMIT.toFixed(7)};
      vec2 tangent = mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * along;
      across = vec2(-tangent.y, tangent.x);
      reach = half_width / cos(angle);
    }

    // The nozzle's height is the top of the line, so its middle is half a layer down.
    vec3 point = vec3(at_end ? ends.zw : ends.xy, rest.x - half_height);
    vec3 facing;
    if (tip) {
      // Where the path stops, the end comes to a rounded point half a line beyond it.
      float outward = at_end ? 1.0 : -1.0;
      point.xy += joined ? vec2(0.0) : along * (outward * half_width);
      facing = vec3(along * outward, 0.0);
    } else {
      point += vec3(across * (position.y * reach), position.z * half_height);
      facing = vec3(across * position.y, position.z);
    }

    vNormal = normalize(normalMatrix * facing);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
  }
`


const fragmentShader = /* glsl */ `
  uniform vec3 color;
  varying vec3 vNormal;

  // Fixed to the camera, as Orca's preview lights are: one from the upper left, one from the
  // front, so every side of a part reads the same as it's turned. They add up to no more than
  // full colour where a line faces the viewer; past that the gold clips flat and the layers vanish.
  const vec3 TOP = vec3(-0.4574957, 0.4574957, 0.7624929);
  const vec3 FRONT = vec3(0.6985074, 0.1397015, 0.6985074);

  void main() {
    vec3 n = normalize(vNormal);
    float diffuse = 0.5 * max(dot(n, TOP), 0.0) + 0.25 * max(dot(n, FRONT), 0.0);
    float shine = 0.1 * pow(max(dot(reflect(-TOP, n), vec3(0.0, 0.0, 1.0)), 0.0), 20.0);
    gl_FragColor = vec4(color * (0.3 + diffuse) + shine, 1.0);
    #include <colorspace_fragment>
  }
`

export type Extrusions = Mesh<InstancedBufferGeometry, ShaderMaterial>

/**
 * Whether a device whose textures go up to `maxSize` texels a side can hold this role. WebGL 2
 * only promises 2048; nearly everything does 8192 or more, which is 16M segments a role.
 */
export function fitsTexture(lines: RoleLines, maxSize: number): boolean {
  return SEGMENTS_PER_ROW * 2 <= maxSize && lines.segments.length / SEGMENT_FLOATS / SEGMENTS_PER_ROW <= maxSize
}

/** One role's toolpaths as beads, all of them showing until `showSegments` says otherwise. */
export function makeExtrusions(lines: RoleLines): Extrusions {
  const total = lines.layerStart.at(-1) ?? 0
  const texture = new DataTexture(
    lines.segments,
    SEGMENTS_PER_ROW * 2,
    lines.segments.length / SEGMENT_FLOATS / SEGMENTS_PER_ROW,
    RGBAFormat,
    FloatType,
  )
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.needsUpdate = true

  const material = new ShaderMaterial({
    uniforms: { color: { value: new Color() }, segments: { value: texture }, count: { value: total } },
    vertexShader,
    fragmentShader,
  })
  const mesh = new Mesh(batchGeometry(), material)
  mesh.geometry.instanceCount = Math.ceil(total / BATCH)
  // The bead's own bounds say nothing about where the beads are, so three can't cull by them.
  mesh.frustumCulled = false
  return mesh
}

/** Draws the first `count` segments: every layer up to the one the slider picks. */
export function showSegments(extrusions: Extrusions, count: number): void {
  extrusions.material.uniforms['count']!.value = count
  extrusions.geometry.instanceCount = Math.ceil(count / BATCH)
}

export function setExtrusionColor(extrusions: Extrusions, color: Color): void {
  ;(extrusions.material.uniforms['color']!.value as Color).copy(color)
}

export function disposeExtrusions(extrusions: Extrusions): void {
  extrusions.geometry.dispose()
  ;(extrusions.material.uniforms['segments']!.value as DataTexture).dispose()
  extrusions.material.dispose()
}
