import type { ApiMembership } from '../../lib/api/api'
import {
  STATUS_CHIP,
  countdown,
  formatDate,
  formatShortDate,
  termLabel,
} from '../../lib/dues/dues'

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
          UCF's academic calendar could not be reached, so these are our
          usual dates and may be a few days out.
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
        // Not "FREE UNTIL", which read as *you are covered until then*. In this
        // state they are not covered at all — the date is a deadline to act on,
        // not cover they hold.
        : (['CLAIM BY', membership.freeThrough] as const)

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
          It runs
          {membership.paidThrough
            ? ` to ${formatShortDate(membership.paidThrough)}`
            : ' to the end of the free window'}
          , three weeks into{' '}
          <strong className="text-base-content">{termLabel(membership.billable)}</strong>
          , when dues start.
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
          <strong className="text-base-content">
            {formatDate(membership.paidThrough)}
          </strong>
          . Summer is free either way.
        </p>
      </>
    )
  }

  /**
   * Free, and **not claimed** — which is the state that changed meaning.
   *
   * `FREE` used to say "the club is charging nobody, so you are covered". It
   * now says "the club is charging nobody, and you are still not covered",
   * because access is the dues date and this person has none. So the lead line
   * has to be about them rather than about the calendar: somebody who reads
   * "summer is free" and then cannot open the print page has been told the
   * wrong thing.
   */
  if (membership.status === 'FREE') {
    return (
      <>
        <p className={lead}>Your membership is free to claim.</p>
        <p className={line}>
          {membership.term.season === 'SUMMER'
            ? 'The club charges nothing over the summer. '
            : 'The club charges nothing between semesters. '}
          It still has to be switched on. One press covers you to{' '}
          <strong className="text-base-content">
            {membership.freeThrough
              ? formatShortDate(membership.freeThrough)
              : formatShortDate(membership.billable.startsAt)}
          </strong>
          , three weeks into {termLabel(membership.billable)}, when dues for that
          term begin.
        </p>
        {/* The deadline as a countdown as well as a date, and only here. A
            window that shuts in three days is the one state on this page where
            waiting costs something, and "on 7 September" does not read as
            urgent in August. */}
        {membership.freeThrough && (
          <p className={line}>
            The window closes{' '}
            <strong className="text-base-content">
              {countdown(membership.freeThrough, now)}
            </strong>
            .
          </p>
        )}
      </>
    )
  }

  return (
    <>
      <p className={lead}>Your dues are not paid for this semester.</p>
      <p className={line}>
        {membership.paidThrough
          ? `Membership lapsed on ${formatDate(membership.paidThrough)}. `
          : 'The free window for this semester has closed. '}
        Paying brings back the lab, the printers and every tool on your
        projects. {termLabel(membership.billable)} is covered as soon as it goes
        through.
      </p>
    </>
  )
}
