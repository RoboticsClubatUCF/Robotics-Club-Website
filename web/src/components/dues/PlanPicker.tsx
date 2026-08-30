import type { ApiDuesPlan, DuesPlan } from '../../lib/api/api'
import { formatDate, formatMoney, termsLabel } from '../../lib/dues/dues'

/**
 * The two things somebody can buy.
 *
 * Each card says what it costs, which terms it covers and the date cover runs
 * to, because "a year" is not a year here — it is fall and spring, or spring
 * and fall, with a free summer in the middle that the price does not pay for.
 * Somebody buying in January is buying through the following December, and a
 * card that said "1 year" would be quietly wrong about that.
 *
 * The prices and the dates are the server's, from `GET /api/dues/status`. This
 * component computes neither: the number on the card has to be the number that
 * gets charged.
 */
export function PlanPicker({
  plans,
  selected,
  onSelect,
  disabled,
}: {
  plans: ApiDuesPlan[]
  selected: DuesPlan | null
  onSelect: (plan: DuesPlan) => void
  disabled?: boolean
}) {
  return (
    <fieldset
      className="grid-fluid gap-4 [--col-min:16rem]"
      aria-label="Choose how long to pay for"
    >
      {plans.map((plan) => {
        const isSelected = plan.plan === selected

        return (
          <label
            key={plan.plan}
            /* The whole card is the target, not a radio dot beside it. On a
               phone this is the difference between a comfortable press and a
               twelve-pixel circle. */
            className={`flex cursor-pointer flex-col border p-5 transition-colors duration-200 ${
              isSelected
                ? 'border-primary bg-primary/5'
                : 'border-rule bg-base-200 hover:border-base-content/25'
            } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            <span className="flex items-start justify-between gap-3">
              <span>
                <span className="text-faint block font-mono text-[10px] font-medium tracking-[0.16em]">
                  {plan.plan === 'YEAR' ? 'ACADEMIC YEAR' : 'ONE SEMESTER'}
                </span>
                <span className="mt-2 block text-2xl leading-none font-bold tracking-[-0.02em]">
                  {formatMoney(plan.amountCents)}
                </span>
              </span>

              <input
                type="radio"
                name="duesPlan"
                value={plan.plan}
                checked={isSelected}
                disabled={disabled}
                onChange={() => {
                  onSelect(plan.plan)
                }}
                className="radio radio-sm border-rule checked:bg-primary checked:text-primary-content mt-1 shrink-0"
              />
            </span>

            <span className="text-dim mt-4 block text-sm leading-[1.6] text-pretty">
              Covers{' '}
              <strong className="text-base-content">{termsLabel(plan.covers)}</strong>,
              through {formatDate(plan.through)}.
            </span>

            {plan.plan === 'YEAR' && (
              <span className="text-faint mt-2 block text-[13px] leading-[1.5] text-pretty">
                Summer in between is free for everyone, paid or not.
              </span>
            )}
          </label>
        )
      })}
    </fieldset>
  )
}
