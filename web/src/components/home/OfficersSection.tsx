import { Link } from 'react-router'
import { OfficerCard, officerGridClass } from '../shared/OfficerCard'
import type { ApiOfficerBoard, OfficerPosition } from '../../lib/api/api'
import { seatLabel } from '../../lib/officerTerms'
import { useApi } from '../../lib/api/useApi'

/**
 * The officer board: one card per officer, and one per chair nobody is in.
 *
 * Both counts come from the database. `GET /api/officers` sends the sitting officers and the seats
 * there are — the second straight out of the `OfficerPosition` enum — so a ninth seat added to the
 * schema draws a ninth card with nothing edited here.
 *
 * It was a fixed eight until now, from a list in `content/home.ts` that the response only filled
 * in, and that was wrong in two directions. The club could not change the size of its own board
 * without a frontend edit; and an officer holding no seat — exactly what the Discord sync creates,
 * before anybody has given them a chair — had nowhere to be drawn, so a real officer was invisible
 * here while being an officer everywhere else.
 *
 * The empty chairs are still drawn, because that half of the old design was right: a club with no
 * treasurer this term still has a treasurer's seat, and "Seat open" says so where a missing card
 * would look like a shorter board.
 *
 * The card itself is `shared/OfficerCard` — the archive at `/officers` draws the same one.
 */
export function OfficersSection() {
  const board = useApi<ApiOfficerBoard>('/officers')

  const ready = board.status === 'ready'
  const officers = ready ? board.data.officers : []
  const seats = ready ? board.data.seats : []

  /**
   * Seated officers first, in the order the server sent them — it can see how the enum is declared
   * and the browser cannot — then the empty chairs, then anybody serving without one.
   *
   * The seatless go last rather than in amongst the others, where a card would read as holding
   * whichever seat came above it.
   */
  const seated = officers.filter((officer) => officer.position !== null)
  const held = new Set(seated.map((officer) => officer.position))
  const empty: OfficerPosition[] = seats.filter((seat) => !held.has(seat))
  const seatless = officers.filter((officer) => officer.position === null)

  /**
   * How many frames to draw while waiting, and it can only be a guess: the count is the answer that
   * has not arrived. Four is the compromise — enough that the section does not appear out of
   * nothing, few enough that a small board does not visibly shrink when it lands. Sizing the
   * skeleton exactly is the one thing given up by letting the club decide how many seats it has.
   */
  const waiting = board.status === 'loading' ? 4 : 0

  const nothing = ready && officers.length === 0 && seats.length === 0

  return (
    <section
      id="officers"
      className="border-rule px-page scroll-mt-20 border-t py-12 wide:py-18"
    >
      <div className="mb-9 flex items-baseline justify-between">
        <h2 className="text-faint font-mono text-[13px] font-bold tracking-[0.2em]">
          / OFFICERS
        </h2>
        {/* A real `<Link>`, unlike most of the section headers, because this one
            points at a page that exists — `/members` did not, and still does
            not. See the note on links in `.claude/docs/frontend.md`. */}
        <Link
          to="/officers"
          className="text-primary border-primary/40 hover:border-primary border-b pb-0.5 text-xs font-medium transition-colors duration-200"
        >
          Past officers
        </Link>
      </div>

      {board.status === 'error' && (
        <p className="border-rule text-faint border-t py-6.5 text-sm">
          Couldn&rsquo;t load the officer board just now. Please try again later.
        </p>
      )}

      {/* Different from a board of empty chairs: no seats *and* nobody in them
          means the club has not set this up, not that every seat happens to be
          vacant. */}
      {nothing && (
        <p className="border-rule text-faint border-t py-6.5 text-sm">
          No officers are listed yet.
        </p>
      )}

      {board.status !== 'error' && !nothing && (
        <ul className={officerGridClass}>
          {Array.from({ length: waiting }, (_, index) => (
            <li key={`waiting-${String(index)}`} className="flex">
              <OfficerCard seat="" name={null} photoUrl={null} loading />
            </li>
          ))}

          {seated.map((officer) => (
            <li key={officer.id} className="flex">
              <OfficerCard
                seat={seatLabel(officer.position)}
                name={officer.fullName}
                photoUrl={officer.photoUrl}
                profileUrl={officer.profileUrl}
              />
            </li>
          ))}

          {empty.map((seat) => (
            <li key={seat} className="flex">
              <OfficerCard
                seat={seatLabel(seat)}
                name={null}
                note="Seat open"
                photoUrl={null}
              />
            </li>
          ))}

          {seatless.map((officer) => (
            <li key={officer.id} className="flex">
              <OfficerCard
                seat={seatLabel(null)}
                name={officer.fullName}
                photoUrl={officer.photoUrl}
                profileUrl={officer.profileUrl}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
