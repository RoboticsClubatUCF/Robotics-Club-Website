/**
 * A horizontal sub-navigation strip for dashboard pages that group several
 * distinct areas of work (account settings, project management, officer desks).
 *
 * Uses a gold bottom bar alongside gold text on the active tab so colour never
 * carries state alone, matching the dashboard rail. Touch targets are 44px
 * tall below `wide`.
 */
export function SubMenu<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="border-rule mb-7 flex flex-wrap items-center gap-1 border-b"
    >
      {options.map((option) => {
        const active = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => {
              onChange(option.value)
            }}
            className={`focus-visible:outline-primary -mb-px min-h-11 cursor-pointer border-b-2 px-4 py-2 font-mono text-[11px] font-medium tracking-[0.14em] uppercase transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 wide:min-h-9 ${
              active
                ? 'border-primary bg-primary/10 text-primary'
                : 'text-faint hover:bg-base-content/5 hover:text-base-content border-transparent'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
