import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  type CameraMoves,
  FURTHEST,
  NEAREST,
  SLIDE_STEP,
  TURN_STEP,
  ZOOM_STEP,
  lookFrom,
  slideCamera,
  turnCamera,
  viewKey,
  zoomCamera,
} from './camera'

const target = () => new Vector3(128, 128, 0)
const direction = (position: Vector3, from: Vector3) => position.clone().sub(from).normalize()

describe('turning', () => {
  it('goes round the plate at the same distance, to the right for a positive step', () => {
    const centre = target()
    const position = new Vector3(128, -100, 0)
    turnCamera(position, centre, Math.PI / 2, 0)
    expect(position.distanceTo(centre)).toBeCloseTo(228)
    // From the front, a quarter turn right puts the camera on the plate's right.
    expect(direction(position, centre).x).toBeCloseTo(1)
  })

  it('goes over the top and underneath but stops short of straight up or down', () => {
    const centre = target()
    const position = new Vector3(128, -100, 100)
    turnCamera(position, centre, 0, Math.PI)
    expect(direction(position, centre).z).toBeGreaterThan(0.999)
    expect(Math.hypot(position.x - centre.x, position.y - centre.y)).toBeGreaterThan(0)
    turnCamera(position, centre, 0, -2 * Math.PI)
    expect(direction(position, centre).z).toBeLessThan(-0.999)
  })
})

describe('sliding', () => {
  it('moves the camera and what it looks at together, across the picture', () => {
    const camera = new PerspectiveCamera(40, 1, 1, 5_000)
    camera.up.set(0, 0, 1)
    camera.position.set(128, -200, 0)
    const centre = target()
    camera.lookAt(centre)
    slideCamera(camera, centre, SLIDE_STEP, 0)
    // Looking from the front, right is +X; the view stays pointed the same way.
    expect(centre.x).toBeGreaterThan(128)
    expect(centre.y).toBeCloseTo(128)
    expect(centre.z).toBeCloseTo(0)
    expect(camera.position.x - centre.x).toBeCloseTo(0)
    expect(camera.position.y - centre.y).toBeCloseTo(-328)
  })
})

describe('zooming', () => {
  it('closes in by the factor and keeps within reach', () => {
    const centre = target()
    const position = new Vector3(128, 128, 500)
    zoomCamera(position, centre, ZOOM_STEP)
    expect(position.distanceTo(centre)).toBeCloseTo(400)
    zoomCamera(position, centre, 1_000)
    expect(position.distanceTo(centre)).toBeCloseTo(NEAREST)
    zoomCamera(position, centre, 1 / 1_000_000)
    expect(position.distanceTo(centre)).toBeCloseTo(FURTHEST)
  })
})

describe('looking from a side', () => {
  it('turns to the side asked for and keeps the distance', () => {
    const centre = target()
    const position = new Vector3(400, 0, 300)
    const distance = position.distanceTo(centre)
    const sides = {
      top: [0, 0, 1],
      bottom: [0, 0, -1],
      front: [0, -1, 0],
      behind: [0, 1, 0],
      left: [-1, 0, 0],
      right: [1, 0, 0],
    } as const
    for (const [view, expected] of Object.entries(sides)) {
      lookFrom(position, centre, view as keyof typeof sides)
      expect(position.distanceTo(centre)).toBeCloseTo(distance)
      const seen = direction(position, centre)
      expected.forEach((value, axis) => {
        expect(seen.getComponent(axis)).toBeCloseTo(value, 2)
      })
    }
  })
})

describe('view keys', () => {
  const moves = (): CameraMoves => ({ reset: vi.fn(), turn: vi.fn(), slide: vi.fn(), zoom: vi.fn(), look: vi.fn() })
  const key = (k: string, extra: Partial<KeyboardEvent> = {}) => ({
    key: k,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...extra,
  })

  it('give the numbers Orca’s views, 0 the start, and I and O the zoom', () => {
    const camera = moves()
    expect(viewKey(key('4'), camera, false)).toBe(true)
    expect(camera.look).toHaveBeenCalledWith('behind')
    expect(viewKey(key('1'), camera, false)).toBe(true)
    expect(camera.look).toHaveBeenLastCalledWith('top')
    expect(viewKey(key('0'), camera, false)).toBe(true)
    expect(camera.reset).toHaveBeenCalledOnce()
    expect(viewKey(key('i'), camera, false)).toBe(true)
    expect(camera.zoom).toHaveBeenLastCalledWith(ZOOM_STEP)
    expect(viewKey(key('O', { shiftKey: true }), camera, false)).toBe(true)
    expect(camera.zoom).toHaveBeenLastCalledWith(1 / ZOOM_STEP)
  })

  it('leave the arrows and Home alone away from the view’s button', () => {
    const camera = moves()
    expect(viewKey(key('ArrowLeft'), camera, false)).toBe(false)
    expect(viewKey(key('Home'), camera, false)).toBe(false)
    expect(camera.turn).not.toHaveBeenCalled()
    expect(camera.reset).not.toHaveBeenCalled()
  })

  it('turn with the arrows on the view’s button, and slide with Shift', () => {
    const camera = moves()
    expect(viewKey(key('ArrowLeft'), camera, true)).toBe(true)
    expect(camera.turn).toHaveBeenLastCalledWith(-TURN_STEP, 0)
    expect(viewKey(key('ArrowUp'), camera, true)).toBe(true)
    expect(camera.turn).toHaveBeenLastCalledWith(0, TURN_STEP)
    expect(viewKey(key('ArrowRight', { shiftKey: true }), camera, true)).toBe(true)
    expect(camera.slide).toHaveBeenLastCalledWith(SLIDE_STEP, 0)
    expect(viewKey(key('Home'), camera, true)).toBe(true)
    expect(camera.reset).toHaveBeenCalledOnce()
  })

  it('leave anything with Ctrl, Cmd or Alt to the browser, and do nothing with no view', () => {
    const camera = moves()
    expect(viewKey(key('1', { ctrlKey: true }), camera, true)).toBe(false)
    expect(viewKey(key('1', { metaKey: true }), camera, true)).toBe(false)
    expect(viewKey(key('ArrowLeft', { altKey: true }), camera, true)).toBe(false)
    expect(viewKey(key('m'), camera, true)).toBe(false)
    expect(viewKey(key('1'), null, true)).toBe(false)
    expect(camera.look).not.toHaveBeenCalled()
  })
})
