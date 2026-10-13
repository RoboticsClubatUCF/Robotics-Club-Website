import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiPlateObject } from '../../lib/api/api'
import type { Aim } from '../../lib/training/aim'
import type { PracticeState } from '../../lib/training/goals'
import { GoalCallout } from './GoalCallout'

/**
 * Which aim the callout settles on, and where its ring goes. jsdom has no layout, so each element
 * is given a box by its `data-layout` name, and one inside `hidden` has none, as a closed drawer
 * doesn't.
 */

const box = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

const LAYOUT: Record<string, DOMRect> = {
  frame: box(0, 0, 1000, 700),
  tab: box(20, 100, 80, 30),
  setting: box(20, 300, 300, 30),
  plate: box(100, 100, 800, 600),
}

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return LAYOUT[this.getAttribute('data-layout') ?? ''] ?? box(0, 0, 0, 0)
  })
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    return (this.closest('[hidden]') ? [] : [this.getBoundingClientRect()]) as unknown as DOMRectList
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const cube: ApiPlateObject = { id: 'cube', modelId: 'm', name: 'Cube', x: 128, y: 128, qx: 0, qy: 0, qz: 0, qw: 1, sx: 1, sy: 1, sz: 1 }

const state = {
  plate: { objects: [cube] },
  meshes: new Map([['m', Float32Array.from([-10, -10, 0, 10, -10, 0, 10, 10, 20])]]),
  // Where the plate opens on a 256 mm bed.
  camera: { position: [128, -268.8, 332.8], target: [128, 128, 0] },
} as unknown as PracticeState

const ring = () => screen.getByRole('region', { name: 'What to do' }).previousElementSibling as HTMLElement | null

function Setting({ aims, open }: { aims: Aim[]; open: boolean }) {
  return (
    <div data-layout="frame">
      <GoalCallout label="STEP 1 OF 2" text="Set Walls to 3." aims={aims} state={state} />
      <div hidden={!open}>
        <div data-coach="setting:wall_loops" data-layout="setting" />
      </div>
      <button type="button" data-coach="settings-tab:strength" data-layout="tab">
        STRENGTH
      </button>
    </div>
  )
}

describe('GoalCallout', () => {
  const aims: Aim[] = [
    { at: 'setting:wall_loops', side: 'right' },
    { at: 'settings-tab:strength', side: 'right' },
  ]

  it('points at the first aim on screen, and moves when an earlier one shows', async () => {
    const { rerender } = render(<Setting aims={aims} open={false} />)
    expect(screen.getByRole('region', { name: 'What to do' })).toHaveTextContent('STEP 1 OF 2Set Walls to 3.')
    expect(ring()).toHaveStyle({ left: '17px', top: '97px', width: '86px', height: '36px' })

    // Nothing the callout was given changed, only the page under it: it hears that and looks again.
    rerender(<Setting aims={aims} open />)
    await waitFor(() => {
      expect(ring()).toHaveStyle({ left: '17px', top: '297px', width: '306px', height: '36px' })
    })
    // To the right of the setting, past the ring and the arrow.
    expect(screen.getByRole('region', { name: 'What to do' })).toHaveStyle({ left: '336px' })
  })

  it('waits without an arrow when nothing it aims at is there', () => {
    render(<Setting aims={[{ at: 'slice' }]} open />)
    expect(ring()).toBeNull()
    expect(screen.getByRole('region', { name: 'What to do' })).toHaveStyle({ left: '500px', top: '688px' })
  })

  it('rings a part where the camera sees it', () => {
    render(
      <div data-layout="frame">
        <GoalCallout label="STEP 1 OF 1" text="Select the cube." aims={[{ part: 'cube' }]} state={state} />
        <canvas data-coach="plate" data-layout="plate" />
      </div>,
    )
    // The cube is what the camera turns about, so it's in the middle of the plate's view.
    const { left, top, width, height } = ring()!.style
    const [x, y, w, h] = [left, top, width, height].map((value) => Number.parseFloat(value))
    expect(x! < 500 && x! + w! > 500).toBe(true)
    expect(y! < 400 && y! + h! > 400).toBe(true)
  })
})
