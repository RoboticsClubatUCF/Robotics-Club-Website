import { useId, useState } from 'react'
import { useSearchParams } from 'react-router'
import { FilterChips } from '../../components/shared/FilterChips'
import { FormEyebrow, FormHeading, fieldClass } from '../../components/shared/formChrome'
import type { ApiMember } from '../../lib/api/api'
import { hits } from '../../lib/equipment/catalogue'
import { imageSrc } from '../../lib/media/storedFiles'
import { useApi } from '../../lib/api/useApi'

/**
 * `/members` — everybody with an account.
 *
 * **This is not a list of who has paid, and the lede says so.** It is every
 * account the club has: members, officers, and people who signed up and have
 * gone no further. The landing page's ACTIVE MEMBERS cell is the number that
 * means paid-up standing, and it is a fraction of what is drawn here.
 *
 * It used to be the reverse problem. A row reached this page only by an officer
 * setting `slug` by hand, and no route on the site ever wrote that column — so
 * a page headed "who is in the club" listed sixty of six hundred and eighty-eight
 * accounts with no way in the product to add the sixty-first. See `activeMembers`
 * in `server/src/routes/public/content.ts` for what the filter was.
 *
 * **The cards do not link anywhere.** `GET /api/members/:slug` exists and a
 * profile page does not, and a card that opens a 404 is worse than a card that
 * opens nothing — see the note on unbuilt links in `.claude/docs/frontend.md`.
 * Whoever writes `/members/:slug` turns the card into the link.
 *
 * **ALUMNI means the club's Discord *Officer Alumni* role**, mirrored into
 * `User.officerAlumnus` by the server's ten-minute sweep. It is not `active`,
 * which this chip used to read: `active` is "still around" and every dues
 * payment sets it back to true, so it could never mean "used to run the club",
 * and somebody can be both. Nothing on this site sets it — the club marks its
 * alumni in Discord and the site follows.
 *
 * **Status refetches; the other two controls narrow what arrived.** Current
 * people and officer alumni are different rows, so that one is `?status=`, and
 * changing it changes the path `useApi` keys its effect on. Subteam and the search box filter in the browser
 * for the reason `lib/equipment/catalogue.ts` gives: a club roster is a list too long to
 * *scan*, not one too long to send.
 *
 * **The subteam lives in the address bar, and it is the only control that
 * does.** `/about` prints a member count per subteam and links it here, so that
 * link has to arrive already narrowed or the number a reader just read is not
 * the list they land on. Making it the URL rather than seeding state from it
 * also makes it shareable and survives a reload, and `replace` keeps a row of
 * chip presses out of the back button. The search box deliberately stays out of
 * the URL: it is typed, not chosen, and a query string that changed on every
 * keystroke would be a history entry per character.
 */

/**
 * The server's own ceiling for this route, and asking for all of it in one go
 * is what makes the two client-side filters below possible at all — you cannot
 * search a page you were not sent. A thousand rows of names and bios is a few
 * hundred kilobytes, cached at the edge.
 *
 * Past a thousand this becomes pagination *and* a server-side search, together;
 * either one alone gives you a search box that quietly misses people. The route
 * comment in `content.ts` says the same thing from the other side.
 */
const LIMIT = 1000

/** "Don't narrow by this". A subteam slug can never collide with it. */
const ANY = 'ALL' as const

type RosterStatus = 'active' | 'alumni' | 'all'

/**
 * The `?status=` values are the server's and are unchanged; only the middle
 * label moved. `alumni` now means the club's Discord Officer Alumni role rather
 * than `active: false`, and the chip says which — "ALUMNI" on a club roster
 * reads as "everyone who has graduated", which is not what this is.
 */
