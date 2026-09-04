import { useId, useState } from 'react'
import { FilterChips } from '../../components/shared/FilterChips'
import { ProfileFrame } from '../../components/shared/ProfileFrame'
import { FormEyebrow, FormHeading, fieldClass } from '../../components/shared/formChrome'
import type { ApiMember } from '../../lib/api/api'
import { hits } from '../../lib/equipment/catalogue'
import { imageSrc } from '../../lib/media/storedFiles'
import { useApi } from '../../lib/api/useApi'

/**
 * `/members` — the club, with the whole table one chip away.
 *
 * **The default is the club's active membership**: dues standing and not a
 * guest, the same clause the landing page's ACTIVE MEMBERS cell counts, so the
 * number somebody presses is the list they land on. OFFICER ALUMNI and EVERYONE
 * are the chips beside it.
 *
 * It has been wrong in both directions to get here. A row reached this page
 * only by an officer setting `slug` by hand, and no route on the site ever
 * wrote that column — so a page headed "who is in the club" listed sixty of six
 * hundred and eighty-eight accounts with no way in the product to add the
 * sixty-first. Dropping the slug was right; making the default *everybody,
 * guests included* was the overcorrection. See `activeMembers` in
 * `server/src/routes/public/content.ts`, which is now this page's default and
 * the front page's number both.
 *
 * **A card links where its owner said and nowhere else.** The photograph is an
 * anchor to `profileUrl` — their LinkedIn, their GitHub — and a plain frame for
 * everybody who has not given one, which is most of the page. The *card* still
 * links nowhere: `GET /api/members/:slug` exists and a profile page does not,
 * and a card that opens a 404 is worse than a card that opens nothing (see the
 * note on unbuilt links in `.claude/docs/frontend.md`). Whoever writes
 * `/members/:slug` gets the caption; the face is already spoken for.
 *
 * **ALUMNI means the club's Discord *Officer Alumni* role**, mirrored into
 * `User.officerAlumnus` by the server's ten-minute sweep. It is not `active`,
 * which this chip used to read: `active` is "still around" and every dues
 * payment sets it back to true, so it could never mean "used to run the club",
 * and somebody can be both. Nothing on this site sets it — the club marks its
 * alumni in Discord and the site follows.
 *
 * **The first two chips overlap and that is deliberate.** A past president who
 * still pays dues is on both lists. They used to negate each other to stay
 * disjoint, which had the effect that paying dues could not put somebody on the
 * list of people who pay dues.
 *
 * **The status refetches; the search box narrows what arrived.** The three
 * chips are different sets of rows — a guest who once ran the club is under
 * ALUMNI and under nothing else — so that one is `?status=`, and changing it
 * changes the path `useApi` keys its effect on. The search filters in the
 * browser for the reason `lib/equipment/catalogue.ts` gives: a club roster is a
 * list too long to *scan*, not one too long to send.
 *
 * **Nothing on this page lives in the address bar.** A `?subteam=` did — the
 * club had standing divisions a member belonged to all year, `/about` printed a
 * count per division and linked straight here, so the link had to arrive
 * already narrowed. The club does not group people that way any more; a team is
 * a working group inside one project and lives on that project's page. The
 * search box was never in the URL and still is not: it is typed, not chosen,
 * and a query string that changed on every keystroke would be a history entry
 * per character.
 */

/**
 * The server's own ceiling for this route, and asking for all of it in one go
 * is what makes the search box below possible at all — you cannot search a page
 * you were not sent. A thousand rows of names and bios is a few hundred
 * kilobytes, cached at the edge.
 *
 * Past a thousand this becomes pagination *and* a server-side search, together;
 * either one alone gives you a search box that quietly misses people. The route
 * comment in `content.ts` says the same thing from the other side.
 */
const LIMIT = 1000

type RosterStatus = 'active' | 'alumni' | 'all'

/**
 * The `?status=` values are the server's; the labels are this page's and have
 * both moved since. `alumni` means the club's Discord Officer Alumni role and
 * the archive rather than `active: false`, and the chip says which — "ALUMNI"
 * on a club roster reads as "everyone who has graduated", which is not what
 * this is. `active` says ACTIVE MEMBERS in the front page's own words, because
 * it is now the front page's own number.
 */
