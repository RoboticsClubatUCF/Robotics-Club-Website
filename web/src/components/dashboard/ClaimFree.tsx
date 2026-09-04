import { Link } from 'react-router'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  measureClass,
} from '../shared/formChrome'

/**
 * What somebody sees behind a lock while membership is free for the asking.
 *
 * The third sentence, and the one that did not used to exist. When the summer and the opening weeks
 * granted access to the whole club whether or not anybody claimed anything, there was nothing to
 * say here — the page simply opened. Access is the dues date now, so a member who has not pressed
 * the button is locked out of a club that is charging them nothing, which is a state that has to
 * explain itself or it reads as a bug.
 *
 * Its own component rather than a variant of `DuesLocked` or `MembersOnly`, for the reason those
 * two are separate from each other: the sentences are not the same sentence with a word swapped.
 * This one must not mention money at all — quoting a price to somebody who owes nothing is how they
 * close the tab — and it must make the press sound like what it is, which is one click and no card.
 */
export function ClaimFree({
  eyebrow,
  thing,
}: {
  eyebrow: string
  /** What is behind the door, in a few words: "The printers", "The loan shelf". */
  thing: string
}) {
  return (
    <>
      <FormEyebrow>{eyebrow}</FormEyebrow>
      <FormHeading>{thing} are one press away.</FormHeading>

      <div className={measureClass}>
        <FormPanel tone="accent">
          <p className="mb-1.5 text-sm font-semibold">
            Membership is free right now, and you have not switched it on.
          </p>
          {/* Said plainly, because "activate your membership" reads like a
              step with a form behind it. There is no form and no card. */}
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            One press, no payment, and this opens straight away.
          </p>
          <Link
            to="/dashboard/dues"
            className="btn btn-primary btn-cta mt-5 px-7 py-[15px] text-[13px] font-semibold"
          >
            CLAIM MY MEMBERSHIP
          </Link>
        </FormPanel>
      </div>
    </>
  )
}
