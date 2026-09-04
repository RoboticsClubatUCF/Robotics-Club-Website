import { prisma } from '../core/db.js'
import { UserRole } from '../generated/prisma/enums.js'
import { membershipStanding } from './semester.js'

/**
 * Taking `MEMBER` back off somebody whose dues have run out.
 *
 * The other half of the loop `membershipUpdateFor` opens: paying — or claiming a free
 * break — moves a `GUEST` to `MEMBER`, and this moves them back when the term's dues go
 * unpaid.
 *
 * Two halves, for different people. `demoteIfLapsed` runs on the request and covers
 * anybody who turns up, so somebody whose membership ran out while they were reading
 * the page is a guest on their next click. `sweepLapsedMembers` runs on the timer and
 * covers everybody who doesn't turn up, which is most of a lapsed roster.
 *
 * Nothing about access hangs on either. Access is decided by `membershipStanding` at
 * the moment of the request.
 *
 * What the role decides is who counts as a member, in the two places that still ask:
 * the landing page's ACTIVE MEMBERS figure and the club's Discord Members role. It no
 * longer decides who appears on `/members`, so a demotion takes somebody off a count
 * and out of a Discord role, and leaves their card where it was.
 *
 * Three things it deliberately won't do.
 *
 * It only demotes `MEMBER`. Officers, mentors, alumni and the two lead labels were
 * given for a reason that isn't a payment, and stripping an officer of their seat
 * because they forgot to pay would be a worse bug than the one this fixes. Their tools
 * lock; their title doesn't move.
 *
 * It only demotes people the site itself promoted, which is what
 * `duesPaidThrough: { not: null }` is for. A `MEMBER` with no payment on record is a
 * roster entry an officer typed by hand — most of the club, historically — and reaching
 * outside the site's own loop would empty the roster the first time this ran.
 *
 * It stands down when the term dates are guesses. If calendar.ucf.edu couldn't be read,
 * the dates are the fixed fallbacks: fine for quoting a price, not fine for changing
 * what somebody is. It says so in the log rather than going quiet.
 *
 * `User.role` has exactly two writers, and this is one. The other is
 * `membershipUpdateFor` in `routes/member/dues.ts`. There used to be a third, moving
 * lead labels as seats came and went; those values aren't roles any more.
 *
 * So the rule is one line: the site moves people between `MEMBER` and `GUEST` on the
 * strength of dues, and never writes anything else. Officer and admin are conferred by
 * a person.
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
 * The live half. `resolve()` calls it on every authenticated request, so somebody whose
 * membership lapsed while they were reading the page is a `GUEST` on their next click.
 * The sweep is the backstop for everybody who isn't clicking — the roster has to be
 * right for people who never sign in again.
 *
 * Cheap enough to sit on every request, which is the only reason it can. The three-part
 * pre-filter is pure arithmetic on a row already read, and it's false for every guest,
 * officer, paid-up member and hand-made roster entry. Past the filter it runs at most
 * once per person per lapse, because the row it writes makes the filter false.
 *
 * Returns the role to use for this request, so the caller doesn't answer with the one
 * it just took away.
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

  // `duesRequired`, not `hasAccess`, and the difference is why this line exists. Access
  // is the date alone, so by here `hasAccess` is already false and reading it would
  // demote somebody the moment their date passed, in the middle of a free window they
  // haven't got round to claiming. `duesRequired` asks whether anything is actually owed.
  //
  // Which keeps the membership role and access apart on purpose. Access went the day the
  // date did; the role is "have you joined and not drifted away", and taking somebody
  // out of the headline count during a stretch when the club is charging nobody would be
  // churn. The sweep turns on the same condition, and the two must not diverge.
  const standing = await membershipStanding(user.duesPaidThrough, now)
  if (!standing.duesRequired) return user.role

  // Guarded on the role, so two requests racing write once. A failure here isn't worth
  // failing the request over — the sweep will pick them up.
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
  // Whether the club is charging anybody right now is a property of the calendar rather
  // than of any one person — the free window runs for everybody at once — so one probe
  // with no payment behind it answers it for the whole roster, and most of the year this
  // is where the sweep stops.
  //
  // `duesRequired` is the same condition `demoteIfLapsed` uses, and they have to stay
  // the same one: the live path and the timer disagreeing means a member's role depends
  // on whether they happened to load a page.
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