const statusOptions = [
  { value: 'active' as const, label: 'ACTIVE MEMBERS' },
  { value: 'alumni' as const, label: 'OFFICER ALUMNI' },
  { value: 'all' as const, label: 'EVERYONE' },
]

/**
 * The strip idiom — rules are the container's background showing through a 1px
 * gap, not a border per cell. Written here rather than borrowed from
 * `OfficerCard`: the board's grid belongs to the board, and a roster that
 * quietly changed shape because somebody adjusted the officer cards would be a
 * surprise in the wrong file.
 */
const gridClass =
  'bg-rule border-rule grid grid-cols-2 gap-px border wide:grid-cols-4'

export function MembersPage() {
  const id = useId()

  const [status, setStatus] = useState<RosterStatus>('active')
  const [query, setQuery] = useState('')

  const roster = useApi<ApiMember[]>(`/members?status=${status}&limit=${LIMIT}`)

  const members = roster.status === 'ready' ? roster.data : []

  const shown = members.filter((member) =>
    hits([member.fullName, member.title, member.bio], query),
  )

  return (
    <section className="px-page py-12 wide:py-18">
      <div className="mb-9">
        <FormEyebrow>/ MEMBERS</FormEyebrow>
        <FormHeading>Who is in the club.</FormHeading>
        <p className="text-dim max-w-[34rem] text-sm leading-[1.7] text-pretty">
          The club&rsquo;s paid-up membership. The officers who ran it before
          them, and everybody who has ever signed up, are a chip away; the board
          sitting today is{' '}
          <a
            href="/#officers"
            className="text-primary border-primary/40 hover:border-primary border-b transition-colors duration-200"
          >
            on the front page
          </a>
          .
        </p>
      </div>

      {roster.status === 'loading' && <RosterSkeleton />}

      {roster.status === 'error' && (
        <p className="border-rule text-faint border-t py-6.5 text-sm">
          Couldn&rsquo;t load the roster just now. Please try again later.
        </p>
      )}

      {roster.status === 'ready' && (
        <>
          <div className="mb-9 space-y-2.5">
            <div>
              <label htmlFor={`${id}-search`} className="sr-only">
                Search members by name
              </label>
              <input
                id={`${id}-search`}
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                }}
                placeholder="Search by name…"
                className={`${fieldClass} max-w-[22rem]`}
              />
            </div>

            <FilterChips
              label="SHOWING"
              options={statusOptions}
              value={status}
              onChange={setStatus}
            />
          </div>

          {members.length === 0 ? (
            <p className="border-rule text-faint border-t py-6.5 text-sm">
              {/* One per chip. "Nobody has an account yet" under ACTIVE MEMBERS
                  would be a claim about the table made by a filtered query, and
                  a club with three hundred signups and nobody paid up is a real
                  state — the start of a term. */}
              {status === 'alumni'
                ? 'No officer alumni are listed yet.'
                : status === 'active'
                  ? 'No active members yet.'
                  : 'Nobody has an account yet.'}
            </p>
          ) : (
            <>
              {/* `aria-live` for the reason the archive's count is: on a phone
                  the chip that was pressed and the cards it changed are rarely
                  on screen together. */}
              <p
                className="text-faint mb-5 font-mono text-[10px] font-medium tracking-[0.16em]"
                aria-live="polite"
              >
                {shown.length === 0
                  ? 'NO MATCHES'
                  : `${shown.length} SHOWN OF ${members.length}`}
              </p>

              {shown.length === 0 ? (
                <p className="border-rule text-dim border-t py-6.5 text-sm leading-[1.7]">
                  Nobody matches that.
                </p>
              ) : (
                <ul className={gridClass}>
                  {shown.map((member) => (
                    <li key={member.id} className="flex">
                      <MemberCard
                        member={member}
                        /* Everywhere except the chip that already said it.
                           Under OFFICER ALUMNI every card is one, so the badge
                           would be noise; under ACTIVE MEMBERS some are and
                           some are not, which is exactly when it earns its
                           place — that chip stopped excluding them. */
                        markAlumni={status !== 'alumni'}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}

/**
 * One person on the roster.
 *
 * The frame is the officer card's — square, `object-top`, a hatch where there is
 * no photograph — because a member and an officer of the same club should not be
 * drawn to two different standards. What sits under it is different on purpose.
 * The board prints a seat and a name and nothing else, and this page has no
 * seats; it has a title only some people carry, an alumni badge only some cards
 * earn and a graduation year that may be null. Those are a chip and a line
 * rather than fixed caption rows, because an absent chip reads as absent while
 * an empty row reads as a mistake.
 */
function MemberCard({
  member,
  markAlumni,
}: {
  member: ApiMember
  markAlumni: boolean
}) {
  // `officerAlumnus`, never `!active`. They are different facts and the second
  // is set back to true by every dues payment — see `ApiMember`.
  const alumnus = markAlumni && member.officerAlumnus

  return (
    <figure className="bg-base-100 flex h-full w-full flex-col">
      <ProfileFrame
        profileUrl={member.profileUrl}
        name={member.fullName}
        className="bg-base-200 flex aspect-square w-full items-center justify-center overflow-hidden"
      >
        {member.photoUrl ? (
          /* Decorative: the name is printed directly underneath, so announcing
             the photo too reads the person out twice. Through `imageSrc`,
             because an upload's address is root-relative and the API is another
             origin — see `lib/media/storedFiles.ts`. */
          <img
            src={imageSrc(member.photoUrl)}
            alt=""
            /* The list is the whole club now rather than the handful with a
               slug, so the cards below the fold are worth not fetching. Most
               rows have no photograph at all and draw the hatch instead. */
            loading="lazy"
            className="h-full w-full object-cover object-top"
          />
        ) : (
          <span className="bg-hatch text-faint flex h-full w-full items-center justify-center font-mono text-[9px] font-medium tracking-[0.14em]">
            [ PHOTO ]
          </span>
        )}
      </ProfileFrame>

      <figcaption className="flex flex-1 flex-col p-4">
        <div className="text-base leading-tight font-semibold tracking-[-0.01em]">
          {member.fullName}
        </div>

        {member.title && (
          <div className="text-dim mt-1.5 text-[13px] leading-snug">
            {member.title}
          </div>
        )}

        {/* Drawn only if the badge is. An empty flex row would still cost its
            top margin, which is a gap under the title on exactly the cards that
            had the least to say. It held a second chip — the member's standing
            division — until the club stopped having those, and it stays a row
            rather than a bare span because a card carrying one badge and a card
            carrying two should not be laid out by two different rules. */}
        {alumnus && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-faint border-rule border px-2 py-0.5 font-mono text-[9px] font-medium tracking-[0.14em]">
              OFFICER ALUMNI
            </span>
          </div>
        )}

        {member.bio && (
          <p className="text-dim mt-3 line-clamp-3 text-[13px] leading-[1.55] text-pretty">
            {member.bio}
          </p>
        )}

        {/* Pushed to the bottom of whatever height the grid gave the card, so
            the years line up across a row instead of floating under bios of
            three different lengths. */}
        {member.gradYear !== null && (
          <div className="text-faint mt-auto pt-3 font-mono text-[10px] font-medium tracking-[0.14em]">
            CLASS OF {member.gradYear}
          </div>
        )}
      </figcaption>
    </figure>
  )
}

/**
 * A row of empty cards at the real card height, so the page below doesn't jump
 * when the response lands. No controls above it: a search box that cannot search
 * anything yet is worse than one that arrives a moment late.
 */
function RosterSkeleton() {
  return (
    <div aria-hidden>
      <ul className={gridClass}>
        {Array.from({ length: 4 }, (_, index) => (
          <li key={index} className="flex">
            <div className="bg-base-100 flex h-full w-full flex-col">
              <div className="bg-base-300 aspect-square w-full animate-pulse" />
              <div className="p-4">
                <div className="bg-base-300 h-4 w-28 animate-pulse rounded-[2px]" />
                <div className="bg-base-300 mt-2.5 h-2.5 w-20 animate-pulse rounded-[2px]" />
                <div className="bg-base-300 mt-4 h-3.5 w-16 animate-pulse rounded-[2px]" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
