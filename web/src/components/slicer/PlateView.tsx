import { useEffect, useRef, useState } from 'react'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { ApiPlacement, ApiPlateObject } from '../../lib/api/api'
import { restingFaces } from '../../lib/slicer/faces'
import type { MeshMap } from '../../lib/slicer/meshes'
import {
  type Affine,
  type Bed,
  type FitProblem,
  MAX_SCALE,
  MIN_SCALE,
  canonicalQuat,
  placedBox,
  placementAffine,
} from '../../lib/slicer/plateTransform'
import {
  type Stage,
  type ThemeColors,
  createStage,
  disposeTree,
  makeBed,
  themeColors,
} from '../../lib/slicer/scene'
import { useTheme } from '../../lib/theme'

export type PlateMode = 'move' | 'rotate' | 'scale' | 'flat'

interface Props {
  bed: Bed
  objects: ApiPlateObject[]
  meshes: MeshMap
  selected: string[]
  problems: ReadonlyMap<string, FitProblem>
  mode: PlateMode
  onSelect: (ids: string[]) => void
  /** A drag in progress: shown, not saved. */
  onDrag: (id: string, placement: Partial<ApiPlacement>) => void
  /** A drag finished, or a gizmo let go: saved. */
  onCommit: (id: string, placement: Partial<ApiPlacement>) => void
  /** A face picked in LAY ON FACE, as a direction on the plate. */
  onLayFlat: (id: string, normal: [number, number, number]) => void
}

interface Scene3d {
  stage: Stage
  bed: Group
  objects: Group
  gizmo: TransformControls
  proxy: Object3D
  geometries: Map<string, { positions: Float32Array; geometry: BufferGeometry }>
  meshes: Map<string, Mesh>
  materials: { model: MeshLambertMaterial; selected: MeshLambertMaterial; problem: MeshLambertMaterial }
  /** Placement at x = y = 0, by model and turn and size: the lift is the expensive part. */
  lifted: Map<string, Affine>
  colors: ThemeColors
  /** LAY ON FACE: each model's faces it can lie on, and the selected objects' overlays of them. */
  faceGeometries: Map<
    string,
    { positions: Float32Array; faces: { geometry: BufferGeometry; outline: BufferGeometry; normal: Vector3 }[] }
  >
  overlays: Map<string, Group>
  faceMaterials: { idle: MeshBasicMaterial; hot: MeshBasicMaterial; edge: LineBasicMaterial }
  hovered: Mesh | null
}

/** A face overlay over its object: drawn on top of the surface it lies on, from either side. */
const faceMaterial = (colors: ThemeColors, opacity: number) =>
  new MeshBasicMaterial({
    color: colors.selected,
    transparent: true,
    opacity,
    depthWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  })

const turnKey = (object: ApiPlateObject) =>
  [object.modelId, object.qx, object.qy, object.qz, object.qw, object.sx, object.sy, object.sz].join(',')

/**
 * The build plate in 3D, for arranging what's on it.
 *
 * Click to select (Shift or Ctrl adds), drag a selected object across the bed to move it, and
 * in ROTATE or SCALE mode use the gizmo on it, the way Orca's Prepare view works. LAY ON FACE
 * shades the selected object's faces it could lie on, brightens the one under the pointer, and
 * puts a clicked one down on the bed. Everything here can also be done from the object panel,
 * which is where a keyboard does it.
 *
 * Three.js is imported only by the workspace's chunk. The view draws when something changes, not
 * in a loop, so an idle plate costs nothing.
 */
