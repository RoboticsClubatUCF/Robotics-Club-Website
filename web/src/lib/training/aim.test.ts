import { describe, expect, it } from 'vitest'
import { GAP, addSelectionAims, partAims, place, projectBox, projectPoint, settingAims } from './aim'

const bounds = { left: 0, top: 0, width: 1000, height: 600 }
const size = { width: 280, height: 80 }

describe('place', () => {
  it('goes under the target when there’s room, with the caret on it', () => {
    const target = { left: 400, top: 100, width: 100, height: 30 }
    const placed = place(target, size, bounds)
    expect(placed).toMatchObject({ side: 'below', top: 130 + GAP })
    expect(placed.left + placed.caret).toBe(450)
  })

  it('goes above a target at the bottom', () => {
    const placed = place({ left: 400, top: 560, width: 100, height: 30 }, size, bounds)
    expect(placed).toMatchObject({ side: 'above', top: 560 - GAP - 80 })
  })

  it('takes the side asked for when it fits, and not when it doesn’t', () => {
    const setting = { left: 10, top: 300, width: 300, height: 30 }
    expect(place(setting, size, bounds, 'right')).toMatchObject({ side: 'right', left: 310 + GAP })
    expect(place(setting, size, bounds, 'left').side).toBe('below')
  })

  it('stays inside the bounds, the caret still on the target', () => {
    const corner = { left: 960, top: 10, width: 30, height: 30 }
    const placed = place(corner, size, bounds)
    expect(placed.left).toBe(1000 - 280)
    expect(placed.left + placed.caret).toBeCloseTo(975)
  })

  it('moves off a control it would cover, if another side has room', () => {
    const part = { left: 400, top: 300, width: 40, height: 40 }
    const toolbar = { left: 300, top: 360, width: 300, height: 50 }
    expect(place(part, size, bounds, 'below', [toolbar]).side).toBe('above')
    // Nowhere clear to go: it covers one rather than leave the bounds.
    const corner = { left: 10, top: 40, width: 40, height: 40 }
    const blocking = [
      { left: 0, top: 100, width: 400, height: 50 },
      { left: 63, top: 20, width: 337, height: 80 },
    ]
    expect(place(corner, size, bounds, 'below', blocking).side).toBe('below')
  })

  it('keeps the caret off the corners', () => {
    const placed = place({ left: 0, top: 100, width: 4, height: 4 }, size, bounds)
    expect(placed.caret).toBe(14)
  })
})

// Where the plate opens, on a 256 mm bed (`frameBed`).
const opening = { position: [128, -268.8, 332.8] as [number, number, number], target: [128, 128, 0] as [number, number, number] }

describe('projection', () => {
  it('puts what the camera turns about in the middle of the view', () => {
    const middle = projectPoint(opening, 800, 600, [128, 128, 0])!
    expect(middle.x).toBeCloseTo(400)
    expect(middle.y).toBeCloseTo(300)
  })

  it('has the right of the plate on the right and the back of it higher up', () => {
    expect(projectPoint(opening, 800, 600, [200, 128, 0])!.x).toBeGreaterThan(400)
    expect(projectPoint(opening, 800, 600, [128, 200, 0])!.y).toBeLessThan(300)
  })

  it('leaves out what’s behind the camera', () => {
    expect(projectPoint(opening, 800, 600, [128, -665.6, 665.6])).toBeNull()
  })

  it('outlines a part around its middle', () => {
    const outline = projectBox(opening, 800, 600, { min: [118, 118, 0], max: [138, 138, 20] })!
    expect(outline.left).toBeLessThan(400)
    expect(outline.left + outline.width).toBeGreaterThan(400)
    expect(outline.width).toBeGreaterThan(10)
  })
})

describe('aims', () => {
  it('guides adding a part through the toggle, then its row, or opens OBJECTS on a phone', () => {
    expect(addSelectionAims('block')).toEqual([
      { at: 'select-several:off', side: 'left' },
      { at: 'object:block', side: 'left' },
      { at: 'drawer:objects' },
    ])
  })

  it('fall back from a setting to its tab to the SETTINGS button', () => {
    expect(settingAims('wall_loops').map((aim) => ('at' in aim ? aim.at : null))).toEqual([
      'setting:wall_loops',
      'settings-tab:strength',
      'drawer:settings',
    ])
    expect(settingAims('raft_layers', 'reset')[0]).toEqual({ at: 'setting:raft_layers reset', side: 'right' })
  })

  it('fall back from a part to its row to the OBJECTS button', () => {
    expect(partAims('cube')).toEqual([{ part: 'cube' }, { at: 'object:cube', side: 'left' }, { at: 'drawer:objects' }])
  })
})