const statusOptions = [
  { value: 'active' as const, label: 'CURRENT' },
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
  const [params, setParams] = useSearchParams()

  const roster = useApi<ApiMember[]>(`/members?status=${status}&limit=${LIMIT}`)

  const members = roster.status === 'ready' ? roster.data : []

  /**
   * The subteams to offer, taken off the response rather than off
   * `GET /subteams`.
   *
   * It saves a request, and — the half that matters — it can only ever offer a
   * chip with somebody behind it. A club carrying a Business subteam nobody has
   * joined would otherwise get a chip that shows an empty page, which reads as
   * broken. Same rule as the officer archive's year chips. A `Map` keyed on the
   * slug is what dedupes them, and it keeps the order the server sent.
   */
  const subteamOptions = [
    { value: ANY, label: 'ALL SUBTEAMS' },
    ...[
      ...new Map(
        members.flatMap((member) =>
          member.subteam
            ? [[member.subteam.slug, member.subteam.name] as const]
            : [],
        ),
      ),
    ].map(([slug, name]) => ({ value: slug, label: name.toUpperCase() })),
  ]

  /**
   * The URL's subteam, but only if it is one somebody is actually in.
   *
   * A hand-typed or stale slug would otherwise narrow the roster to nothing and
   * leave every chip unpressed — a page that looks broken, in answer to a link
   * that merely went out of date. Falling back to the whole roster is the
   * failure worth having. Checked against the options rather than against the
   * members so it is also false while the request is still in flight, which is
   * when `subteamOptions` holds only ALL.
   */
  const wanted = params.get('subteam') ?? ANY
  const subteam = subteamOptions.some((option) => option.value === wanted)
    ? wanted
    : ANY

  const setSubteam = (slug: string) => {
    // `replace`, so pressing four chips in a row does not put four entries in
    // the back button between the reader and the page they came from.
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (slug === ANY) next.delete('subteam')
        else next.set('subteam', slug)
        return next
      },
      { replace: true },
    )
  }

  const shown = members.filter(
    (member) =>
      (subteam === ANY || member.subteam?.slug === subteam) &&
      hits([member.fullName, member.title, member.bio, member.subteam?.name], query),
  )

  return (
    <section className="px-page py-12 wide:py-18">
      <div className="mb-9">
        <FormEyebrow>/ MEMBERS</FormEyebrow>
        <FormHeading>Who is in the club.</FormHeading>
        <p className="text-dim max-w-[34rem] text-sm leading-[1.7] text-pretty">
          Everyone with an account on the club&rsquo;s site &mdash; paid-up
          members, officers, and people who have just signed up &mdash; along
          with the officers who ran it before them. The board sitting today is{' '}
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

            {/* Only once there is more than one subteam to choose between. A
                row of chips offering the single answer everybody already has
                narrows nothing. */}
            {subteamOptions.length > 2 && (
              <FilterChips
                label="SUBTEAM"
                options={subteamOptions}
                value={subteam}
                onChange={setSubteam}
              />
            )}
          </div>

          {members.length === 0 ? (
            <p className="border-rule text-faint border-t py-6.5 text-sm">
              {status === 'alumni'
                ? 'No officer alumni are listed yet.'
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
                        /* Only where the list is mixed. Under CURRENT no card
                           is an officer alumnus and under OFFICER ALUMNI every
                           one is, so a badge in either case says nothing the
                           chip above has not already said. */
                        markAlumni={status === 'all'}
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
 * seats; it has a title only some people carry, a subteam that may be null and a
 * graduation year that may be null. Those are a chip and a line rather than
 * fixed caption rows, because an absent chip reads as absent while an empty row
 * reads as a mistake.
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
      <div className="bg-base-200 flex aspect-square w-full items-center justify-center overflow-hidden">
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
      </div>

      <figcaption className="flex flex-1 flex-col p-4">
        <div className="text-base leading-tight font-semibold tracking-[-0.01em]">
          {member.fullName}
        </div>

        {member.title && (
          <div className="text-dim mt-1.5 text-[13px] leading-snug">
            {member.title}
          </div>
        )}

        {/* The row is drawn only if something goes in it. An empty flex row
            would still cost its top margin, which is a gap under the title on
            exactly the cards that had the least to say. */}
        {(member.subteam !== null || alumnus) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {member.subteam && (
              <span
                className="border-rule border px-2 py-0.5 font-mono text-[9px] font-medium tracking-[0.14em] uppercase"
                /* The subteam's own colour, out of the database. That is data
                   rather than a theme token, which is the one thing that makes
                   an inline colour right here — `.claude/docs/styling.md` bans
                   the literal, not the column. `currentColor` on the border so
                   the two can never disagree; a subteam nobody has given a
                   colour keeps the faint rule it inherits. */
                style={
                  member.subteam.color
                    ? { color: member.subteam.color, borderColor: 'currentColor' }
                    : undefined
                }
              >
                {member.subteam.name}
              </span>
            )}

            {alumnus && (
              <span className="text-faint border-rule border px-2 py-0.5 font-mono text-[9px] font-medium tracking-[0.14em]">
                OFFICER ALUMNI
              </span>
            )}
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
