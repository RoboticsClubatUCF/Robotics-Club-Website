import { useId, useState } from 'react'
import { smallField } from './slicerChrome'

/**
 * A number committed on Enter or blur, not per keystroke, and refused outside its bounds. The
 * plate saves on every commit, so "120" must not save 1 and 12 on the way.
 */
export function NumberInput({
  label,
  name,
  value,
  min,
  max,
  step = 1,
  unit,
  disabled,
  onCommit,
}: {
  label: string
  /** What a screen reader hears, when the visible label needs its group to make sense: "X" is
      ambiguous in a panel with three of them, "Rotation X" isn't. */
  name?: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  disabled?: boolean
  onCommit: (value: number) => void
}) {
  const id = useId()
  const [typed, setTyped] = useState<string | null>(null)
  const [wrong, setWrong] = useState(false)
  const places = Math.max(0, Math.ceil(-Math.log10(step)))
  const shown = Number(value.toFixed(places))

  const valid = (text: string) => {
    const parsed = Number(text)
    return text.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max
  }

  const commit = (leaving: boolean) => {
    if (typed === null) return
    const parsed = Number(typed)
    if (!valid(typed)) {
      // On Enter it says why and keeps what was typed; on leaving, the box goes back to what's
      // saved, so the screen never shows a number the plate doesn't have.
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
    if (parsed !== shown) onCommit(parsed)
  }

  return (
    <label className="block">
      <span className="text-faint mb-0.5 block font-mono text-[9.5px] tracking-[0.14em] uppercase">
        {label}
      </span>
      <span className="relative flex items-center">
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={typed ?? String(shown)}
          disabled={disabled}
          aria-label={name}
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
          className={`${smallField} ${unit ? 'pr-7' : ''} ${wrong ? 'border-error' : 'border-rule'}`}
        />
        {unit && (
          <span aria-hidden="true" className="text-faint pointer-events-none absolute right-2 font-mono text-[10px]">
            {unit}
          </span>
        )}
      </span>
      {wrong && (
        <span id={`${id}-range`} role="alert" className="text-error mt-0.5 block font-mono text-[10px]">
          {min} to {max}
        </span>
      )}
    </label>
  )
}
