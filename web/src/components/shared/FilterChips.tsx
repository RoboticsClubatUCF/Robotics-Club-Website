/**
 * A row of one-of-these chips, the way every queue on the dashboard draws it.
 *
 * The print queue and the borrowing queue both grew a status row of these, and
 * then both grew a second row underneath for narrowing what the status row
 * left. Four copies of the same fifteen lines is how one of them ends up a
 * pixel different from the others, so they became this — which is the rule in
 * `.claude/docs/frontend.md`: a component earns `shared/` by being used twice,
 * and this is used four times.
 *
 * Buttons rather than a `<select>`. The whole point of these is that the
 * options are *visible* — an officer scanning for the resin filter should see
 * that resin is a thing they can filter by without opening anything, and a
 * select box hides exactly that.
 */
export function FilterChips<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  /**
   * The mono caption in front of the row. Optional because the status row at
   * the top of a queue *is* the queue's own heading and does not want one —
   * the rows below it do, or PERSONAL and FDM sit side by side with nothing
   * saying they answer different questions.
   */
  label?: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {label && (
        <span className="text-faint mr-1 font-mono text-[10px] font-medium tracking-[0.16em]">
          {label}
        </span>
      )}

      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          aria-pressed={value === option.value}
          onClick={() => {
            onChange(option.value)
          }}
          className={`border-rule cursor-pointer border px-3 py-1.5 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50 ${
            value === option.value
              ? 'border-primary text-primary bg-primary/5'
              : 'text-faint hover:text-primary'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
