import { useId } from 'react'
import { type CameraMoves, viewKey } from '../../lib/slicer/camera'
import { OrcaIcon } from './OrcaIcon'

// In the body face, not the mono: there the O that zooms out and the 0 that resets look alike.
const KEYS: [keys: string, does: string][] = [
  ['← → ↑ ↓', 'turn'],
  ['Shift + arrows', 'slide'],
  ['I and O', 'zoom in, zoom out'],
  ['1 to 6', 'top, bottom, front, behind, left, right'],
  ['0 (zero)', 'back to the start'],
]

const SHORTCUTS = [
  'ArrowLeft ArrowRight ArrowUp ArrowDown',
  'Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown',
  'I O 1 2 3 4 5 6 0 Home',
].join(' ')

/**
 * The house at the top right of a view: pressed, the view goes back to where it opened. It's also
 * where a keyboard moves the view. With it focused the arrows turn the view and Shift with them
 * slides it, and the keys are listed under it; in the workspace (`everywhere`) the numbers, 0, I
 * and O work on the plate as well (`viewKey`). Pointer users drag, so the list shows for keyboard
 * focus only, and on a phone it's one short paragraph across the top rather than a table over the
 * plate being turned.
 */
export function ViewControl({
  camera,
  everywhere = false,
}: {
  camera: () => CameraMoves | null | undefined
  /** The workspace sends the view keys here from anywhere on the plate, not just this button. */
  everywhere?: boolean
}) {
  const id = useId()
  return (
    // Across the top of the view so the phone's paragraph can span it; only the button and the
    // list take the pointer, so the plate and the toolbar under it still do.
    <div className="group pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={() => camera()?.reset()}
        onKeyDown={(event) => {
          // Handled here, the workspace leaves it: on the plate an arrow would move the parts.
          if (viewKey(event, camera(), true)) event.preventDefault()
        }}
        aria-label="Reset view"
        data-coach="house"
        aria-describedby={id}
        aria-keyshortcuts={SHORTCUTS}
        title="Reset view (zero)"
        className="border-rule bg-base-100/90 text-dim hover:text-base-content pointer-events-auto inline-flex size-11 cursor-pointer items-center justify-center border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary wide:size-9"
      >
        <OrcaIcon name="home" />
      </button>
      {/* Two boxes: `not-sr-only` zeroes padding, so the panel's own is on the inner one. */}
      <div id={id} className="sr-only self-stretch group-has-[:focus-visible]:not-sr-only wide:self-end">
        <div className="border-rule bg-base-100/95 relative z-10 border px-3 py-2 backdrop-blur-sm wide:max-w-[17rem]">
          <p className="text-[12px] leading-[1.5] wide:hidden">
            <span className="text-faint font-mono text-[10px] tracking-[0.14em]">VIEW KEYS </span>
            {KEYS.map(([keys, does], index) => (
              <span key={keys}>
                {index > 0 && <span className="text-faint"> · </span>}
                <span className="text-base-content font-semibold">{keys}</span> <span className="text-dim">{does}</span>
              </span>
            ))}
          </p>
          <div className="hidden wide:block">
            <p className="text-faint mb-1 font-mono text-[10px] tracking-[0.14em]">VIEW KEYS</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px] leading-[1.45]">
              {KEYS.map(([keys, does]) => (
                <div key={keys} className="contents">
                  <dt className="text-base-content font-semibold whitespace-nowrap">{keys}</dt>
                  <dd className="text-dim">{does}</dd>
                </div>
              ))}
            </dl>
            {everywhere && (
              <p className="text-faint mt-1.5 text-[11.5px] leading-[1.45]">
                The numbers, I and O also work anywhere on the plate.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
