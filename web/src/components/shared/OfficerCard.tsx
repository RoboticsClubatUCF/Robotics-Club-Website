import { ProfileFrame } from './ProfileFrame'
import { imageSrc } from '../../lib/media/storedFiles'

/**
 * One officer, drawn as a card: a headshot in a square frame over a two-line caption of the seat
 * and the name.
 *
 * This was the landing page's officer board until `/officers` wanted the same card for the
 * archive — a component earns `shared/` by being used on two pages. The two are deliberately
 * identical rather than merely similar: somebody who sat on the board in 2019 should look the
 * same as somebody sitting on it now, and two copies of this markup would have drifted the first
 * time one was touched.
 *
 * The design decisions, all of which the board established:
 *
 *   - A ratio rather than a height, so photos at eight different sizes line their captions up and
 *     the grid holds its shape before any of them load.
 *   - Square, not standing. That's what makes it read as a headshot.
 *   - The frame takes the card's full width, so it scales with the card. Capping and centring it
 *     inside a wide card were both tried and looked worse than the thing they fixed.
 *   - The caption is the seat and the name and nothing else. A title printed on whichever cards
 *     happen to have one turns a board into a table of exceptions.
 *   - The photograph is the link, where the officer has given a profile address. The caption
 *     isn't a second link: one card, one destination.
 */

/**
 * The grid the cards sit in — rules are the container's background showing
 * through a 1px gap, not a border per cell. See the strip idiom in
 * `.claude/docs/styling.md`.
 */
export const officerGridClass =
  'bg-rule border-rule grid grid-cols-2 gap-px border wide:grid-cols-4'

const cardClass = 'bg-base-100 flex h-full w-full flex-col'

const frameClass =
  'bg-base-200 flex aspect-square w-full items-center justify-center overflow-hidden'

export function OfficerCard({
  seat,
  name,
  note,
  note2,
  photoUrl,
  profileUrl = null,
  loading = false,
}: {
  /** The seat, in the gold mono line. */
  seat: string
  /** Who held it. Null draws `note` instead. */
  name: string | null
  /**
   * What to print when there is no name — "Seat open" on the board, an em dash
   * when the request failed. Never "Seat open" while the answer is still
   * loading, which is what `loading` is for.
   */
  note?: string
  photoUrl: string | null
  /**
   * Where the photograph points, off the linked account. Null for an empty
   * seat, for a term with nobody behind it, and for every officer who has not
   * given one — which is the common case, so it defaults.
   */
  profileUrl?: string | null
  /**
   * A third line under the name, for the archive's served range.
   *
   * The board deliberately prints nothing here — a field set on some cards and not others turns
   * eight of them into a table of exceptions — and that argument doesn't apply to the archive,
   * where every card has a range and the uniformity is the point.
   */
  note2?: string
  /** Draws a pulse in place of both the photo and the name. */
  loading?: boolean
}) {
  return (
    <figure className={cardClass}>
      {/* Never a link while loading and never one on an empty seat: the first
          has no address yet and the second has nobody to point at. */}
      <ProfileFrame
        profileUrl={loading || name === null ? null : profileUrl}
        name={name ?? ''}
        className={frameClass}
      >
        {loading ? (
          <div className="bg-base-300 h-full w-full animate-pulse" aria-hidden />
        ) : photoUrl ? (
          /* Decorative: the name is printed directly underneath, so announcing the photo too would
             read the officer out twice. `object-cover` because a letterboxed face in a black frame
             looks like a mistake — and `object-top` because officers send whatever their phone
             took, and cropping a standing photo from the centre lands on the midriff. */
          <img
            src={imageSrc(photoUrl)}
            alt=""
            className="h-full w-full object-cover object-top"
          />
        ) : (
          /* An empty frame rather than no frame: the hatch is the same "nothing
             here yet" language the sponsor logos use, and it keeps the caption
             on the same line as its neighbours'. */
          <span className="bg-hatch text-faint flex h-full w-full items-center justify-center font-mono text-[9px] font-medium tracking-[0.14em]">
            [ PHOTO ]
          </span>
        )}
      </ProfileFrame>

      <figcaption className="p-4">
        {/* The board knows its eight seats before the fetch and names them while it waits; the
            archive doesn't know what it holds until the response lands. So an empty seat under
            `loading` gets a bar of its own — without it a loading archive card is visibly a
            different height from a loaded one. */}
        {loading && !seat ? (
          <div
            className="bg-base-300 h-2.5 w-20 animate-pulse rounded-[2px]"
            aria-hidden
          />
        ) : (
          <div className="text-primary font-mono text-[10px] font-medium tracking-[0.16em] uppercase">
            {seat}
          </div>
        )}

        {loading ? (
          <div
            className="bg-base-300 mt-2 h-4 w-28 animate-pulse rounded-[2px]"
            aria-hidden
          />
        ) : name ? (
          <div className="mt-1.5 text-base leading-tight font-semibold tracking-[-0.01em]">
            {name}
          </div>
        ) : (
          <div className="text-faint mt-1.5 text-[13px]">{note}</div>
        )}

        {!loading && note2 && (
          <div className="text-faint mt-1 font-mono text-[10px] font-medium tracking-[0.12em]">
            {note2}
          </div>
        )}
      </figcaption>
    </figure>
  )
}
