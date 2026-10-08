import {
  AmbientLight,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Bed } from './plateTransform'

/**
 * What the plate and preview views share: the bed, the camera's starting view and the colours.
 *
 * Colours come from the site's tokens rather than a palette of their own, so both themes work and
 * the gold means the same here as everywhere else. They're read off the document when a view is
 * built and again when the theme changes.
 */

export interface ThemeColors {
  background: Color
  bed: Color
  grid: Color
  gridAlpha: number
  edge: Color
  model: Color
  selected: Color
  problem: Color
  noGo: Color
  text: Color
  roles: Record<'outerWall' | 'innerWall' | 'sparseInfill' | 'solidInfill' | 'support' | 'other', Color>
}

let probe: CanvasRenderingContext2D | null | undefined

/** A CSS colour as three.js takes it, whatever syntax the token is written in. */
function cssColor(name: string, fallback: string): { color: Color; alpha: number } {
  const raw =
    typeof document === 'undefined'
      ? ''
      : getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (probe === undefined) {
    probe = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  }
  if (!raw || !probe) return { color: new Color(fallback), alpha: 1 }
  probe.fillStyle = fallback
  probe.fillStyle = raw
  const normal = probe.fillStyle
  const rgba = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(normal)
  if (rgba) {
    return {
      color: new Color(Number(rgba[1]) / 255, Number(rgba[2]) / 255, Number(rgba[3]) / 255),
      alpha: rgba[4] === undefined ? 1 : Number(rgba[4]),
    }
  }
  return { color: new Color(normal), alpha: 1 }
}

export function themeColors(): ThemeColors {
  const grid = cssColor('--color-rule', '#333333')
  const background = cssColor('--color-base-100', '#0b0b0b').color
  // `dim` and `faint` are the ink at partial opacity; three.js has no alpha on a line or a solid,
  // so they're mixed over the page colour here, or both come out as full ink.
  const over = (name: string, fallback: string) => {
    const { color, alpha } = cssColor(name, fallback)
    return background.clone().lerp(color, alpha)
  }
  return {
    background,
    bed: cssColor('--color-base-200', '#101010').color,
    grid: grid.color,
    gridAlpha: Math.max(0.15, grid.alpha),
    edge: over('--color-faint', '#777777'),
    model: over('--color-dim', '#999999'),
    selected: cssColor('--color-primary', '#ffc904').color,
    problem: cssColor('--color-error', '#f2604a').color,
    noGo: cssColor('--color-warning', '#f0a83b').color,
    text: cssColor('--color-base-content', '#ffffff').color,
    roles: {
      outerWall: cssColor('--color-primary', '#ffc904').color,
      // Not warning: in the light theme it's within a shade of the gold.
      innerWall: over('--color-dim', '#999999'),
      sparseInfill: cssColor('--color-info', '#4aa8f0').color,
      solidInfill: cssColor('--color-error', '#f2604a').color,
      support: cssColor('--color-success', '#3ec27a').color,
      other: cssColor('--color-info', '#4aa8f0').color.clone().lerp(background, 0.6),
    },
  }
}

/** A renderer, or null where WebGL isn't available. */
export function createRenderer(canvas: HTMLCanvasElement): WebGLRenderer | null {
  try {
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    return renderer
  } catch {
    return null
  }
}

export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

