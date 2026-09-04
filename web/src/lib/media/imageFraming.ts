import type { CSSProperties } from 'react'

/**
 * Where a picture sits inside the gallery's fixed 16:10 frame.
 *
 * The club's photos arrive in every shape a phone can produce and the frame is one shape, so
 * something always has to be cropped away. `object-cover` picks the middle, which is right about
 * half the time and beheads somebody the rest. These three numbers are the lead's answer to that.
 *
 * Framing is metadata, applied with CSS at display time, never baked into the bytes. Half the
 * gallery is external URLs the club does not host: a canvas cannot read cross-origin pixels, so
 * `toBlob` throws on one, and a destructive crop would work for uploads and be impossible for
 * links. CSS works for both, keeps the original, and costs nothing at render.
 */

export interface Framing {
  /** The point of the picture that stays put, as `object-position` means it. */
  focalX: number
  focalY: number
  /** Multiplies the cover-fit size. 1 is "just fills the frame". */
  zoom: number
}

/** A plain centred cover — exactly what the frame did before framing existed. */
export const DEFAULT_FRAMING: Framing = { focalX: 50, focalY: 50, zoom: 1 }

export const MIN_ZOOM = 1
/** Past this a 1920px upload is being enlarged past its own pixels. */
export const MAX_ZOOM = 4

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value))

/**
 * Framing that is safe to render, from whatever arrived.
 *
 * Total on purpose. These numbers reach the browser from a database column, so a row written before
 * the column existed, or edited by hand in Studio, must not put `NaN` into a `style` and blank a
 * picture on the public page. Anything unusable falls back to the centred default, field by field.
 */
export function safeFraming(framing: Partial<Framing> | null | undefined): Framing {
  const number = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback

  return {
    focalX: clamp(number(framing?.focalX, 50), 0, 100),
    focalY: clamp(number(framing?.focalY, 50), 0, 100),
    zoom: clamp(number(framing?.zoom, 1), MIN_ZOOM, MAX_ZOOM),
  }
}

/**
 * The framing as an inline style for an `<img>` that already fills its frame.
 *
 * Two properties doing two jobs. `object-position` chooses which slice of a source shows when its
 * aspect ratio does not match the frame's — the pan. `scale` then enlarges what is showing, pinned
 * to the same point, which is what makes zooming feel like it happens under the cursor rather than
 * dragging the subject out of shot.
 *
 * A style rather than Tailwind classes because these are continuous values: a class per percentage
 * is thousands of classes, and Tailwind cannot generate one from a variable anyway — the class
 * would silently not exist.
 */
export function frameStyle(framing: Partial<Framing> | null | undefined): CSSProperties {
  const { focalX, focalY, zoom } = safeFraming(framing)
  const origin = `${focalX}% ${focalY}%`

  return {
    objectFit: 'cover',
    objectPosition: origin,
    // Omitted entirely at 1, so an unframed picture carries no transform at all
    // and cannot pick up the blurry resampling some engines apply to one.
    ...(zoom === 1 ? {} : { transform: `scale(${zoom})`, transformOrigin: origin }),
  }
}

/** Whether anybody has actually framed this, for a "reset" that can be disabled. */
export const isDefaultFraming = (framing: Partial<Framing> | null | undefined) => {
  const safe = safeFraming(framing)
  return (
    safe.focalX === DEFAULT_FRAMING.focalX &&
    safe.focalY === DEFAULT_FRAMING.focalY &&
    safe.zoom === DEFAULT_FRAMING.zoom
  )
}

/**
 * The framing after a drag of `dx`/`dy` pixels across a frame `width` wide.
 *
 * Dragging right reveals what is off to the left, so the focal point moves the other way — the
 * picture follows the pointer, which is the only direction anybody expects. The step is divided by
 * `zoom` because at 3× the same drag crosses three times as much picture, and without it the image
 * tears away from the cursor exactly when precision matters most.
 *
 * Guarded against a zero-sized frame: jsdom reports every rectangle as 0×0, and an unguarded divide
 * would put `Infinity` into the style.
 */
export function panBy(
  framing: Framing,
  dx: number,
  dy: number,
  width: number,
  height: number,
): Framing {
  if (!(width > 0) || !(height > 0)) return framing

  return {
    ...framing,
    focalX: clamp(framing.focalX - (dx / width) * 100 / framing.zoom, 0, 100),
    focalY: clamp(framing.focalY - (dy / height) * 100 / framing.zoom, 0, 100),
  }
}

/** Zoom, clamped, rounded to the step the slider moves in. */
export const zoomTo = (framing: Framing, zoom: number): Framing => ({
  ...framing,
  zoom: clamp(Math.round(zoom * 100) / 100, MIN_ZOOM, MAX_ZOOM),
})
