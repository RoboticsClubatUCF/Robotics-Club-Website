import { type PerspectiveCamera, Vector3 } from 'three'

/**
 * Moving the view from the keyboard. The pointer has OrbitControls; these do the same moves a step
 * at a time, on the camera and the point it turns about, and the stage then tells OrbitControls.
 * Z is up, as on the plate.
 */

export type ViewName = 'top' | 'bottom' | 'front' | 'behind' | 'left' | 'right'

/** What a key can do to the view. The stage does it; a test can do it on a bare camera. */
export interface CameraMoves {
  /** Back to the view it opened with. */
  reset: () => void
  /** Round the plate by `around` radians (positive goes right) and `up` radians higher. */
  turn: (around: number, up: number) => void
  /** Across and up, in fractions of the view's height. */
  slide: (right: number, up: number) => void
  /** Closer by `factor`; below 1 backs off. */
  zoom: (factor: number) => void
  /** Straight from one side, keeping the distance and the point it turns about. */
  look: (view: ViewName) => void
}

/** 15 degrees a press: 24 presses go all the way round. */
export const TURN_STEP = Math.PI / 12
export const SLIDE_STEP = 0.1
export const ZOOM_STEP = 1.25

/** Nearest and furthest a key zooms to, in millimetres from the point the view turns about. */
export const NEAREST = 20
export const FURTHEST = 3_000

/**
 * Orca's numbers for its views, which it puts on Ctrl+1 to Ctrl+6. A browser keeps Ctrl with a
 * number for its own tabs, so here they're the numbers alone.
 */
export const VIEW_KEYS: Readonly<Record<string, ViewName>> = {
  '1': 'top',
  '2': 'bottom',
  '3': 'front',
  '4': 'behind',
  '5': 'left',
  '6': 'right',
}

// Straight up or down, "up" stops saying which way the picture is turned; this much short of it
// still looks straight down.
const EDGE = 1e-3

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** Puts the camera `distance` from `target`, `around` radians round from +X and `tilt` from overhead. */
function place(position: Vector3, target: Vector3, distance: number, around: number, tilt: number): void {
  position.set(
    target.x + distance * Math.sin(tilt) * Math.cos(around),
    target.y + distance * Math.sin(tilt) * Math.sin(around),
    target.z + distance * Math.cos(tilt),
  )
}

export function turnCamera(position: Vector3, target: Vector3, around: number, up: number): void {
  const offset = position.clone().sub(target)
  const distance = offset.length()
  if (distance === 0) return
  const tilt = clamp(Math.acos(clamp(offset.z / distance, -1, 1)) - up, EDGE, Math.PI - EDGE)
  place(position, target, distance, Math.atan2(offset.y, offset.x) + around, tilt)
}

/** Moves the camera and what it looks at together, across the picture; `camera` must face `target`. */
export function slideCamera(camera: PerspectiveCamera, target: Vector3, right: number, up: number): void {
  camera.updateMatrixWorld()
  const height = 2 * camera.position.distanceTo(target) * Math.tan((camera.fov * Math.PI) / 360)
  const move = new Vector3()
    .setFromMatrixColumn(camera.matrixWorld, 0)
    .multiplyScalar(right * height)
    .add(new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(up * height))
  camera.position.add(move)
  target.add(move)
}

export function zoomCamera(position: Vector3, target: Vector3, factor: number): void {
  const offset = position.clone().sub(target)
  const distance = offset.length()
  if (distance === 0) return
  position.copy(target).add(offset.setLength(clamp(distance / factor, NEAREST, FURTHEST)))
}

const SIDES: Record<ViewName, [around: number, tilt: number]> = {
  // FRONT, on the plate's front edge, reads the right way up from above and from the front.
  top: [-Math.PI / 2, EDGE],
  bottom: [-Math.PI / 2, Math.PI - EDGE],
  front: [-Math.PI / 2, Math.PI / 2],
  behind: [Math.PI / 2, Math.PI / 2],
  left: [Math.PI, Math.PI / 2],
  right: [0, Math.PI / 2],
}

export function lookFrom(position: Vector3, target: Vector3, view: ViewName): void {
  place(position, target, position.distanceTo(target) || 1, ...SIDES[view])
}

/**
 * Does what a key asks of the view, and says whether it was a view key. The numbers, 0, I and O
 * work anywhere in the workspace; the arrows and Home only where `arrows` is set, on the view's own
 * button, because everywhere else the arrows move the selected parts and Home scrolls the page.
 */
export function viewKey(
  event: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
  camera: CameraMoves | null | undefined,
  arrows: boolean,
): boolean {
  if (!camera || event.ctrlKey || event.metaKey || event.altKey) return false
  const { key } = event
  const side = VIEW_KEYS[key]
  if (key === '0' || (arrows && key === 'Home')) camera.reset()
  else if (side) camera.look(side)
  else if (['i', 'I', '+', '='].includes(key)) camera.zoom(ZOOM_STEP)
  else if (['o', 'O', '-', '_'].includes(key)) camera.zoom(1 / ZOOM_STEP)
  else if (arrows && key.startsWith('Arrow')) {
    const across = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0
    const up = key === 'ArrowUp' ? 1 : key === 'ArrowDown' ? -1 : 0
    if (event.shiftKey) camera.slide(across * SLIDE_STEP, up * SLIDE_STEP)
    else camera.turn(across * TURN_STEP, up * TURN_STEP)
  } else return false
  return true
}
