import { Link } from 'react-router'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  measureClass,
} from '../shared/formChrome'

/**
 * What a lead or an officer sees on a management page while their dues are out.
 *
 * The whole page, rather than a banner over a disabled form. Every button on
 * these pages would 403 anyway — `requireCurrentDues` in `server/src/auth/authz.ts`
 * is the thing actually refusing — and a screen full of controls that all fail
 * is a worse answer than one sentence saying why.
 *
 * The reassurance is not padding. The fear this state creates is "have I lost
 * my project", and the answer is no: rank is untouched, nothing has been
 * reassigned, and paying puts it all back the same minute.
 */
export function DuesLocked({ eyebrow }: { eyebrow: string }) {
  return (
    <>
      <FormEyebrow>{eyebrow}</FormEyebrow>
      <FormHeading>Your dues have lapsed.</FormHeading>

      <div className={measureClass}>
        <FormPanel tone="accent">
          <p className="mb-1.5 text-sm font-semibold">
            These tools come back the moment you pay.
          </p>
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            You keep every project and rank you had. Running things is the part
            that needs a current membership.
          </p>
          <Link
            to="/dashboard/dues"
            className="btn btn-primary btn-cta mt-5 px-7 py-[15px] text-[13px] font-semibold"
          >
            GO TO DUES &amp; PAYMENTS
          </Link>
        </FormPanel>
      </div>
    </>
  )
}
