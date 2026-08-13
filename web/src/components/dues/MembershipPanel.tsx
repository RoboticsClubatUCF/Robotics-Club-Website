import type { ApiMembership } from '../../lib/api'
import {
  STATUS_CHIP,
  countdown,
  formatDate,
  formatShortDate,
  termLabel,
} from '../../lib/dues'

/**
 * Where a member stands, in one panel, on both the dashboard and the dues page.
 *
 * Four statuses and four different things to say, and the split that matters is
 * between the two that look identical from the member's side today: `FREE` and
 * `TRIAL` both mean "you owe nothing right now", and only one of them has a
 * date on which that stops. Collapsing them into "membership is free" is how
 * somebody finds out otherwise at the lab door.
 *
 * Every state names the date. A status with no date in it — "your trial is
 * active" — is the version of this panel that generates the questions it was
 * built to answer.
 */
export function MembershipPanel({
  membership,
  now = Date.now(),
}: {
  membership: ApiMembership
  /** Injectable so a test can pin the countdown to a known day. */
  now?: number
}) {
  const chip = STATUS_CHIP[membership.status]

  return (
    <div className="border-rule bg-base-200 border p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span
          className={`border px-2.5 py-1 font-mono text-[10px] font-medium tracking-[0.16em] ${chip.className}`}
        >
          {chip.label}
        </span>
        <ExpiryChip membership={membership} />
      </div>

      <Explanation membership={membership} now={now} />

      {/* The fallback dates are approximately right and the page says so rather
          than printing one as though UCF had published it. A member planning
          around a date that turns out to be a week off has been misled by a
          detail nobody mentioned. */}
      {!membership.billable.fromCalendar && (
        <p className="text-faint mt-4 text-[13px] leading-[1.5] text-pretty">
          These dates are our usual ones — UCF's academic calendar could not be
          reached just now, so they may be a few days out.
        </p>
      )}
    </div>
  )
}

/**
 * The date beside the status, which used to be the name of the term.
 *
 * The term was the least useful thing that could go there — somebody reading
 * their own membership already knows what semester it is, and what they came to
 * find out is when it runs out. Every state has a date worth naming: the day
 * cover ends for anybody active, the day the free run closes on a trial or a
 * break, and for somebody expired the day it already lapsed.
 *
 * Falls back to the term only when there is genuinely no date — an account that
 * has never paid anything and is past the trial.
 */
function ExpiryChip({ membership }: { membership: ApiMembership }) {
  const [label, date] =
    membership.status === 'ACTIVE'
      ? (['UNTIL', membership.paidThrough] as const)
      : membership.status === 'EXPIRED'
        ? (['LAPSED', membership.paidThrough] as const)
        : (['FREE UNTIL', membership.freeThrough] as const)

  return (
    <span className="text-faint font-mono text-[10px] font-medium tracking-[0.16em]">
      {date
        ? `${label} ${formatDate(date).toUpperCase()}`
        : termLabel(membership.term).toUpperCase()}
    </span>
  )
}

function Explanation({
  membership,
  now,
}: {
  membership: ApiMembership
  now: number
}) {
  const line = 'text-dim text-sm leading-[1.7] text-pretty'
  const lead = 'mb-1.5 text-sm font-semibold'

  /**
   * Active on a claimed free window rather than on a payment. Its own sentence,
   * because the paid one below would be a lie: nothing has been paid, and a
   * member who reads "your dues are paid" in July turns up in September
   * expecting to be covered.
   */
  if (membership.status === 'ACTIVE' && membership.freeActive) {
    return (
      <>
        <p className={lead}>Your membership is active.</p>
        <p className={line}>
          {membership.term.season === 'SUMMER'
            ? 'Summer costs nothing, and you have claimed it. '
            : 'The break between terms costs nothing, and you have claimed it. '}
          Dues for{' '}
          <strong className="text-white">{termLabel(membership.billable)}</strong>{' '}
          start
          {membership.freeThrough
            ? ` after the free fortnight, on ${formatShortDate(membership.freeThrough)}`
            : ' when the term does'}
          . You can settle those now if you would rather have it done with.
        </p>
      </>
    )
  }

  // `!freeActive` is redundant against the branch above and is here anyway: it
  // is the condition that makes this branch true on its own terms rather than
  // by being second. `paidThrough` is only *current* cover for somebody active
  // on a payment — a claimed free window leaves a lapsed date sitting there,
  // and reading that one back as "paid through" is a bug this page has had.
  if (
    membership.status === 'ACTIVE' &&
    !membership.freeActive &&
    membership.paidThrough
  ) {
    return (
      <>
        <p className={lead}>Your dues are paid.</p>
        <p className={line}>
          Membership runs through{' '}
          <strong className="text-white">
            {formatDate(membership.paidThrough)}
          </strong>
          . Summer is free either way, so nothing lapses over the break.
        </p>
      </>
    )
  }

  if (membership.status === 'TRIAL' && membership.freeThrough) {
    return (
      <>
        <p className={lead}>You are on the two-week free trial.</p>
        <p className={line}>
          It ends{' '}
          <strong className="text-white">
            {countdown(membership.freeThrough, now)}
          </strong>
          , on {formatShortDate(membership.freeThrough)}. Come and see what is
          being built — and you can pay for the semester or the year at any
          point before then rather than waiting for it to run out.
        </p>
      </>
    )
  }

  if (membership.status === 'FREE') {
    // Summer, or the gap between one term ending and the next beginning. Both
    // are genuinely free, and both end on a date worth naming.
    return (
      <>
        <p className={lead}>
          {membership.term.season === 'SUMMER'
            ? 'Summer is free.'
            : 'Nothing is due between semesters.'}
        </p>
        <p className={line}>
          {membership.term.season === 'SUMMER'
            ? 'Membership costs nothing over the summer, and the lab is open when there is someone to open it. '
            : 'The term has not started yet, so there are no dues to pay. '}
          Dues for{' '}
          <strong className="text-white">
            {termLabel(membership.billable)}
          </strong>{' '}
          begin after the free trial, which runs to{' '}
          {membership.freeThrough
            ? formatShortDate(membership.freeThrough)
            : formatShortDate(membership.billable.startsAt)}
          .{' '}
          {membership.canActivate
            ? 'Switch your membership on for it below — it costs nothing and takes one press.'
            : 'You can pay now and have it done with.'}
        </p>
      </>
    )
  }

  return (
    <>
      <p className={lead}>Your dues are not paid for this semester.</p>
      <p className={line}>
        {membership.paidThrough
          ? `Membership lapsed on ${formatDate(membership.paidThrough)}. `
          : 'The free trial for this semester has ended. '}
        Paying keeps your access to the lab and to project teams —{' '}
        {termLabel(membership.billable)} is covered as soon as it goes through.
      </p>
    </>
  )
}
