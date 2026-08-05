import { officerSeats } from '../content/home'
import type { ApiMember } from '../lib/api'
import { useApi } from '../lib/useApi'

/**
 * The officer board: one headshot per seat, always eight of them.
 *
 * The cards come from `officerSeats`, not from the response. The board has a
 * fixed shape — a club with no treasurer this term still has a treasurer's
 * seat — so a missing person is a card that says the seat is open, not a card
 * that vanishes and reflows the other seven. `GET /api/officers` only fills
 * them in.
 *
 * That also means the failure and loading states have something to draw: the
 * grid is the same eight frames either way, with the names replaced by a
 * skeleton or left blank.
 *
 * The caption is the seat and the name and nothing else. `title`, `subteam` and
 * `gradYear` all come back in the response and are all deliberately unprinted —
 * eight cards of uneven length read as a table of exceptions rather than a
 * board. Anything more about a person belongs on their roster page.
 */

const gridClass = 'bg-rule border-rule grid grid-cols-2 gap-px border wide:grid-cols-4'

const cardClass = 'bg-base-100 flex h-full w-full flex-col'

/**
 * A ratio rather than a height, so eight photos at eight different sizes still
 * line their captions up and the grid holds its shape before any of them load.
 *
 * The frame takes the card's full width, so it scales with the card at every
 * screen size rather than being stranded in a corner of one.
 *
 * Square, because that is what makes it read as a headshot: a standing frame
 * asks to be filled down to the waist, and eight of them turn the board into a
 * wall of full-length portraits. It also cuts a third off the section's height.
 */
const frameClass =
  'bg-base-200 flex aspect-square w-full items-center justify-center overflow-hidden'

export function OfficersSection() {
  const officers = useApi<ApiMember[]>('/officers')

  const holderOf = new Map(
    officers.status === 'ready'
      ? officers.data.flatMap((officer) =>
          officer.officerPosition ? [[officer.officerPosition, officer] as const] : [],
        )
      : [],
  )

  return (
    <section
      id="officers"
      className="border-rule px-page scroll-mt-20 border-t py-12 wide:py-18"
    >
      <div className="mb-9 flex items-baseline justify-between">
        <h2 className="text-faint font-mono text-[13px] font-bold tracking-[0.2em]">
          / OFFICERS
        </h2>
        <a
          href="/members"
          className="text-primary border-primary/40 hover:border-primary border-b pb-0.5 text-xs font-medium transition-colors duration-200"
        >
          Full roster
        </a>
      </div>

      {officers.status === 'error' && (
        <p className="text-faint mb-5 text-sm">
          Couldn't load who currently holds each seat. The board is listed below.
        </p>
      )}

      <ul className={gridClass}>
        {officerSeats.map((seat) => {
          const holder = holderOf.get(seat.position)

          return (
            <li key={seat.position} className="flex">
              <figure className={cardClass}>
                <div className={frameClass}>
                  {officers.status === 'loading' ? (
                    <div className="bg-base-300 h-full w-full animate-pulse" aria-hidden />
                  ) : holder?.photoUrl ? (
                    /* Decorative: the name is printed directly underneath, so
                       announcing the photo too would read the officer out twice.
                       `object-cover` because a letterboxed face in a black frame
                       looks like a mistake — and `object-top` because officers
                       will send whatever their phone took. Cropping a standing
                       photo to a square from the centre lands on the midriff;
                       from the top it lands on the face, which is the one part
                       of the frame that has to survive. */
                    <img
                      src={holder.photoUrl}
                      alt=""
                      className="h-full w-full object-cover object-top"
                    />
                  ) : (
                    /* An empty frame rather than no frame: the hatch is the same
                       "nothing here yet" language the sponsor logos use, and it
                       keeps the caption on the same line as its neighbours'. */
                    <span className="bg-hatch text-faint flex h-full w-full items-center justify-center font-mono text-[9px] font-medium tracking-[0.14em]">
                      [ PHOTO ]
                    </span>
                  )}
                </div>

                <figcaption className="p-4">
                  <div className="text-primary font-mono text-[10px] font-medium tracking-[0.16em] uppercase">
                    {seat.label}
                  </div>

                  {officers.status === 'loading' ? (
                    <div
                      className="bg-base-300 mt-2 h-4 w-28 animate-pulse rounded-[2px]"
                      aria-hidden
                    />
                  ) : holder ? (
                    <div className="mt-1.5 text-base leading-tight font-semibold tracking-[-0.01em]">
                      {holder.fullName}
                    </div>
                  ) : (
                    <div className="text-faint mt-1.5 text-[13px]">
                      {officers.status === 'error' ? '—' : 'Seat open'}
                    </div>
                  )}
                </figcaption>
              </figure>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
