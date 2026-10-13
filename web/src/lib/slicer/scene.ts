import {
  AmbientLight,
  BufferGeometry,
  CanvasTexture,
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
  SRGBColorSpace,
  Scene,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { type CameraMoves, lookFrom, slideCamera, turnCamera, zoomCamera } from './camera'
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

/**
 * FRONT, lying on the plate just past its front edge, the way a real plate carries the printer's
 * name there, so a turned view still says which side faces the door. Null without a 2D canvas.
 */
function frontLabel(colors: ThemeColors): Mesh | null {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (!context) return null
  const font = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
  context.font = `600 96px ${font || 'monospace'}`
  context.fillStyle = `#${colors.text.getHexString()}`
  context.textBaseline = 'middle'
  // Spaced out by hand, as the site's mono labels are; `letterSpacing` isn't everywhere yet.
  const letters = ['F', 'R', 'O', 'N', 'T']
  const gap = 26
  const width = letters.reduce((sum, letter) => sum + context.measureText(letter).width, 0) + gap * (letters.length - 1)
  let x = (canvas.width - width) / 2
  for (const letter of letters) {
    context.fillText(letter, x, canvas.height / 2)
    x += context.measureText(letter).width + gap
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return new Mesh(
    new PlaneGeometry(85, 17),
    new MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.75, depthWrite: false }),
  )
}

/** The plate: its surface, a 10 mm grid, the edge, and the purge corner nothing may sit in. */
export function makeBed(bed: Bed, colors: ThemeColors): Group {
  const group = new Group()

  // Drawn from above only: orbited underneath, the grid stays and the parts' undersides show
  // through, as in Orca.
  const surface = new Mesh(
    new PlaneGeometry(bed.width, bed.depth),
    new MeshBasicMaterial({ color: colors.bed }),
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

  const label = frontLabel(colors)
  if (label) {
    label.position.set(bed.width / 2, -12, 0)
    group.add(label)
  }

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

/** A box to look at instead of the whole bed, in plate millimetres. */
export interface Focus {
  min: [number, number, number]
  max: [number, number, number]
}

/** Where the camera is and what it's turning about, in plate millimetres. */
export interface CameraView {
  position: [number, number, number]
  target: [number, number, number]
}

/**
 * Looking at the plate from the front, a little above, the way Orca opens; or at `focus` from the
 * same side, close enough to fill the view.
 */
export function frameBed(camera: PerspectiveCamera, controls: OrbitControls, bed: Bed, focus?: Focus): void {
  if (focus) {
    const centre = [0, 1, 2].map((axis) => (focus.min[axis]! + focus.max[axis]!) / 2) as [number, number, number]
    const size = Math.max(...[0, 1, 2].map((axis) => focus.max[axis]! - focus.min[axis]!), 10)
    camera.position.set(centre[0], centre[1] - size * 1.55, centre[2] + size * 1.3)
    controls.target.set(...centre)
  } else {
    camera.position.set(bed.width / 2, -bed.depth * 1.05, bed.height * 1.3)
    controls.target.set(bed.width / 2, bed.depth / 2, 0)
  }
  controls.update()
}

/** The camera's vertical field of view, in degrees. The training projects onto the plate with it. */
export const VIEW_ANGLE = 40

/** The camera's keyboard moves (`camera.ts`) are the stage's own. */
export interface Stage extends CameraMoves {
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
export function createStage(canvas: HTMLCanvasElement, host: HTMLElement, bed: Bed, focus?: Focus): Stage | null {
  const renderer = createRenderer(canvas)
  if (!renderer) return null

  const scene = new Scene()
  scene.add(new AmbientLight(0xffffff, 1.4))
  const sun = new DirectionalLight(0xffffff, 1.6)
  sun.position.set(-bed.width, -bed.depth * 2, bed.height * 3)
  scene.add(sun)

  const camera = new PerspectiveCamera(VIEW_ANGLE, 1, 1, 5_000)
  // Z is up on the plate, as in Orca. OrbitControls reads the up axis once, when it's made, so
  // this comes first; set afterwards, it orbits about Y and tilting jams the view side-on.
  camera.up.set(0, 0, 1)
  const orbit = new OrbitControls(camera, canvas)
  orbit.enableDamping = false
  orbit.screenSpacePanning = true
  frameBed(camera, orbit, bed, focus)

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
      frameBed(camera, orbit, bed, focus)
      const back = Math.max(1, 1.25 / camera.aspect)
      camera.position.sub(orbit.target).multiplyScalar(back).add(orbit.target)
      orbit.update()
    }
    render()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()

  // A key moved it: as a drag would, it stays where it's put, and the view and anything watching
  // the camera hear about it.
  const moved = () => {
    framed = false
    if (!orbit.update()) orbit.dispatchEvent({ type: 'change' })
  }

  return {
    renderer,
    scene,
    camera,
    orbit,
    render,
    reset: () => {
      framed = true
      resize()
      orbit.dispatchEvent({ type: 'change' })
    },
    turn: (around, up) => {
      turnCamera(camera.position, orbit.target, around, up)
      moved()
    },
    slide: (right, up) => {
      slideCamera(camera, orbit.target, right, up)
      moved()
    },
    zoom: (factor) => {
      zoomCamera(camera.position, orbit.target, factor)
      moved()
    },
    look: (view) => {
      lookFrom(camera.position, orbit.target, view)
      moved()
    },
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
    const materials = holder.material === undefined ? [] : [holder.material].flat()
    for (const material of materials) {
      // A label's canvas texture goes with it.
      const { map } = material as Partial<MeshBasicMaterial>
      map?.dispose()
      material.dispose()
    }
  })
}
