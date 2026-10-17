import { fireEvent, render } from '@testing-library/react'
import { Color, Group, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { placed } from '../../lib/training/practiceParts'
import { PlateView } from './PlateView'

// Keep real geometry, projection and ray picking; only the WebGL renderer and gizmo need a browser.
vi.mock('../../lib/slicer/scene', async (original) => ({
  ...(await original<typeof import('../../lib/slicer/scene')>()),
  createStage: (canvas: HTMLCanvasElement) => {
    const scene = new Scene()
    const camera = new PerspectiveCamera(40, 1, 1, 5_000)
    camera.position.set(128, 128, 500)
    camera.lookAt(128, 128, 0)
    camera.updateMatrixWorld()
    return {
      scene, camera,
      renderer: { domElement: canvas, setClearColor: vi.fn() },
      orbit: { enabled: true, target: new Vector3(128, 128, 0), addEventListener: vi.fn(), removeEventListener: vi.fn() },
      render: () => scene.updateMatrixWorld(true),
      dispose: vi.fn(),
    }
  },
  makeBed: () => new Group(),
  themeColors: () => Object.fromEntries(['background', 'model', 'selected', 'problem'].map(key => [key, new Color()])),
}))
// The gizmo records its listeners so a test can play a drag on its handles.
const gizmos = vi.hoisted(() => [] as { object?: { scale: Vector3; quaternion: Quaternion }; axis: string | null; fire: (type: string, event?: object) => void }[])
vi.mock('three/examples/jsm/controls/TransformControls.js', () => ({
  TransformControls: class {
    dragging = false
    axis: string | null = null
    object: { scale: Vector3; quaternion: Quaternion } | undefined = undefined
    listeners = new Map<string, (event: object) => void>()
    constructor() { gizmos.push(this) }
    getHelper = () => new Group()
    setSize = vi.fn()
    setMode = vi.fn()
    attach(object: { scale: Vector3; quaternion: Quaternion }) { this.object = object }
    addEventListener(type: string, listener: (event: object) => void) { this.listeners.set(type, listener) }
    fire(type: string, event = {}) { this.listeners.get(type)?.(event) }
    detach() { this.object = undefined }
    dispose = vi.fn()
  },
}))

const positions = Float32Array.from([0, 0, 0, 20, 0, 0, 0, 20, 0, 20, 0, 0, 20, 20, 0, 0, 20, 0])
const objects = [placed('cube', 'cube', 64, 64), placed('block', 'block', 190, 80), placed('cube', 'other', 128, 128)]
const camera = new PerspectiveCamera(40, 1, 1, 5_000)
camera.position.set(128, 128, 500)
camera.lookAt(128, 128, 0)
camera.updateMatrixWorld()

function pointer(canvas: HTMLCanvasElement, type: string, x: number, y: number, modifiers = {}) {
  const p = new Vector3(x, y, 0).project(camera)
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: (p.x + 1) * 300, clientY: (1 - p.y) * 300, ...modifiers })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  fireEvent(canvas, event)
}

function view(selected = ['cube', 'block'], selectSeveral = false) {
  const onDrag = vi.fn(), onCommit = vi.fn(), onSelect = vi.fn()
  const { container } = render(<PlateView bed={{ width: 256, depth: 256, height: 256, exclude: null }} objects={objects}
    meshes={new Map([['practice-cube', positions], ['practice-block', positions]])} selected={selected}
    problems={new Map()} mode="move" selectSeveral={selectSeveral} onSelect={onSelect} onDrag={onDrag}
    onCommit={onCommit} onLayFlat={vi.fn()} />)
  const canvas = container.querySelector('canvas')!
  canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 600, width: 600, height: 600, toJSON: () => ({}) })
  canvas.setPointerCapture = vi.fn()
  return { canvas, onDrag, onCommit, onSelect }
}

beforeEach(() => vi.clearAllMocks())

