import { prisma } from './db.js'
import { UserRole } from './generated/prisma/enums.js'
import { membershipStanding } from './semester.js'

/**
 * Taking `MEMBER` back off somebody whose dues have run out.
 *
 * The other half of the loop `membershipUpdateFor` opens: paying — or claiming a
 * free break — moves a `GUEST` to `MEMBER`, and this is what moves them back
 * when the term's dues go unpaid.
 *
 * Two halves, and they are for different people. `demoteIfLapsed` runs on the
 * request and covers anybody who turns up — so somebody whose membership ran
 * out while they were reading the page is a guest on their next click, not ten
 * minutes later. `sweepLapsedMembers` runs on the timer and covers everybody
 * who does *not* turn up, which is most of a lapsed roster: the whole point is
 * that they have stopped coming.
 *
 * Nothing about access hangs on either of them. Access is decided by
 * `membershipStanding` at the moment of the request, so a member whose dues
 * lapsed an hour ago is already locked out of anything gated whether or not
 * this has run. What the role decides is the *roster*: `onRoster` wants a slug
 * and a role above `GUEST`, so this is what stops the public members page
 * listing people who left two years ago.
 *
 * Three things it deliberately will not do.
 *
 * **It only demotes `MEMBER`.** Officers, mentors, alumni and the two lead
 * labels are roles somebody was given for a reason that is not a payment, and a
 * sweep that quietly stripped an officer of their seat because they forgot to
 * pay would be a much worse bug than the one this fixes. Their *tools* lock —
 * see `requireCurrentDues` in `authz.ts` — and their title does not move.
 *
 * **It only demotes people the site itself promoted**, which is what
 * `duesPaidThrough: { not: null }` is for. A `MEMBER` with no payment on record
 * is a roster entry an officer typed by hand — most of the club, historically —
 * and reaching outside the site's own loop to demote them would empty the roster
 * the first time this ran. The rule is the same one `membershipUpdateFor`
 * follows from the other direction: never overwrite a role a person chose.
 *
 * **It stands down when the term dates are guesses.** If calendar.ucf.edu could
 * not be read, `fromCalendar` is false and the dates are the fixed fallbacks —
 * approximately right, which is fine for quoting a price and not fine for
 * changing what somebody is. It says so in the log rather than going quiet.
 *
 * **`User.role` has exactly two writers, and this is one of them.** The other
 * is `membershipUpdateFor` in `routes/dues.ts`, promoting a `GUEST` who pays or
 * claims a free window — the same loop from the other direction. There used to
 * be a third, moving `PROJECT_LEAD`/`TEAM_LEAD` roster labels as lead seats
 * came and went; those values are not roles any more and that loop is gone.
 * Leading a project is `ProjectMember.rank`, and nothing about a project
 * touches this column.
 *
 * So the rule is now sayable in one line: **the site moves people between
 * `MEMBER` and `GUEST` on the strength of dues, and never writes anything
 * else.** Officer and admin are conferred by a person.
 */
export interface SweepReport {
  /** How many members were moved back to `GUEST`. */
  demoted: number
  /** Set when nothing was attempted, and why. */
  skipped?: 'nothing-is-expired' | 'calendar-unreadable'
}

/**
 * Demote this one person, now, if their dues have run out.
 *
 * The live half. `resolve()` calls it on every authenticated request, so
 * somebody whose membership lapsed while they were reading the page is a
 * `GUEST` on their very next click rather than up to ten minutes later. The
 * sweep below is then the backstop for everybody who is *not* clicking — the
 * roster has to be right for people who never sign in again, and that is the
 * case a request-time hook can never cover.
 *
 * Cheap enough to sit on every request, which is the only reason it can. The
 * three-part pre-filter is pure arithmetic on a row that has already been read,
 * and it is false for every guest, every officer, every paid-up member and
 * every hand-made roster entry — so the calendar is not even consulted unless
 * somebody is genuinely on the edge. Past the filter it runs at most once per
 * person per lapse, because the row it writes is what makes the filter false
 * from then on.
 *
 * Returns the role to use for *this* request, so the caller does not answer
 * with the one it just took away.
 */
export async function demoteIfLapsed(user: {
  id: string
  role: UserRole
  duesPaidThrough: Date | null
}): Promise<UserRole> {
  const now = new Date()

  if (
    user.role !== UserRole.MEMBER ||
    user.duesPaidThrough === null ||
    user.duesPaidThrough > now
  ) {
    return user.role
  }

  // **`duesRequired`, not `hasAccess`** — and the difference is the reason this
  // line exists at all. Access is now the date alone, so by this point
  // `hasAccess` is already false and reading it would demote somebody the
  // moment their date passed, in the middle of a free window they have not got
  // round to claiming. `duesRequired` asks the other question: is anything
  // actually owed, or is the club not charging this week?
  //
  // Which keeps the *roster* role and *access* apart on purpose. Access went
  // the day the date did; the role is "have you joined and not drifted away",
  // and dropping somebody off the public roster during a fortnight when the
  // club is charging nobody would be churn rather than information. The sweep
  // below turns on exactly the same condition, and the two must not diverge.
  const standing = await membershipStanding(user.duesPaidThrough, now)
  if (!standing.duesRequired) return user.role

  // Guarded on the role, so two requests racing write once. A failure here is
  // not worth failing the request over — the sweep will pick them up.
  try {
    await prisma.user.updateMany({
      where: { id: user.id, role: UserRole.MEMBER },
      data: { role: UserRole.GUEST },
    })
  } catch (error) {
    console.error(`membership: could not demote ${user.id}`, error)
    return user.role
  }

  return UserRole.GUEST
}

export async function sweepLapsedMembers(
  now: Date = new Date(),
): Promise<SweepReport> {
  // Whether the club is charging anybody right now is a property of the
  // calendar rather than of any one person — the free window runs for everybody
  // at once — so one probe with no payment behind it answers it for the whole
  // roster, and most of the year this is where the sweep stops.
  //
  // `duesRequired` is the same condition `demoteIfLapsed` uses above, and they
  // have to stay the same one: the live path and the timer disagreeing means a
  // member's role depends on whether they happened to load a page.
  const standing = await membershipStanding(null, now)

  if (!standing.duesRequired) return { demoted: 0, skipped: 'nothing-is-expired' }

  if (!standing.billable.fromCalendar) {
    console.warn(
      'membership sweep: standing down — calendar.ucf.edu could not be read, and fallback dates are not good enough to change what somebody is',
    )
    return { demoted: 0, skipped: 'calendar-unreadable' }
  }

  const { count } = await prisma.user.updateMany({
    where: {
      role: UserRole.MEMBER,
      // Paid at some point, and not covering today. Null is excluded on
      // purpose — see the note above.
      duesPaidThrough: { not: null, lte: now },
    },
    data: { role: UserRole.GUEST },
  })

  return { demoted: count }
}
