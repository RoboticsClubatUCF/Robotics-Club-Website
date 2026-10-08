import { RotateCcw } from 'lucide-react'
import { useId, useState } from 'react'
import {
  type SettingDef,
  type SettingValue,
  checkValue,
  displayValue,
} from '../../lib/slicer/processSettings'
import { iconSize, smallField, smallSelect } from './slicerChrome'

/**
 * One process setting: the preset's value until the member changes it, then theirs, marked in
 * gold with a way back. Numbers are committed on Enter or when the field loses focus, so typing
 * "12" doesn't save a 1 on the way.
 */
export function SettingField({
  def,
  value,
  presetValue,
  disabled,
  onChange,
}: {
  def: SettingDef
  /** The member's value, or undefined when they haven't changed it. */
  value: SettingValue | undefined
  presetValue: SettingValue
  disabled: boolean
  /** Undefined puts it back to the preset. */
  onChange: (value: SettingValue | undefined) => void
}) {
  const id = useId()
  const changed = value !== undefined && value !== presetValue
  const shown = value ?? presetValue

  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_6.75rem_2.75rem] items-center gap-x-2 border-l-2 py-1.5 pr-1 pl-2.5 wide:grid-cols-[minmax(0,1fr)_6.75rem_1.75rem] ${
        changed ? 'border-primary bg-primary/5' : 'border-transparent'
      }`}
    >
      <label htmlFor={id} className="text-dim min-w-0 text-[12.5px] leading-snug">
        {def.label}
      </label>

      <Control id={id} def={def} shown={shown} disabled={disabled} onChange={onChange} />

      {changed ? (
        <button
          type="button"
          onClick={() => {
            onChange(undefined)
          }}
          disabled={disabled}
          title={`Back to the preset's ${displayValue(def, presetValue)}`}
          aria-label={`Reset ${def.label} to the preset's ${displayValue(def, presetValue)}`}
          className="text-primary hover:text-base-content inline-flex size-11 cursor-pointer items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40 wide:size-7"
        >
          <RotateCcw className={iconSize} aria-hidden="true" />
        </button>
      ) : (
        <span aria-hidden="true" />
      )}
    </div>
  )
}

function Control({
  id,
  def,
  shown,
  disabled,
  onChange,
}: {
  id: string
  def: SettingDef
  shown: SettingValue
  disabled: boolean
  onChange: (value: SettingValue | undefined) => void
}) {
  if (def.kind === 'bool') {
    return (
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={shown === true}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked)
        }}
        className="toggle toggle-sm checked:border-primary checked:bg-primary checked:text-primary-content justify-self-end"
      />
    )
  }

  if (def.kind === 'choice') {
    return (
      <select
        id={id}
        value={String(shown)}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className={smallSelect}
      >
        {def.choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    )
  }

  return <NumberControl id={id} def={def} shown={shown as number} disabled={disabled} onChange={onChange} />
}

function NumberControl({
  id,
  def,
  shown,
  disabled,
  onChange,
}: {
  id: string
  def: Extract<SettingDef, { kind: 'float' | 'int' | 'percent' }>
  shown: number
  disabled: boolean
  onChange: (value: SettingValue | undefined) => void
}) {
  // What's typed, until it's committed. Null means "showing the saved value".
  const [typed, setTyped] = useState<string | null>(null)
  const [wrong, setWrong] = useState(false)
  const unit = def.kind === 'percent' ? '%' : def.kind === 'float' ? def.unit : (def.unit ?? '')
  const step = def.kind === 'float' ? def.step : 1

  const commit = (leaving: boolean) => {
    if (typed === null) return
    const value = checkValue(def, Number(typed))
    if (typed.trim() === '' || value === undefined) {
      // Kept with the reason on Enter; put back to what's saved on leaving the field.
      if (leaving) {
        setTyped(null)
        setWrong(false)
      } else {
        setWrong(true)
      }
      return
    }
    setWrong(false)
    setTyped(null)
    if (value !== shown) onChange(value)
  }

  return (
    <span className="relative flex items-center">
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={def.min}
        max={def.max}
        step={step}
        value={typed ?? String(shown)}
        disabled={disabled}
        aria-invalid={wrong || undefined}
        aria-describedby={wrong ? `${id}-range` : undefined}
        onChange={(event) => {
          setTyped(event.target.value)
          setWrong(false)
        }}
        onBlur={() => {
          commit(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(false)
          if (event.key === 'Escape') {
            setTyped(null)
            setWrong(false)
          }
        }}
        className={`${smallField} ${unit ? 'pr-8' : ''} ${wrong ? 'border-error' : 'border-rule'}`}
      />
      {unit && (
        <span aria-hidden="true" className="text-faint pointer-events-none absolute right-2 font-mono text-[11px]">
          {unit}
        </span>
      )}
      {wrong && (
        <span
          id={`${id}-range`}
          role="alert"
          className="text-error bg-base-100 border-error absolute top-full right-0 z-10 mt-0.5 border px-1.5 py-0.5 whitespace-nowrap font-mono text-[10px]"
        >
          {def.min} to {def.max}
        </span>
      )}
    </span>
  )
}