export function PlateView(props: Props) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const three = useRef<Scene3d | null>(null)
  const latest = useRef(props)
  const theme = useTheme()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    latest.current = props
  })

  // The scene, once per bed.
  useEffect(() => {
    if (!canvas.current || !host.current) return
    const stage = createStage(canvas.current, host.current, props.bed)
    if (!stage) {
      setFailed(true)
      return
    }
    const colors = themeColors()
    stage.renderer.setClearColor(colors.background)
    const bed = makeBed(props.bed, colors)
    const objects = new Group()
    stage.scene.add(bed, objects)

    const proxy = new Object3D()
    stage.scene.add(proxy)
    const gizmo = new TransformControls(stage.camera, stage.renderer.domElement)
    gizmo.setSize(0.8)
    stage.scene.add(gizmo.getHelper())

    const scene: Scene3d = {
      stage,
      bed,
      objects,
      gizmo,
      proxy,
      geometries: new Map(),
      meshes: new Map(),
      materials: {
        model: new MeshLambertMaterial({ color: colors.model }),
        selected: new MeshLambertMaterial({ color: colors.selected }),
        problem: new MeshLambertMaterial({ color: colors.problem }),
      },
      lifted: new Map(),
      colors,
      faceGeometries: new Map(),
      overlays: new Map(),
      faceMaterials: {
        idle: faceMaterial(colors, 0.25),
        hot: faceMaterial(colors, 0.85),
        edge: new LineBasicMaterial({ color: colors.selected }),
      },
      hovered: null,
    }
    three.current = scene

    const placementFromProxy = (): Partial<ApiPlacement> => {
      const { mode } = latest.current
      if (mode === 'rotate') {
        const q = proxy.quaternion
        return canonicalQuat({ qx: q.x, qy: q.y, qz: q.z, qw: q.w })
      }
      const clamp = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.abs(value)))
      return { sx: clamp(proxy.scale.x), sy: clamp(proxy.scale.y), sz: clamp(proxy.scale.z) }
    }
    gizmo.addEventListener('change', stage.render)
    gizmo.addEventListener('objectChange', () => {
      const id = latest.current.selected[0]
      if (id) latest.current.onDrag(id, placementFromProxy())
    })
    gizmo.addEventListener('dragging-changed', (event) => {
      stage.orbit.enabled = !event.value
      const id = latest.current.selected[0]
      if (!event.value && id) latest.current.onCommit(id, placementFromProxy())
    })

    const raycaster = new Raycaster()
    const pointer = new Vector2()
    const bedPlane = new Plane(new Vector3(0, 0, 1), 0)
    const element = stage.renderer.domElement
    let down: { x: number; y: number; id: string | null; offset: Vector2 | null } | null = null
    let dragged = false

    const aim = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect()
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, stage.camera)
    }
    const objectAt = () => {
      const hit = raycaster.intersectObjects(objects.children, false)[0]
      return hit ? { id: hit.object.name, hit } : null
    }
    const onBed = () => raycaster.ray.intersectPlane(bedPlane, new Vector3())
    /** The face overlay under the pointer, unless another object is in front of it. */
    const faceAt = () => {
      const overlays = [...scene.overlays.values()].flatMap((group) => group.children)
      if (overlays.length === 0) return null
      const hit = raycaster.intersectObjects(overlays, false)[0]
      if (!hit) return null
      const nearest = raycaster.intersectObjects(objects.children, false)[0]
      if (nearest && nearest.distance < hit.distance - 0.01) return null
      return hit.object as Mesh
    }
    const hover = (face: Mesh | null) => {
      if (face === scene.hovered) return
      if (scene.hovered) scene.hovered.material = scene.faceMaterials.idle
      if (face) face.material = scene.faceMaterials.hot
      scene.hovered = face
      element.style.cursor = face ? 'pointer' : ''
      stage.render()
    }

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || gizmo.dragging) return
      aim(event)
      const found = objectAt()
      const { mode, selected, objects: placed } = latest.current
      let offset: Vector2 | null = null
      if (found && mode === 'move' && (selected.includes(found.id) || !event.shiftKey)) {
        const object = placed.find((o) => o.id === found.id)
        const at = onBed()
        if (object && at) {
          offset = new Vector2(object.x - at.x, object.y - at.y)
          stage.orbit.enabled = false
          element.setPointerCapture(event.pointerId)
        }
      }
      down = { x: event.clientX, y: event.clientY, id: found?.id ?? null, offset }
      dragged = false
    }

    const onMove = (event: PointerEvent) => {
      if (!down && latest.current.mode === 'flat') {
        aim(event)
        hover(faceAt())
        return
      }
      if (!down?.offset || !down.id) return
      if (!dragged && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 4) return
      if (!dragged) {
        dragged = true
        if (!latest.current.selected.includes(down.id)) latest.current.onSelect([down.id])
      }
      aim(event)
      const at = onBed()
      if (at) {
        latest.current.onDrag(down.id, {
          x: Math.round((at.x + down.offset.x) * 10) / 10,
          y: Math.round((at.y + down.offset.y) * 10) / 10,
        })
      }
    }

    const onUp = (event: PointerEvent) => {
      if (!down) return
      stage.orbit.enabled = true
      const { mode, selected, objects: placed } = latest.current
      if (dragged && down.id) {
        const object = placed.find((o) => o.id === down!.id)
        if (object) latest.current.onCommit(down.id, { x: object.x, y: object.y })
      } else if (Math.hypot(event.clientX - down.x, event.clientY - down.y) < 4) {
        aim(event)
        const face = mode === 'flat' ? faceAt() : null
        const found = objectAt()
        if (face) {
          // The face's normal is the mesh's own; on the plate it's turned and sized with it.
          face.updateWorldMatrix(true, false)
          const normal = (face.userData['normal'] as Vector3)
            .clone()
            .applyMatrix3(new Matrix3().getNormalMatrix(face.matrixWorld))
            .normalize()
          latest.current.onLayFlat(face.userData['objectId'] as string, [normal.x, normal.y, normal.z])
        } else if (mode === 'flat' && found && selected.includes(found.id)) {
          // A part of the selected object with no face to lie on: nothing to do.
        } else if (!found) {
          latest.current.onSelect([])
        } else if (event.shiftKey || event.ctrlKey || event.metaKey) {
          latest.current.onSelect(
            selected.includes(found.id) ? selected.filter((id) => id !== found.id) : [...selected, found.id],
          )
        } else {
          latest.current.onSelect([found.id])
        }
      }
      down = null
      dragged = false
    }

    const onLeave = () => {
      hover(null)
    }

    element.addEventListener('pointerdown', onDown)
    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerup', onUp)
    element.addEventListener('pointercancel', onUp)
    element.addEventListener('pointerleave', onLeave)

    return () => {
      element.removeEventListener('pointerdown', onDown)
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerup', onUp)
      element.removeEventListener('pointercancel', onUp)
      element.removeEventListener('pointerleave', onLeave)
      gizmo.detach()
      gizmo.dispose()
      disposeTree(bed)
      for (const { geometry } of scene.geometries.values()) geometry.dispose()
      for (const { faces } of scene.faceGeometries.values()) {
        faces.forEach((face) => {
          face.geometry.dispose()
          face.outline.dispose()
        })
      }
      Object.values(scene.materials).forEach((material) => material.dispose())
      Object.values(scene.faceMaterials).forEach((material) => material.dispose())
      stage.dispose()
      three.current = null
    }
    // Rebuilt for a new bed only; everything else is synced below.
  }, [props.bed])

  // Colours follow the theme.
  useEffect(() => {
    const scene = three.current
    if (!scene) return
    const colors = themeColors()
    scene.colors = colors
    scene.stage.renderer.setClearColor(colors.background)
    scene.materials.model.color.copy(colors.model)
    scene.materials.selected.color.copy(colors.selected)
    scene.materials.problem.color.copy(colors.problem)
    scene.faceMaterials.idle.color.copy(colors.selected)
    scene.faceMaterials.hot.color.copy(colors.selected)
    scene.faceMaterials.edge.color.copy(colors.selected)
    scene.stage.scene.remove(scene.bed)
    disposeTree(scene.bed)
    scene.bed = makeBed(props.bed, colors)
    scene.stage.scene.add(scene.bed)
    scene.stage.render()
  }, [theme, props.bed])

  // The objects, their placement and how each one is drawn.
  useEffect(() => {
    const scene = three.current
    if (!scene) return
    const { objects, meshes, selected, problems } = props

    for (const [modelId, positions] of meshes) {
      if (scene.geometries.get(modelId)?.positions === positions) continue
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
      geometry.computeVertexNormals()
      geometry.computeBoundingSphere()
      scene.geometries.set(modelId, { positions, geometry })
    }

    const live = new Set<string>()
    for (const object of objects) {
      const entry = scene.geometries.get(object.modelId)
      if (!entry) continue
      live.add(object.id)
      let mesh = scene.meshes.get(object.id)
      if (!mesh || mesh.geometry !== entry.geometry) {
        if (mesh) scene.objects.remove(mesh)
        mesh = new Mesh(entry.geometry, scene.materials.model)
        mesh.name = object.id
        mesh.matrixAutoUpdate = false
        scene.meshes.set(object.id, mesh)
        scene.objects.add(mesh)
      }
      const key = turnKey(object)
      let base = scene.lifted.get(key)
      if (!base) {
        base = placementAffine(entry.positions, { ...object, x: 0, y: 0 })
        if (scene.lifted.size > 500) scene.lifted.clear()
        scene.lifted.set(key, base)
      }
      const { m, t } = base
      mesh.matrix.copy(
        new Matrix4().set(m[0], m[1], m[2], t[0] + object.x, m[3], m[4], m[5], t[1] + object.y, m[6], m[7], m[8], t[2], 0, 0, 0, 1),
      )
      mesh.matrixWorldNeedsUpdate = true
      // In LAY ON FACE the gold is the faces', so the object itself stays plain.
      mesh.material = problems.has(object.id)
        ? scene.materials.problem
        : selected.includes(object.id) && props.mode !== 'flat'
          ? scene.materials.selected
          : scene.materials.model

      // LAY ON FACE: the faces a selected object could lie on, over it and moving with it.
      const wanted = props.mode === 'flat' && selected.includes(object.id)
      let overlay = scene.overlays.get(object.id)
      if (overlay && (!wanted || overlay.parent !== mesh || overlay.userData['positions'] !== entry.positions)) {
        overlay.removeFromParent()
        scene.overlays.delete(object.id)
        overlay = undefined
      }
      if (wanted && !overlay) {
        let found = scene.faceGeometries.get(object.modelId)
        if (found?.positions !== entry.positions) {
          found?.faces.forEach((face) => {
            face.geometry.dispose()
            face.outline.dispose()
          })
          found = {
            positions: entry.positions,
            faces: restingFaces(entry.positions).map((face) => {
              const geometry = new BufferGeometry()
              geometry.setAttribute('position', new Float32BufferAttribute(face.positions, 3))
              geometry.computeBoundingSphere()
              // The edge sits a hair off the surface so the surface doesn't hide it.
              const lifted = face.outline.map((value, i) => value + face.normal[i % 3]! * 0.05)
              const outline = new BufferGeometry()
              outline.setAttribute('position', new Float32BufferAttribute(lifted, 3))
              return { geometry, outline, normal: new Vector3(...face.normal) }
            }),
          }
          scene.faceGeometries.set(object.modelId, found)
        }
        overlay = new Group()
        overlay.userData['positions'] = entry.positions
        for (const face of found.faces) {
          const shade = new Mesh(face.geometry, scene.faceMaterials.idle)
          shade.userData['objectId'] = object.id
          shade.userData['normal'] = face.normal
          // A child of the shade, so picking, which looks at shades only, never lands on it.
          shade.add(new LineSegments(face.outline, scene.faceMaterials.edge))
          overlay.add(shade)
        }
        mesh.add(overlay)
        scene.overlays.set(object.id, overlay)
      }
    }
    for (const [id, overlay] of scene.overlays) {
      if (live.has(id)) continue
      overlay.removeFromParent()
      scene.overlays.delete(id)
    }
    if (scene.hovered && !scene.hovered.parent?.parent) {
      scene.hovered.material = scene.faceMaterials.idle
      scene.hovered = null
      scene.stage.renderer.domElement.style.cursor = ''
    }
    for (const [id, mesh] of scene.meshes) {
      if (live.has(id)) continue
      scene.objects.remove(mesh)
      scene.meshes.delete(id)
    }
    for (const [modelId, entry] of scene.geometries) {
      if (meshes.has(modelId)) continue
      entry.geometry.dispose()
      scene.geometries.delete(modelId)
      scene.faceGeometries.get(modelId)?.faces.forEach((face) => {
        face.geometry.dispose()
        face.outline.dispose()
      })
      scene.faceGeometries.delete(modelId)
    }

    // The gizmo sits on the one selected object, in ROTATE and SCALE.
    const one = selected.length === 1 ? objects.find((o) => o.id === selected[0]) : undefined
    const positions = one ? meshes.get(one.modelId) : undefined
    if (one && positions && (props.mode === 'rotate' || props.mode === 'scale')) {
      if (!scene.gizmo.dragging) {
        const box = placedBox(positions, placementAffine(positions, one))
        scene.proxy.position.set(one.x, one.y, (box.max[2] - box.min[2]) / 2)
        scene.proxy.quaternion.set(one.qx, one.qy, one.qz, one.qw)
        scene.proxy.scale.set(one.sx, one.sy, one.sz)
        scene.proxy.updateMatrixWorld()
      }
      scene.gizmo.setMode(props.mode)
      if (scene.gizmo.object !== scene.proxy) scene.gizmo.attach(scene.proxy)
    } else if (scene.gizmo.object) {
      scene.gizmo.detach()
    }
    scene.stage.render()
  })

  const count = props.objects.length

  return (
    <div ref={host} className="absolute inset-0">
      {failed ? (
        <div className="flex h-full items-center justify-center p-6">
          <p className="text-dim max-w-sm text-center text-[13px] leading-[1.6]">
            This browser can't draw the 3D view. Use the object panel to place things; slicing
            and sending still work.
          </p>
        </div>
      ) : (
        <canvas
          ref={canvas}
          role="img"
          aria-label={`Build plate with ${String(count)} ${count === 1 ? 'object' : 'objects'}. Use the object panel to move them with a keyboard.`}
          className={`block h-full w-full touch-none ${props.mode === 'flat' ? 'cursor-crosshair' : ''}`}
        />
      )}
    </div>
  )
}
