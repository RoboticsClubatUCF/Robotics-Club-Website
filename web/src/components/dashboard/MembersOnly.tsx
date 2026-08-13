import { Link } from 'react-router'
import { FormEyebrow, FormHeading, FormPanel } from '../shared/formChrome'

/**
 * What a guest sees where 3D printing or equipment borrowing would be.
 *
 * Its own component rather than a variant of `DuesLocked`, because the two
 * states are not the same thing said differently. A lapsed member is being told
 * that something they had is on hold and comes straight back; a guest is being
 * told what membership *is*, having never had it. Sharing a component would
 * have meant swapping every sentence anyway.
 *
 * The whole page rather than a banner over a disabled form, for the reason
 * `DuesLocked` gives: every control under it would 403, and one clear sentence
 * beats a screen of buttons that all fail.
 *
 * It does not scold and it does not oversell. Having an account is a perfectly
 * reasonable place to be — plenty of people look around for a term first — so
 * the page says what the line is and where the door is, and stops.
 */
export function MembersOnly({
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
      <FormHeading>{thing} are for members.</FormHeading>

      <FormPanel tone="accent">
        <p className="mb-1.5 text-sm font-semibold">
          Your account is enough to look around.
        </p>
        <p className="text-dim text-sm leading-[1.7] text-pretty">
          Browsing projects, reading the calendar and coming to a meeting need
          nothing from you. This page is different: it spends club money, so it
          asks that you have actually joined.
        </p>
        <p className="text-dim mt-3 text-sm leading-[1.7] text-pretty">
          {/* Named as one page and one press, because it is — and because a
              guest reading "become a member" with no idea what that involves
              assumes it is more than it is. */}
          Joining takes one page. Pay for the semester, or — if the club is in
          a free stretch, like the summer — switch your membership on for
          nothing. Either one opens this straight away.
        </p>
        <Link
          to="/dashboard/dues"
          className="btn btn-primary btn-cta mt-5 px-7 py-[15px] text-[13px] font-semibold"
        >
          GO TO DUES &amp; PAYMENTS
        </Link>
      </FormPanel>
    </>
  )
}
