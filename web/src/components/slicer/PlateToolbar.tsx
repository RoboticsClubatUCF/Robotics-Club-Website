import {
  ArrowDownToLine,
  Copy,
  LayoutGrid,
  Move,
  Rotate3d,
  Scale3d,
  Trash2,
  Upload,
  WandSparkles,
} from 'lucide-react'
import { type ReactNode, useRef } from 'react'
import { ACCEPTED_MODELS } from '../../lib/slicer/stl'
import type { PlateMode } from './PlateView'
import { iconSize, toolButton, toolButtonOn } from './slicerChrome'

/**
 * The plate's tools, in Orca's order: add, then the layout tools, then the four modes. Every
 * button has its name as a tooltip and an accessible name, since they're icons.
 */
export function PlateToolbar({
  mode,
  hasSelection,
  hasObjects,
  disabled,
  onMode,
  onAdd,
  onArrange,
  onOrient,
  onCopy,
  onDelete,
}: {
  mode: PlateMode
  hasSelection: boolean
  hasObjects: boolean
  disabled: boolean
  onMode: (mode: PlateMode) => void
  onAdd: (files: File[]) => void
  onArrange: () => void
  onOrient: () => void
  onCopy: () => void
  onDelete: () => void
}) {
  const input = useRef<HTMLInputElement>(null)

  const tool = (
    label: string,
    icon: ReactNode,
    onClick: () => void,
    options: { on?: boolean; off?: boolean; shortcut?: string } = {},
  ) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || options.off}
      aria-label={label}
      aria-pressed={options.on}
      title={options.shortcut ? `${label} (${options.shortcut})` : label}
      className={`${toolButton} shrink-0 ${options.on ? toolButtonOn : ''}`}
    >
      {icon}
    </button>
  )

  return (
    <div
      role="toolbar"
      aria-label="Plate tools"
      // Along the bottom on a phone, where a thumb is, wrapping to a second row; centred above
      // the plate at `wide`, as in Orca.
      className="border-rule bg-base-100/90 absolute right-3 bottom-3 left-3 flex flex-wrap items-center justify-center gap-0.5 border p-1 backdrop-blur-sm wide:right-auto wide:bottom-auto wide:top-3 wide:left-1/2 wide:-translate-x-1/2 wide:flex-nowrap"
    >
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPTED_MODELS.join(',')}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          if (files.length > 0) onAdd(files)
        }}
      />
      {tool('Add a model', <Upload className={iconSize} aria-hidden="true" />, () => input.current?.click())}
      <span aria-hidden="true" className="bg-rule mx-1 h-6 w-px" />
      {tool('Arrange', <LayoutGrid className={iconSize} aria-hidden="true" />, onArrange, { off: !hasObjects, shortcut: 'A' })}
      {tool('Auto-orient', <WandSparkles className={iconSize} aria-hidden="true" />, onOrient, { off: !hasObjects })}
      {tool('Copy', <Copy className={iconSize} aria-hidden="true" />, onCopy, { off: !hasSelection, shortcut: 'Ctrl+D' })}
      {tool('Delete', <Trash2 className={iconSize} aria-hidden="true" />, onDelete, { off: !hasSelection, shortcut: 'Delete' })}
      <span aria-hidden="true" className="bg-rule mx-1 h-6 w-px" />
      {tool('Move', <Move className={iconSize} aria-hidden="true" />, () => onMode('move'), { on: mode === 'move', shortcut: 'M' })}
      {tool('Rotate', <Rotate3d className={iconSize} aria-hidden="true" />, () => onMode('rotate'), { on: mode === 'rotate', shortcut: 'R' })}
      {tool('Scale', <Scale3d className={iconSize} aria-hidden="true" />, () => onMode('scale'), { on: mode === 'scale', shortcut: 'S' })}
      {tool('Lay on face', <ArrowDownToLine className={iconSize} aria-hidden="true" />, () => onMode('flat'), { on: mode === 'flat', shortcut: 'F' })}
    </div>
  )
}
