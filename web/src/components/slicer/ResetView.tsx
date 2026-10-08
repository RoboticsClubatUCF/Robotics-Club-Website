import { House } from 'lucide-react'
import { iconSize } from './slicerChrome'

/** Back to the view the plate opened with, for anyone who's turned it somewhere they can't undo. */
export function ResetView({ onReset }: { onReset: () => void }) {
  return (
    <button
      type="button"
      onClick={onReset}
      aria-label="Reset view"
      title="Reset view"
      className="border-rule bg-base-100/90 text-dim hover:text-base-content absolute top-3 right-3 inline-flex size-11 cursor-pointer items-center justify-center border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary wide:size-9"
    >
      <House className={iconSize} aria-hidden="true" />
    </button>
  )
}