/** The plate: its surface, a 10 mm grid, the edge, and the purge corner nothing may sit in. */
export function makeBed(bed: Bed, colors: ThemeColors): Group {
  const group = new Group()

  const surface = new Mesh(
    new PlaneGeometry(bed.width, bed.depth),
    new MeshBasicMaterial({ color: colors.bed, side: DoubleSide }),
  )
  surface.position.set(bed.width / 2, bed.depth / 2, -0.05)
  surface.name = 'bed'
  group.add(surface)

  const lines: number[] = []
  for (let x = 0; x <= bed.width; x += 10) lines.push(x, 0, 0, x, bed.depth, 0)
  for (let y = 0; y <= bed.depth; y += 10) lines.push(0, y, 0, bed.width, y, 0)
  const grid = new BufferGeometry()
  grid.setAttribute('position', new Float32BufferAttribute(lines, 3))
  group.add(
    new LineSegments(
      grid,
      new LineBasicMaterial({ color: colors.grid, transparent: true, opacity: colors.gridAlpha }),
    ),
  )

  const edge = new BufferGeometry()
  edge.setAttribute(
    'position',
    new Float32BufferAttribute(
      [0, 0, 0, bed.width, 0, 0, bed.width, 0, 0, bed.width, bed.depth, 0, bed.width, bed.depth, 0, 0, bed.depth, 0, 0, bed.depth, 0, 0, 0, 0],
      3,
    ),
  )
  group.add(new LineSegments(edge, new LineBasicMaterial({ color: colors.edge })))

  if (bed.exclude) {
    const { minX, minY, maxX, maxY } = bed.exclude
    const zone = new Mesh(
      new PlaneGeometry(maxX - minX, maxY - minY),
      new MeshBasicMaterial({ color: colors.noGo, transparent: true, opacity: 0.35, side: DoubleSide }),
    )
    zone.position.set((minX + maxX) / 2, (minY + maxY) / 2, 0.02)
    group.add(zone)
    // Hatched, so the corner reads as off-limits without relying on its colour.
    const hatch: number[] = []
    for (let k = minX - (maxY - minY); k < maxX; k += 3) {
      const x1 = Math.max(minX, k)
      const y1 = minY + (x1 - k)
      const x2 = Math.min(maxX, k + (maxY - minY))
      const y2 = minY + (x2 - k)
      if (x2 > x1) hatch.push(x1, y1, 0.04, x2, y2, 0.04)
    }
    const hatchGeometry = new BufferGeometry()
    hatchGeometry.setAttribute('position', new Float32BufferAttribute(hatch, 3))
    group.add(new LineSegments(hatchGeometry, new LineBasicMaterial({ color: colors.noGo })))
  }
  return group
}

/** Looking at the plate from the front, a little above, the way Orca opens. */
export function frameBed(camera: PerspectiveCamera, controls: OrbitControls, bed: Bed): void {
  camera.up.set(0, 0, 1)
  camera.position.set(bed.width / 2, -bed.depth * 1.05, bed.height * 1.3)
  controls.target.set(bed.width / 2, bed.depth / 2, 0)
  controls.update()
}

export interface Stage {
  renderer: WebGLRenderer
  scene: Scene
  camera: PerspectiveCamera
  orbit: OrbitControls
  /** Draws on the next frame; calls in between coalesce. Nothing animates on its own. */
  render: () => void
  dispose: () => void
}

/**
 * The renderer, camera, orbit controls and lights both views use, sized to `host` and redrawn
 * only when something changes. Null where WebGL isn't available.
 */
export function createStage(canvas: HTMLCanvasElement, host: HTMLElement, bed: Bed): Stage | null {
  const renderer = createRenderer(canvas)
  if (!renderer) return null

  const scene = new Scene()
  scene.add(new AmbientLight(0xffffff, 1.4))
  const sun = new DirectionalLight(0xffffff, 1.6)
  sun.position.set(-bed.width, -bed.depth * 2, bed.height * 3)
  scene.add(sun)

  const camera = new PerspectiveCamera(40, 1, 1, 5_000)
  const orbit = new OrbitControls(camera, canvas)
  orbit.enableDamping = false
  orbit.screenSpacePanning = true
  frameBed(camera, orbit, bed)

  // Until somebody moves the camera, it backs off on a narrow screen so the whole bed fits across.
  let framed = true
  orbit.addEventListener('start', () => {
    framed = false
  })

  let frame = 0
  const render = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      renderer.render(scene, camera)
    })
  }
  orbit.addEventListener('change', render)

  const resize = () => {
    const { clientWidth, clientHeight } = host
    if (clientWidth === 0 || clientHeight === 0) return
    renderer.setSize(clientWidth, clientHeight, false)
    camera.aspect = clientWidth / clientHeight
    camera.updateProjectionMatrix()
    if (framed) {
      frameBed(camera, orbit, bed)
      const back = Math.max(1, 1.25 / camera.aspect)
      camera.position.sub(orbit.target).multiplyScalar(back).add(orbit.target)
      orbit.update()
    }
    render()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()

  return {
    renderer,
    scene,
    camera,
    orbit,
    render,
    dispose: () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      orbit.dispose()
      renderer.dispose()
    },
  }
}

/** Disposes everything a group holds. */
export function disposeTree(group: Group): void {
  group.traverse((node) => {
    const holder = node as Partial<Mesh>
    holder.geometry?.dispose()
    const material = holder.material
    if (Array.isArray(material)) material.forEach((m) => m.dispose())
    else material?.dispose()
  })
}
