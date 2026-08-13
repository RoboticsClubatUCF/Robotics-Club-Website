import { useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { imageSrc } from '../../lib/storedFiles'
import {
  DEFAULT_FRAMING,
  MAX_ZOOM,
  MIN_ZOOM,
  frameStyle,
  isDefaultFraming,
  panBy,
  zoomTo,
  type Framing,
} from '../../lib/imageFraming'

/**
 * Choosing what a picture shows, in the frame it will actually be shown in.
 *
 * The preview *is* the gallery frame — same `aspect-[16/10]`, same
 * `overflow-hidden`, same `frameStyle` — so there is no interpretation between
 * what somebody drags into place and what a visitor sees. A crop tool that
 * previews at a different shape is a crop tool people have to do arithmetic
 * against.
 *
 * Drawn inline in the editor rather than in a modal. It wants to be big, it has
 * no destructive act to guard, and `ConfirmDialog`'s careful focus handling
 * exists for decisions rather than for adjustments — reproducing it here would
 * be a second copy of the fiddliest code in `shared/`.
 *
 * Nothing is written until DONE. Panning is continuous, so saving as it moved
 * would be a request per frame of a drag.
 */
export function ImageFramer({
  url,
  initial,
  busy,
  onCancel,
  onSave,
}: {
  url: string
  initial: Framing
  busy: boolean
  onCancel: () => void
  onSave: (framing: Framing) => void
}) {
  const id = useId()
  const frame = useRef<HTMLDivElement>(null)
  const [framing, setFraming] = useState<Framing>(initial)
  // Where the pointer was last seen. Null between drags, so a pointer that
  // leaves the frame mid-drag cannot arm the next click into a jump.
  const [dragFrom, setDragFrom] = useState<{ x: number; y: number } | null>(null)

  const pan = (dx: number, dy: number) => {
    const rect = frame.current?.getBoundingClientRect()
    setFraming((current) =>
      panBy(current, dx, dy, rect?.width ?? 0, rect?.height ?? 0),
    )
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragFrom) return
    // Relative to the *last* position rather than the start, so the picture
    // tracks the pointer instead of accelerating away from it once a clamp at
    // one edge has thrown the two out of step.
    pan(event.clientX - dragFrom.x, event.clientY - dragFrom.y)
    setDragFrom({ x: event.clientX, y: event.clientY })
  }

  return (
    <div className="border-rule bg-base-200 mt-2 border p-3">
      <div
        ref={frame}
        role="application"
        aria-label="Drag to choose what this picture shows"
        tabIndex={0}
        onPointerDown={(event) => {
          // Keeps the drag arriving here once the pointer leaves the frame,
          // which it will the moment somebody pans to an edge. Guarded because
          // it is an enhancement rather than a requirement: it throws on a
          // pointer id the browser has already released, and jsdom does not
          // implement it at all — and a throw in here would take the drag with
          // it, which is the thing it exists to improve.
          try {
            event.currentTarget.setPointerCapture(event.pointerId)
          } catch {
            // Dragging still works while the pointer is over the frame.
          }
          setDragFrom({ x: event.clientX, y: event.clientY })
        }}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          setDragFrom(null)
        }}
        onPointerCancel={() => {
          setDragFrom(null)
        }}
        onKeyDown={(event) => {
          // A tenth of the frame a press, so the whole range is reachable
          // without holding a key down for a minute.
          const step = 24
          const nudge: Record<string, [number, number]> = {
            ArrowLeft: [step, 0],
            ArrowRight: [-step, 0],
            ArrowUp: [0, step],
            ArrowDown: [0, -step],
          }
          const move = nudge[event.key]
          if (!move) return
          event.preventDefault()
          pan(move[0], move[1])
        }}
        className={`bg-hatch border-rule focus-visible:outline-primary relative aspect-[16/10] w-full touch-none overflow-hidden border focus-visible:outline-2 focus-visible:outline-offset-2 ${
          dragFrom ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        <img
          src={imageSrc(url)}
          alt=""
          draggable={false}
          style={frameStyle(framing)}
          className="absolute inset-0 h-full w-full select-none"
        />

        {/* Thirds, to frame against. Pointer-transparent, or they would eat the
            drag that is the whole point of the box. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3"
        >
          {Array.from({ length: 9 }, (_, cell) => (
            <div key={cell} className="border-white/12 border-r border-b" />
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label
          htmlFor={`${id}-zoom`}
          className="text-faint font-mono text-[10px] font-medium tracking-[0.16em]"
        >
          ZOOM
        </label>
        <input
          id={`${id}-zoom`}
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.05}
          value={framing.zoom}
          disabled={busy}
          onChange={(event) => {
            setFraming((current) => zoomTo(current, Number(event.target.value)))
          }}
          className="range range-xs min-w-[8rem] flex-1"
        />
        <span className="text-faint w-10 shrink-0 font-mono text-[10px] font-medium tracking-[0.14em]">
          {framing.zoom.toFixed(1)}×
        </span>
      </div>

      <p className="text-faint mt-2 text-[11px] leading-[1.5]">
        Drag the picture to choose what shows, or use the arrow keys. The frame
        here is the frame on the page.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            onSave(framing)
          }}
          className="btn btn-primary btn-cta h-auto min-h-0 px-5 py-2.5 text-[12px] font-semibold disabled:opacity-60"
        >
          {busy ? 'SAVING…' : 'DONE'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="text-faint hover:text-primary cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50"
        >
          CANCEL
        </button>
        <button
          type="button"
          disabled={busy || isDefaultFraming(framing)}
          onClick={() => {
            setFraming(DEFAULT_FRAMING)
          }}
          className="text-faint hover:text-primary cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-30"
        >
          RESET
        </button>
      </div>
    </div>
  )
}
