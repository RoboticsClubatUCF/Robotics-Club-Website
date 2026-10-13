import { fireEvent, render } from '@testing-library/react'
import { Color, Group, PerspectiveCamera, Scene, Vector3 } from 'three'
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
vi.mock('three/examples/jsm/controls/TransformControls.js', () => ({
  TransformControls: class {
    dragging = false
    object = undefined
    getHelper = () => new Group()
    setSize = vi.fn()
    addEventListener = vi.fn()
    detach = vi.fn()
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

function view(selected = ['cube', 'block']) {
  const onDrag = vi.fn(), onCommit = vi.fn(), onSelect = vi.fn()
  const { container } = render(<PlateView bed={{ width: 256, depth: 256, height: 256, exclude: null }} objects={objects}
    meshes={new Map([['practice-cube', positions], ['practice-block', positions]])} selected={selected}
    problems={new Map()} mode="move" onSelect={onSelect} onDrag={onDrag} onCommit={onCommit} onLayFlat={vi.fn()} />)
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
})
