import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  measureClass,
} from '../shared/formChrome'

/**
 * What somebody who is not on the board sees where an officer desk would be.
 *
 * The third of the three refusals in this folder, beside `DuesLocked` and
 * `MembersOnly`, and it is the one that was written out eight times. Every
 * officer desk opens with the same two checks in the same order — dues, then
 * the board — and the second one drew this panel inline, identical but for the
 * eyebrow and one sentence. Eight copies of a refusal is eight places for the
 * wording to drift, and the wording is the whole of what this component is.
 *
 * **`why` is the only thing a desk supplies, and it is not decoration.** A
 * member who lands here from a bookmark is owed the reason this particular desk
 * is board business — members' allergies, the club's price list, who gets a
 * key — rather than a bare "no". Each desk knows its own reason; nothing else
 * does.
 *
 * **This hides a door the server has already locked**, which is the only order
 * that is safe. Every route behind these desks goes through `requireOfficer` in
 * `server/src/auth/authz.ts`, so deleting this file would cost a stranger a
 * screen of controls that all 403 and nothing else.
 */
export function OfficerOnly({
  eyebrow,
  why,
}: {
  /** The desk's own eyebrow, so the page still says where it is. */
  eyebrow: string
  /** One sentence: what this desk holds that makes it the board's. */
  why: string
}) {
  return (
    <>
      <FormEyebrow>{eyebrow}</FormEyebrow>
      <FormHeading>This desk belongs to the officers.</FormHeading>

      <div className={measureClass}>
        <FormPanel>
          <p className="text-dim text-sm leading-[1.7] text-pretty">{why}</p>
        </FormPanel>
      </div>
    </>
  )
}
