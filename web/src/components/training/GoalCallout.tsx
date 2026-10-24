import { type ReactNode, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { boxOn } from '../../lib/slicer/plate'
import { type Aim, type Rect, type Side, intersect, place, projectBox, projectPoint, selectorOf } from '../../lib/training/aim'
import type { PracticeState } from '../../lib/training/goals'

interface Shown {
  left: number
  top: number
  /** Null when nothing it aims at is on screen, and it waits over the plate. */
  side: Side | null
  caret: number
  ring: Rect | null
}

/**
 * What a callout keeps off where another side will do: the toolbar, the house, a phone's drawer
 * buttons, and the task's slices, which DONE under NEXT would cover just when there's something to
 * compare. Where nothing else fits it covers them anyway.
 */
const AVOID = ['tools', 'house', 'drawer:settings', 'drawer:objects', 'slice-log']

/**
 * What a callout never covers while another side will do: the task's START OVER, BACK and NEXT.
 * Pointing at SLICE PLATE, just under them on a phone, it used to sit right on top of them.
 */
const KEEP_CLEAR = ['task-actions']

/** The arrow on the edge facing the target: where it sits, and its shape in an 18 by 10 box. */
const ARROW: Record<Side, { edge: string; path: string; across: boolean }> = {
  below: { edge: '-top-2.5', path: 'M0 10L9 0L18 10Z', across: true },
  above: { edge: '-bottom-2.5', path: 'M0 0L9 10L18 0Z', across: true },
  right: { edge: '-left-2.5', path: 'M10 0L0 9L10 18Z', across: false },
  left: { edge: '-right-2.5', path: 'M0 0L10 9L0 18Z', across: false },
}

/**
 * A practice task's next goal, in a box beside the control or part to use, with an arrow at it
 * and a ring around it. It moves with its target as the workspace changes under it: a tab, a
 * drawer, the camera, a part being dragged. With nothing to point at on screen it waits over the
 * plate, without an arrow.
 *
 * It takes no pointer, so it can sit over the plate without being in the way of a click. It's
 * positioned in its parent, which holds the task and the workspace, so a page that scrolls on a
 * phone carries it along.
 */
export function GoalCallout({
  label,
  text,
  aims,
  state,
}: {
  label: string
  text: ReactNode
  aims: Aim[]
  state: PracticeState
}) {
  const box = useRef<HTMLElement>(null)
  const [shown, setShown] = useState<Shown | null>(null)
  // Targets already picked. One is brought into view the first time only, so the callout never
  // fights somebody's own scrolling.
  const seen = useRef(new Set<string>())

  const measure = useEffectEvent(() => {
    const element = box.current
    const frame = element?.parentElement
    if (!element || !frame) return
    const origin = frame.getBoundingClientRect()
    const area = intersect(origin, { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }) ?? origin
    const bounds = { left: area.left + 8, top: area.top + 8, width: area.width - 16, height: area.height - 16 }
    const found = locate(frame, aims, state, seen.current)
    let next: Shown
    if (found) {
      // Kept clear of the plate's own controls where another side will do.
      // Not what it points at: DONE points at NEXT itself.
      const rects = (names: string[]) =>
        names
          .flatMap((name) => [...frame.querySelectorAll(selectorOf(name))])
          .filter((control) => control.getClientRects().length > 0)
          .map((control) => control.getBoundingClientRect())
          .filter((rect) => !intersect(rect, found.rect))
      const size = { width: element.offsetWidth, height: element.offsetHeight }
      const placed = place(found.rect, size, bounds, found.side, rects(AVOID), rects(KEEP_CLEAR))
      next = {
        left: placed.left - origin.left,
        top: placed.top - origin.top,
        side: placed.side,
        caret: placed.caret,
        ring: { ...found.rect, left: found.rect.left - origin.left, top: found.rect.top - origin.top },
      }
    } else {
      // At the foot of the plate, clear of the toolbar along its top. On a phone the toolbar is at
      // the foot, so it's at the top instead, under the SETTINGS and OBJECTS buttons.
      const stage = frame.querySelector(selectorOf('stage'))?.getBoundingClientRect() ?? origin
      const wide = typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 56.25rem)').matches
      const [width, height] = [element.offsetWidth, element.offsetHeight]
      const left = wide ? stage.left + (stage.width - width) / 2 : stage.left + 12
      const top = wide ? stage.top + stage.height - 12 - height : stage.top + 64
      next = {
        left: Math.max(bounds.left, Math.min(left, bounds.left + bounds.width - width)) - origin.left,
        top: Math.max(bounds.top, Math.min(top, bounds.top + bounds.height - height)) - origin.top,
        side: null,
        caret: 0,
        ring: null,
      }
    }
    // Whole pixels, so subpixel noise from a re-measure doesn't render again.
    const rounded: Shown = {
      ...next,
      left: Math.round(next.left),
      top: Math.round(next.top),
      caret: Math.round(next.caret),
      ring: next.ring && {
        left: Math.round(next.ring.left),
        top: Math.round(next.ring.top),
        width: Math.round(next.ring.width),
        height: Math.round(next.ring.height),
      },
    }
    setShown((was) => (JSON.stringify(was) === JSON.stringify(rounded) ? was : rounded))
  })

  // Every render: the plate, the camera and the selection come in as `state`.
  useLayoutEffect(() => {
    measure()
  })

  // And whatever moves without a render here: the page, a column scrolling, the window, a drawer.
  useEffect(() => {
    const element = box.current
    const frame = element?.parentElement
    if (!element || !frame) return
    let pending = 0
    const soon = () => {
      if (pending) return
      pending = requestAnimationFrame(() => {
        pending = 0
        measure()
      })
    }
    const mutations = new MutationObserver(soon)
    mutations.observe(frame, { subtree: true, childList: true, attributes: true })
    const sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(soon) : null
    sizes?.observe(frame)
    sizes?.observe(element)
    window.addEventListener('resize', soon)
    document.addEventListener('scroll', soon, true)
    return () => {
      cancelAnimationFrame(pending)
      mutations.disconnect()
      sizes?.disconnect()
      window.removeEventListener('resize', soon)
      document.removeEventListener('scroll', soon, true)
    }
  }, [])

  return (
    <>
      {shown?.ring && (
        <div
          aria-hidden="true"
          style={shown.ring}
          className="border-primary animate-beckon pointer-events-none absolute z-25 border-2"
        />
      )}
      <section
        ref={box}
        aria-label="What to do"
        style={{ left: shown?.left ?? 0, top: shown?.top ?? 0 }}
        className="border-primary bg-base-100 animate-reveal pointer-events-none absolute z-25 w-[min(18rem,calc(100%-1rem))] border px-3.5 py-2.5"
      >
        <p className="text-primary font-mono text-[10.5px] font-semibold tracking-[0.14em]">{label}</p>
        <p className="text-base-content mt-1 text-[13.5px] leading-[1.45] text-pretty">{text}</p>
        {shown?.side && (
          <svg
            aria-hidden="true"
            width={ARROW[shown.side].across ? 18 : 10}
            height={ARROW[shown.side].across ? 10 : 18}
            style={ARROW[shown.side].across ? { left: shown.caret - 9 } : { top: shown.caret - 9 }}
            className={`text-primary absolute ${ARROW[shown.side].edge}`}
          >
            <path d={ARROW[shown.side].path} fill="currentColor" />
          </svg>
        )}
      </section>
    </>
  )
}

