import { useEffect, useRef, useState } from 'react'
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix3,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { ApiPlacement, ApiPlateObject } from '../../lib/api/api'
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
  /** A face clicked in LAY ON FACE, as a direction on the plate. */
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
}

const turnKey = (object: ApiPlateObject) =>
  [object.modelId, object.qx, object.qy, object.qz, object.qw, object.sx, object.sy, object.sz].join(',')

/**
 * The build plate in 3D, for arranging what's on it.
 *
 * Click to select (Shift or Ctrl adds), drag a selected object across the bed to move it, and
 * in ROTATE or SCALE mode use the gizmo on it, the way Orca's Prepare view works. LAY ON FACE
 * turns the clicked face down onto the bed. Everything here can also be done from the object
 * panel, which is where a keyboard does it.
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
        const found = objectAt()
        if (mode === 'flat' && found?.hit.face && selected.includes(found.id)) {
          const normal = found.hit.face.normal
            .clone()
            .applyMatrix3(new Matrix3().getNormalMatrix(found.hit.object.matrixWorld))
            .normalize()
          latest.current.onLayFlat(found.id, [normal.x, normal.y, normal.z])
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

    element.addEventListener('pointerdown', onDown)
    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerup', onUp)
    element.addEventListener('pointercancel', onUp)

    return () => {
      element.removeEventListener('pointerdown', onDown)
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerup', onUp)
      element.removeEventListener('pointercancel', onUp)
      gizmo.detach()
      gizmo.dispose()
      disposeTree(bed)
      for (const { geometry } of scene.geometries.values()) geometry.dispose()
      Object.values(scene.materials).forEach((material) => material.dispose())
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
      mesh.material = problems.has(object.id)
        ? scene.materials.problem
        : selected.includes(object.id)
          ? scene.materials.selected
          : scene.materials.model
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
          aria-label={`Build plate with ${String(count)} ${count === 1 ? 'object' : 'objects'}. Use the object panel to move them with a keyboard.`}
          className={`block h-full w-full touch-none ${props.mode === 'flat' ? 'cursor-crosshair' : ''}`}
        />
      )}
    </div>
  )
}