describe('PlateView dragging', () => {
  it.each(['cube', 'block'])('moves the whole selection when %s is grabbed and commits before another render', (id) => {
    const { canvas, onDrag, onCommit, onSelect } = view()
    const grabbed = objects.find(o => o.id === id)!
    pointer(canvas, 'pointerdown', grabbed.x, grabbed.y)
    pointer(canvas, 'pointermove', grabbed.x + 10, grabbed.y + 60)
    pointer(canvas, 'pointerup', grabbed.x + 10, grabbed.y + 60)
    const expected = new Map([['cube', { x: 74, y: 124 }], ['block', { x: 200, y: 140 }]])
    expect(onDrag).toHaveBeenLastCalledWith(expected)
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(expected)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('moves only an unselected part on an ordinary drag', () => {
    const { canvas, onDrag, onCommit, onSelect } = view(['cube'])
    pointer(canvas, 'pointerdown', 190, 80)
    pointer(canvas, 'pointermove', 200, 140)
    pointer(canvas, 'pointerup', 200, 140)
    expect(onSelect).toHaveBeenCalledWith(['block'])
    expect(onDrag).toHaveBeenLastCalledWith(new Map([['block', { x: 200, y: 140 }]]))
    expect(onCommit).toHaveBeenCalledWith(new Map([['block', { x: 200, y: 140 }]]))
  })

  it.each(['shiftKey', 'ctrlKey', 'metaKey'])('adds a part with %s without starting an accidental drag', (modifier) => {
    const { canvas, onDrag, onCommit, onSelect } = view(['cube'])
    pointer(canvas, 'pointerdown', 190, 80, { [modifier]: true })
    pointer(canvas, 'pointermove', 191, 80, { [modifier]: true })
    pointer(canvas, 'pointerup', 191, 80, { [modifier]: true })
    expect(onSelect).toHaveBeenCalledWith(['cube', 'block'])
    expect(onDrag).not.toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('adds and removes parts with a plain tap while SELECT SEVERAL is on', () => {
    const { canvas, onDrag, onSelect } = view(['cube'], true)
    pointer(canvas, 'pointerdown', 190, 80)
    pointer(canvas, 'pointerup', 190, 80)
    expect(onSelect).toHaveBeenLastCalledWith(['cube', 'block'])
    pointer(canvas, 'pointerdown', 64, 64)
    pointer(canvas, 'pointerup', 64, 64)
    expect(onSelect).toHaveBeenLastCalledWith([])
    expect(onDrag).not.toHaveBeenCalled()
  })

  it('still drags the selection while SELECT SEVERAL is on', () => {
    const { canvas, onCommit } = view(['cube', 'block'], true)
    pointer(canvas, 'pointerdown', 64, 64)
    pointer(canvas, 'pointermove', 74, 124)
    pointer(canvas, 'pointerup', 74, 124)
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(new Map([['cube', { x: 74, y: 124 }], ['block', { x: 200, y: 140 }]]))
  })
})

describe('PlateView rotation handles', () => {
  it.each([
    ['X', 90], ['Y', 90], ['X', -90], ['Y', -90],
  ] as const)('reports the blue-ring turn after a mistaken %s turn (%s°)', (wrongAxis, degrees) => {
    const onRotation = vi.fn()
    render(<PlateView bed={{ width: 256, depth: 256, height: 256, exclude: null }} objects={[objects[0]!]}
      meshes={new Map([['practice-cube', positions]])} selected={['cube']} problems={new Map()} mode="rotate"
      onSelect={vi.fn()} onDrag={vi.fn()} onCommit={vi.fn()} onLayFlat={vi.fn()} onRotation={onRotation} />)
    const gizmo = gizmos.at(-1)!
    const drag = (axis: string, increments: number[]) => {
      gizmo.axis = axis
      gizmo.fire('dragging-changed', { value: true })
      for (const amount of increments) {
        const direction = axis === 'X' ? new Vector3(1, 0, 0) : axis === 'Y' ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1)
        gizmo.object!.quaternion.premultiply(new Quaternion().setFromAxisAngle(direction, amount * Math.PI / 180))
        gizmo.fire('objectChange')
      }
      gizmo.fire('dragging-changed', { value: false })
    }
    drag(wrongAxis, [35])
    drag('Z', [degrees / 2, degrees / 2])
    const changes = onRotation.mock.calls.map(([change]) => change as { objectId: string; axis: string; degrees: number })
    expect(changes.map(change => [change.objectId, change.axis])).toEqual([
      ['cube', wrongAxis.toLowerCase()], ['cube', 'z'], ['cube', 'z'],
    ])
    expect(changes[0]!.degrees).toBeCloseTo(35)
    expect(changes[1]!.degrees).toBeCloseTo(degrees / 2)
    expect(changes[2]!.degrees).toBeCloseTo(degrees / 2)
  })
})

describe('PlateView scale handles', () => {
  // A cube already stretched to twice its width, its Y handle pulled to half as long again.
  function pullY(uniformScale: boolean) {
    const onDrag = vi.fn(), onCommit = vi.fn()
    render(<PlateView bed={{ width: 256, depth: 256, height: 256, exclude: null }} objects={[{ ...objects[0]!, sx: 2, sy: 1, sz: 1 }]}
      meshes={new Map([['practice-cube', positions]])} selected={['cube']} problems={new Map()} mode="scale"
      uniformScale={uniformScale} onSelect={vi.fn()} onDrag={onDrag} onCommit={onCommit} onLayFlat={vi.fn()} />)
    const gizmo = gizmos.at(-1)!
    gizmo.fire('dragging-changed', { value: true })
    gizmo.object!.scale.y = 1.5
    gizmo.fire('objectChange')
    gizmo.fire('dragging-changed', { value: false })
    return { onDrag, onCommit }
  }

  it('resizes all three axes and keeps the shape while UNIFORM is on', () => {
    const { onDrag, onCommit } = pullY(true)
    const grown = new Map([['cube', { sx: 3, sy: 1.5, sz: 1.5 }]])
    expect(onDrag).toHaveBeenLastCalledWith(grown)
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(grown)
  })

  it('stretches only the pulled axis while PER AXIS', () => {
    const { onCommit } = pullY(false)
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(new Map([['cube', { sx: 2, sy: 1.5, sz: 1 }]]))
  })
})