/** The first aim that's on screen and not covered, as a rect to ring, in viewport pixels. */
function locate(root: HTMLElement, aims: Aim[], state: PracticeState, seen: Set<string>): { rect: Rect; side?: Side } | null {
  for (const aim of aims) {
    if ('at' in aim) {
      const element = root.querySelector(selectorOf(aim.at))
      // Not there, or `hidden` or `display: none`: a closed drawer, a folded list.
      if (!element || element.getClientRects().length === 0) continue
      if (!seen.has(aim.at)) {
        seen.add(aim.at)
        if (clipped(element)) element.scrollIntoView({ block: 'center', inline: 'nearest' })
      }
      const rect = element.getBoundingClientRect()
      if (!uncovered(element, rect.left + rect.width / 2, rect.top + rect.height / 2)) continue
      return { rect: grow(rect, 3), side: aim.side }
    }

    const canvas = root.querySelector(selectorOf('plate'))
    if (!canvas || !state.camera) continue
    const frame = canvas.getBoundingClientRect()
    if (frame.width === 0 || frame.height === 0) continue
    // Out towards the edge of the view, over bare plate or background rather than the parts.
    const away = (y: number): Side => (y < frame.top + frame.height / 2 ? 'above' : 'below')

    if ('part' in aim) {
      const object = state.plate.objects.find((o) => o.id === aim.part)
      const positions = object && state.meshes.get(object.modelId)
      const outline = object && positions ? projectBox(state.camera, frame.width, frame.height, boxOn(positions, object)) : null
      const rect = outline && intersect({ ...outline, left: outline.left + frame.left, top: outline.top + frame.top }, frame)
      if (!rect || !uncovered(canvas, rect.left + rect.width / 2, rect.top + rect.height / 2)) continue
      return { rect: grow(rect, 6), side: away(rect.top + rect.height / 2) }
    }

    const point = projectPoint(state.camera, frame.width, frame.height, aim.spot)
    if (!point || point.x < 24 || point.y < 24 || point.x > frame.width - 24 || point.y > frame.height - 24) continue
    const x = frame.left + point.x
    const y = frame.top + point.y
    if (!uncovered(canvas, x, y)) continue
    return { rect: { left: x - 7, top: y - 7, width: 14, height: 14 }, side: away(y) }
  }
  return null
}

const grow = (rect: Rect, by: number): Rect => ({
  left: rect.left - by,
  top: rect.top - by,
  width: rect.width + by * 2,
  height: rect.height + by * 2,
})

/**
 * Whether `element` is in sight at (x, y): not under a drawer, a dialog, the toolbar or the site's
 * bar, and not inert behind an open drawer. What takes no pointer doesn't cover it, the callout
 * included; a disabled button takes none itself, so the hit can land on what holds it.
 */
function uncovered(element: Element, x: number, y: number): boolean {
  if (element.closest('[inert]')) return false
  if (typeof document.elementFromPoint !== 'function') return true
  const hit = document.elementFromPoint(x, y)
  return hit !== null && (hit.contains(element) || element.contains(hit))
}

/** Partly out of sight: past the window's edge, or scrolled away inside a column. */
function clipped(element: Element): boolean {
  const rect = element.getBoundingClientRect()
  const outside = (edge: { top: number; right: number; bottom: number; left: number }) =>
    rect.top < edge.top || rect.bottom > edge.bottom || rect.left < edge.left || rect.right > edge.right
  if (outside({ top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth })) return true
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(parent)
    if (overflowX === 'visible' && overflowY === 'visible') continue
    if (outside(parent.getBoundingClientRect())) return true
  }
  return false
}
