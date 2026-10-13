import { PerspectiveCamera, Vector3 } from 'three'
import { settingDef } from '../slicer/processSettings'
import type { Box } from '../slicer/plateTransform'
import { type CameraView, VIEW_ANGLE } from '../slicer/scene'

/**
 * What a practice task points at while a goal is the next one, and where the callout pointing at
 * it goes (`components/training/GoalCallout.tsx`).
 *
 * A goal lists its aims in order and the callout takes the first one that's on screen and not
 * covered. That's how it follows the workspace around: a setting, else the tab it's under, else
 * the SETTINGS button that opens the column on a phone.
 */

export type Side = 'below' | 'above' | 'right' | 'left'

export type Aim =
  /** A control the workspace marks with `data-coach`. Two names, space-separated, for one inside the other. */
  | { at: string; side?: Side }
  /** An object on the plate, by id. */
  | { part: string }
  /** A point on the plate, in mm. */
  | { spot: [number, number, number] }

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface Placement {
  left: number
  top: number
  /** Which side of the target the callout is on. */
  side: Side
  /** How far along the callout's facing edge its arrow sits. */
  caret: number
}

export const selectorOf = (at: string) =>
  at
    .split(' ')
    .map((name) => `[data-coach="${name}"]`)
    .join(' ')

/** A setting's row, else its tab, else the SETTINGS button. To the right, clear of the column. */
export function settingAims(key: string, inside?: string): Aim[] {
  const tab = settingDef(key)?.tab
  return [
    { at: inside ? `setting:${key} ${inside}` : `setting:${key}`, side: 'right' },
    ...(tab ? [{ at: `settings-tab:${tab}`, side: 'right' as const }] : []),
    { at: 'drawer:settings' },
  ]
}

/** A part on the plate, else its row in the object list, else the OBJECTS button. */
export const partAims = (id: string): Aim[] => [{ part: id }, { at: `object:${id}`, side: 'left' }, { at: 'drawer:objects' }]

/** Adding a part on touch: turn on the list's toggle, then tap its row. */
export const addSelectionAims = (id: string): Aim[] => [
  { at: 'select-several:off', side: 'left' },
  { at: `object:${id}`, side: 'left' },
  { at: 'drawer:objects' },
]

/** Fields in the object panel, which only shows them with one part selected. */
export const panelAims = (...fields: string[]): Aim[] => [
  ...fields.map((at) => ({ at, side: 'left' as const })),
  { at: 'drawer:objects' },
]

/** The space between a callout and its target: its 10px arrow, and a little air. */
export const GAP = 13
/** How close to a corner the arrow may sit. */
const CARET_INSET = 14

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, Math.max(low, high)))

/**
 * A callout of `size` beside `target`, inside `bounds`: on the `prefer`red side if it fits there,
 * else below, above, right or left, whichever fits first, else wherever has the most room. A side
 * that would cover one of the controls in `avoid` comes after every side that wouldn't.
 */
export function place(
  target: Rect,
  size: { width: number; height: number },
  bounds: Rect,
  prefer?: Side,
  avoid: Rect[] = [],
): Placement {
  const right = bounds.left + bounds.width
  const bottom = bounds.top + bounds.height
  const room: Record<Side, number> = {
    below: bottom - (target.top + target.height) - GAP,
    above: target.top - bounds.top - GAP,
    right: right - (target.left + target.width) - GAP,
    left: target.left - bounds.left - GAP,
  }
  const middleX = target.left + target.width / 2
  const middleY = target.top + target.height / 2

  const on = (side: Side): Placement => {
    if (side === 'below' || side === 'above') {
      const left = clamp(middleX - size.width / 2, bounds.left, right - size.width)
      const top = side === 'below' ? target.top + target.height + GAP : target.top - GAP - size.height
      return {
        left,
        top: clamp(top, bounds.top, bottom - size.height),
        side,
        caret: clamp(middleX - left, CARET_INSET, size.width - CARET_INSET),
      }
    }
    const top = clamp(middleY - size.height / 2, bounds.top, bottom - size.height)
    const left = side === 'right' ? target.left + target.width + GAP : target.left - GAP - size.width
    return {
      left: clamp(left, bounds.left, right - size.width),
      top,
      side,
      caret: clamp(middleY - top, CARET_INSET, size.height - CARET_INSET),
    }
  }

  const depth = (side: Side) => (side === 'below' || side === 'above' ? size.height : size.width)
  const sides = [...new Set<Side>([prefer ?? 'below', 'below', 'above', 'right', 'left'])]
  const fits = sides.filter((side) => room[side] >= depth(side))
  const clear = fits.find((side) => {
    const { left, top } = on(side)
    return !avoid.some((rect) => intersect({ left, top, ...size }, rect))
  })
  return on(
    clear ?? fits[0] ?? sides.reduce((best, side) => (room[side] / depth(side) > room[best] / depth(best) ? side : best)),
  )
}

/** Plate millimetres to pixels in a `width` by `height` view from `view`; null behind the camera. */
function projector(view: CameraView, width: number, height: number) {
  // The stage's camera, rebuilt from what it reported (`createStage` in `lib/slicer/scene.ts`).
  const camera = new PerspectiveCamera(VIEW_ANGLE, width / height, 1, 5_000)
  camera.up.set(0, 0, 1)
  camera.position.set(...view.position)
  camera.lookAt(...view.target)
  camera.updateMatrixWorld()
  const point = new Vector3()
  return (at: [number, number, number]) => {
    point.set(...at).project(camera)
    if (point.z < -1 || point.z > 1) return null
    return { x: ((point.x + 1) / 2) * width, y: ((1 - point.y) / 2) * height }
  }
}

export function projectPoint(view: CameraView, width: number, height: number, at: [number, number, number]) {
  return projector(view, width, height)(at)
}

/** The box's outline on screen, from whichever of its corners are in front of the camera. */
export function projectBox(view: CameraView, width: number, height: number, box: Box): Rect | null {
  const project = projector(view, width, height)
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].flatMap((corner) => {
    const at = [0, 1, 2].map((axis) => ((corner >> axis) & 1 ? box.max[axis]! : box.min[axis]!))
    const point = project(at as [number, number, number])
    return point ? [point] : []
  })
  if (corners.length === 0) return null
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top }
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const width = Math.min(a.left + a.width, b.left + b.width) - left
  const height = Math.min(a.top + a.height, b.top + b.height) - top
  return width > 0 && height > 0 ? { left, top, width, height } : null
}
