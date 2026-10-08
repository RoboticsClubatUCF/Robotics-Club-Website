import { type ReactNode, useId, useState } from 'react'
import type { Option } from '../../lib/training/curriculum'

/**
 * A knowledge check: one question, a few answers. Pressing one says at once whether it's right and
 * why; a wrong one can be changed, and a right one stays. Buttons rather than a radio group, so
 * moving through the answers with the arrow keys doesn't pick each one on the way.
 */
export function CheckStep({
  question,
  picture,
  options,
  answered,
  onRight,
}: {
  question: string
  picture?: ReactNode
  options: Option[]
  /** Answered right before: opens on that answer. */
  answered: boolean
  onRight: () => void
}) {
  const id = useId()
  const [picked, setPicked] = useState<number | null>(() => (answered ? options.findIndex((o) => o.right) : null))
  const option = picked === null ? null : options[picked]
  const settled = option?.right === true

  return (
    <div role="group" aria-labelledby={`${id}-question`}>
      <p id={`${id}-question`} className="mb-4 text-[17px] leading-[1.45] font-semibold text-pretty">
        {question}
      </p>
      {picture}
      <ul className="space-y-2">
        {options.map((choice, index) => {
          const chosen = picked === index
          return (
            <li key={choice.text}>
              <button
                type="button"
                aria-pressed={chosen}
                disabled={settled && !chosen}
                onClick={() => {
                  if (settled) return
                  setPicked(index)
                  if (choice.right) onRight()
                }}
                className={`flex min-h-11 w-full cursor-pointer items-start gap-3 border px-4 py-3 text-left text-[15px] leading-[1.5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default disabled:opacity-60 ${
                  chosen
                    ? choice.right
                      ? 'border-success bg-success/8'
                      : 'border-error bg-error/8'
                    : 'border-rule hover:border-base-content/40'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`w-4 shrink-0 font-mono text-[13px] ${chosen ? (choice.right ? 'text-success' : 'text-error') : 'text-faint'}`}
                >
                  {chosen ? (choice.right ? '✓' : '✗') : String.fromCharCode(65 + index)}
                </span>
                <span>{choice.text}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <p role="status" className="mt-4 min-h-6 text-[15px] leading-[1.6] text-pretty">
        {option && (
          <>
            <span className={`font-mono text-[12px] font-semibold tracking-[0.12em] ${option.right ? 'text-success' : 'text-error'}`}>
              {option.right ? 'RIGHT · ' : 'NOT QUITE · '}
            </span>
            <span className="text-dim">{option.right ? option.why.replace(/^Right\. /, '') : `${option.why} Try another.`}</span>
          </>
        )}
      </p>
    </div>
  )
}
