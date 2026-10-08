import { Copy, Lock, LockOpen, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Euler, Quaternion } from 'three'
import type { ApiPlacement, ApiPlateModel, ApiPlateObject } from '../../lib/api/api'
import type { MeshMap } from '../../lib/slicer/meshes'
import {
  type FitProblem,
  MAX_SCALE,
  MIN_SCALE,
  canonicalQuat,
  placedBox,
  placementAffine,
} from '../../lib/slicer/plateTransform'
import { NumberInput } from './NumberInput'
import { dangerButton, iconSize, panelHeading, quietButton } from './slicerChrome'

/** Why a copy won't slice, or overlaps another and would print joined to it. */
export type PlateWarning = FitProblem | 'overlaps'

const PROBLEM: Record<PlateWarning, string> = {
  overlaps: 'Overlaps',
  offPlate: 'Off the plate',
  tooTall: 'Too tall',
  noGo: 'In the keep-clear area',
}

const DEG = 180 / Math.PI

/**
 * The right column: every copy on the plate, and the selected one's numbers. Everything the
 * canvas does with a pointer can be done here with a keyboard.
 */
export function ObjectPanel({
  objects,
  models,
  meshes,
  selected,
  problems,
  disabled,
  onSelect,
  onChange,
  onCopy,
  onDelete,
}: {
  objects: ApiPlateObject[]
  models: ApiPlateModel[]
  meshes: MeshMap
  selected: string[]
  problems: ReadonlyMap<string, PlateWarning>
  disabled: boolean
  onSelect: (ids: string[]) => void
  onChange: (id: string, placement: Partial<ApiPlacement>) => void
  onCopy: () => void
  onDelete: () => void
}) {
  const modelOf = new Map(models.map((model) => [model.id, model]))
  const one =
    selected.length === 1
      ? objects.find((object) => object.id === selected[0])
      : undefined

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-rule px-4 py-3">
        <h2 className={panelHeading}>OBJECTS · {objects.length}</h2>
        <span className="flex gap-1.5">
          <button
            type="button"
            onClick={onCopy}
            disabled={disabled || selected.length === 0}
            className={`${quietButton} px-2.5`}
            aria-label="Copy the selected objects"
            title="Copy (Ctrl+D)"
          >
            <Copy className={iconSize} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={disabled || selected.length === 0}
            className={`${dangerButton} px-2.5`}
            aria-label="Delete the selected objects"
            title="Delete"
          >
            <Trash2 className={iconSize} aria-hidden="true" />
          </button>
        </span>
      </div>

      {objects.length === 0 ? (
        <p className="p-4 text-[13px] leading-[1.6] text-dim">
          Nothing on the plate yet.
        </p>
      ) : (
        <ul
          aria-label="Objects on the plate"
          className="max-h-[40%] min-h-24 overflow-y-auto py-1"
        >
          {objects.map((object, index) => {
            const model = modelOf.get(object.modelId)
            const problem = problems.get(object.id)
            const active = selected.includes(object.id)
            return (
              <li key={object.id}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={(event) => {
                    onSelect(
                      event.shiftKey || event.ctrlKey || event.metaKey
                        ? active
                          ? selected.filter((id) => id !== object.id)
                          : [...selected, object.id]
                        : [object.id],
                    )
                  }}
                  className={`flex min-h-11 w-full cursor-pointer items-center gap-2 border-l-2 px-4 py-1.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary wide:min-h-9 ${
                    active
                      ? 'border-primary bg-primary/10'
                      : 'border-transparent hover:bg-base-content/5'
                  }`}
                >
                  <span className="w-6 shrink-0 font-mono text-[10px] text-faint">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {object.name}
                  </span>
                  {model && model.meshState !== 'READY' && (
                    <span
                      className={`shrink-0 font-mono text-[9.5px] tracking-[0.12em] ${model.meshState === 'FAILED' ? 'text-error' : 'text-faint'}`}
                    >
                      {model.meshState === 'FAILED' ? "CAN'T READ" : 'CONVERTING'}
                    </span>
                  )}
                  {problem && (
                    <span className="shrink-0 font-mono text-[9.5px] tracking-[0.12em] text-error uppercase">
                      {PROBLEM[problem]}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-rule p-4">
        {one ? (
          <Transform
            key={one.id}
            object={one}
            positions={meshes.get(one.modelId)}
            failure={modelOf.get(one.modelId)?.meshFailure ?? null}
            disabled={disabled}
            onChange={(placement) => {
              onChange(one.id, placement)
            }}
          />
        ) : (
          <p className="text-[12.5px] leading-[1.6] text-faint">
            {selected.length > 1
              ? `${String(selected.length)} objects selected.`
              : 'Select an object to move, turn or resize it.'}
          </p>
        )}
      </div>
    </div>
  )
}

function Transform({
  object,
  positions,
  failure,
  disabled,
  onChange,
}: {
  object: ApiPlateObject
  positions: Float32Array | undefined
  failure: string | null
  disabled: boolean
  onChange: (placement: Partial<ApiPlacement>) => void
}) {
  const [uniform, setUniform] = useState(
    object.sx === object.sy && object.sy === object.sz,
  )
  const euler = new Euler().setFromQuaternion(
    new Quaternion(object.qx, object.qy, object.qz, object.qw),
    'XYZ',
  )
  const angles = [euler.x * DEG, euler.y * DEG, euler.z * DEG]
  const box = positions ? placedBox(positions, placementAffine(positions, object)) : null
  const size = box ? [0, 1, 2].map((axis) => box.max[axis]! - box.min[axis]!) : null

  const turnTo = (axis: number, degrees: number) => {
    const next = [...angles]
    next[axis] = degrees
    const q = new Quaternion().setFromEuler(
      new Euler(next[0]! / DEG, next[1]! / DEG, next[2]! / DEG, 'XYZ'),
    )
    onChange(canonicalQuat({ qx: q.x, qy: q.y, qz: q.z, qw: q.w }))
  }

  const scaleTo = (axis: 'sx' | 'sy' | 'sz', percent: number) => {
    const factor = percent / 100
    if (uniform) onChange({ sx: factor, sy: factor, sz: factor })
    else onChange({ [axis]: factor })
  }

  const sizeTo = (axis: number, mm: number) => {
    if (!size || size[axis]! <= 0) return
    const ratio = mm / size[axis]!
    const clamp = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
    onChange({
      sx: clamp(object.sx * ratio),
      sy: clamp(object.sy * ratio),
      sz: clamp(object.sz * ratio),
    })
  }

  return (
    <div className="space-y-4">
      <p className="truncate text-sm font-medium" title={object.name}>
        {object.name}
      </p>
      {failure && <p className="text-[12px] leading-[1.5] text-error">{failure}</p>}

      <fieldset>
        <legend className={`${panelHeading} mb-1.5`}>POSITION</legend>
        <div className="grid grid-cols-2 gap-2">
          <NumberInput
            label="X"
            name="Position X"
            unit="mm"
            step={0.1}
            min={-500}
            max={756}
            value={object.x}
            disabled={disabled}
            onCommit={(x) => onChange({ x })}
          />
          <NumberInput
            label="Y"
            name="Position Y"
            unit="mm"
            step={0.1}
            min={-500}
            max={756}
            value={object.y}
            disabled={disabled}
            onCommit={(y) => onChange({ y })}
          />
        </div>
      </fieldset>

      <fieldset>
        <legend className="sr-only">Rotation</legend>
        <div className="mb-1.5 flex items-center justify-between">
          <span aria-hidden="true" className={panelHeading}>
            ROTATION
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onChange({ qx: 0, qy: 0, qz: 0, qw: 1 })
            }}
            className="inline-flex cursor-pointer items-center gap-1 font-mono text-[9.5px] tracking-[0.12em] text-dim hover:text-base-content disabled:opacity-40"
          >
            <RotateCcw className="size-3" aria-hidden="true" /> RESET
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(['X', 'Y', 'Z'] as const).map((name, axis) => (
            <NumberInput
              key={name}
              label={name}
              name={`Rotation ${name}`}
              unit="°"
              step={0.1}
              min={-360}
              max={360}
              value={angles[axis]!}
              disabled={disabled}
              onCommit={(degrees) => {
                turnTo(axis, degrees)
              }}
            />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="sr-only">Scale</legend>
        <div className="mb-1.5 flex items-center justify-between">
          <span aria-hidden="true" className={panelHeading}>
            SCALE
          </span>
          <button
            type="button"
            aria-pressed={uniform}
            onClick={() => {
              setUniform(!uniform)
            }}
            className="inline-flex cursor-pointer items-center gap-1 font-mono text-[9.5px] tracking-[0.12em] text-dim hover:text-base-content"
          >
            {uniform ? (
              <Lock className="size-3" aria-hidden="true" />
            ) : (
              <LockOpen className="size-3" aria-hidden="true" />
            )}
            {uniform ? 'UNIFORM' : 'PER AXIS'}
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(['sx', 'sy', 'sz'] as const).map((axis, index) => (
            <NumberInput
              key={axis}
              label={['X', 'Y', 'Z'][index]!}
              name={`Scale ${['X', 'Y', 'Z'][index]!}`}
              unit="%"
              step={0.1}
              min={MIN_SCALE * 100}
              max={MAX_SCALE * 100}
              value={object[axis] * 100}
              disabled={disabled || (uniform && index > 0)}
              onCommit={(percent) => {
                scaleTo(axis, percent)
              }}
            />
          ))}
        </div>
      </fieldset>

      {size && (
        <fieldset>
          <legend className={`${panelHeading} mb-1.5`}>SIZE ON THE PLATE</legend>
          <div className="grid grid-cols-3 gap-2">
            {(['W', 'D', 'H'] as const).map((name, axis) => (
              <NumberInput
                key={name}
                label={name}
                name={`${{ W: 'Width', D: 'Depth', H: 'Height' }[name]} on the plate`}
                unit="mm"
                step={0.1}
                min={0.1}
                max={2000}
                value={size[axis]!}
                // Resizing by a measurement only makes sense keeping the proportions.
                disabled={disabled || !uniform}
                onCommit={(mm) => {
                  sizeTo(axis, mm)
                }}
              />
            ))}
          </div>
        </fieldset>
      )}
    </div>
  )
}
