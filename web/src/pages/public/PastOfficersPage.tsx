import { useCallback, useEffect, useId, useState } from 'react'
import { FilterChips } from '../../components/shared/FilterChips'
import { OfficerCard, officerGridClass } from '../../components/shared/OfficerCard'
import { FormEyebrow, FormHeading, fieldClass } from '../../components/shared/formChrome'
import { getJson } from '../../lib/api/api'
import type { ApiOfficerArchive, ApiOfficerTerm, OfficerPosition } from '../../lib/api/api'
import {
  ANY,
  filterTerms,
  groupByYear,
  seatLabel,
  servedRange,
  yearsIn,
} from '../../lib/officerTerms'


/**
 * `/officers` — everybody who has run this club, by the year they ran it.
 *
 * The landing page's board answers "who do I talk to"; this answers "who has
 * been here", which is a different question and a much longer list. It draws
 * the *same card* — `shared/OfficerCard`, the board's own — because a past
 * president is an officer of this club and should not look like a database row
 * next to a sitting one.
 *
 * **Searched and filtered in the browser.** The whole archive arrives in one
 * response; see `lib/officerTerms.ts` for why, and for what each control
 * actually narrows. The three compose — a name, a seat and a year — so "every
 * treasurer" and "everyone in 2023–2024" and "Raman" are all one press or one
 * word away from each other.
 *
 * **Grouped by year, and the year is a heading rather than a column.** Two
 * cards for one seat in one year is a resignation mid-term, which the schema
 * allows on purpose; under a heading that reads as two people who both held it
 * that year, which is what happened.
 */

export function PastOfficersPage() {
  const id = useId()

  const [query, setQuery] = useState('')
  const [position, setPosition] = useState<OfficerPosition | typeof ANY>(ANY)
  const [year, setYear] = useState<string>(ANY)

  /**
   * Its own loader rather than `useApi`, which has no refetch — "show the
   * earlier years" is the same request with a wider window, and the page has to
   * be able to make it twice.
   */
  const [archive, setArchive] = useState<ApiOfficerArchive | null>(null)
  const [failed, setFailed] = useState(false)
  const [widening, setWidening] = useState(false)
  const [all, setAll] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    getJson<ApiOfficerArchive>(`/officers/past${all ? '?all=1' : ''}`)
      .then(setArchive)
      .catch((error: unknown) => {
        console.error(error)
        setFailed(true)
      })
      .finally(() => {
        setWidening(false)
      })
  }, [all])

  useEffect(load, [load])

  const terms = archive?.terms ?? []
  const shown = groupByYear(filterTerms(terms, { query, position, year }))

  /**
   * The seats to offer, and the server decides which and in what order.
   *
   * It sends the seats this window actually used, in board order — it can see
   * how `OfficerPosition` is declared and the browser cannot. Same rule as the
   * year chips beside them, and the same reason: a chip that can only ever show
   * an empty page looks broken. It also means the row follows the window —
   * press "show every year" and the seats those years used arrive with them.
   */
  const seatOptions = [
    { value: ANY, label: 'ALL SEATS' },
    ...(archive?.seats ?? []).map((seat) => ({
      value: seat,
      label: seatLabel(seat).toUpperCase(),
    })),
  ]

  // Off the response rather than off a range of numbers: the club has years
  // with no archive behind them, and a chip that can only ever show nothing is
  // a chip that looks broken.
  const yearOptions = [
    { value: ANY, label: 'ALL YEARS' },
    ...yearsIn(terms).map((label) => ({ value: label, label })),
  ]

  return (
    <section className="px-page py-12 wide:py-18">
      <div className="mb-9">
        {/* `/ OFFICERS`, matching the route, with the heading underneath
            saying which officers. The eyebrow said `· PAST` while the page
            lived at `/officers/past`; over a heading that already reads "Past
            Officers" it was the same words twice. */}
        <FormEyebrow>/ OFFICERS</FormEyebrow>
        <FormHeading>Past Officers</FormHeading>
        <p className="text-dim max-w-[34rem] text-sm leading-[1.7] text-pretty">
          Every seat on the board, by the year it was held. The people
          running it today are{' '}
          <a
            href="/#officers"
            className="text-primary border-primary/40 hover:border-primary border-b transition-colors duration-200"
          >
            on the front page
          </a>
          .
        </p>
      </div>

      {!archive && !failed && <ArchiveSkeleton />}

      {failed && (
        <p className="border-rule text-faint border-t py-6.5 text-sm">
          Couldn&rsquo;t load the officer archive just now. Please try again
          later.
        </p>
      )}

      {archive && terms.length === 0 && (
        <p className="border-rule text-faint border-t py-6.5 text-sm">
          No past officers have been recorded yet.
        </p>
      )}

      {archive && terms.length > 0 && (
        <>
          <div className="mb-9 space-y-2.5">
            <div>
              <label htmlFor={`${id}-search`} className="sr-only">
                Search past officers by name
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
              label="SEAT"
              options={seatOptions}
              value={position}
              onChange={setPosition}
            />
            <FilterChips
              label="YEAR"
              options={yearOptions}
              value={year}
              onChange={setYear}
            />
          </div>

          {/* `aria-live`, because on a phone the chip that was pressed and the
              cards it changed are rarely on screen together — the same reason
              the calendar's schedule heading is live. */}
          <p
            className="text-faint mb-5 font-mono text-[10px] font-medium tracking-[0.16em]"
            aria-live="polite"
          >
            {shown.length === 0
              ? 'NO MATCHES'
              : `${countOf(shown)} SHOWN OF ${terms.length}`}
          </p>

          {shown.length === 0 ? (
            <p className="border-rule text-dim border-t py-6.5 text-sm leading-[1.7]">
              Nothing in the archive matches that.
            </p>
          ) : (
            <div className="space-y-9">
              {shown.map((group) => (
                <div key={group.year}>
                  <h2 className="text-faint mb-4 font-mono text-[13px] font-bold tracking-[0.2em]">
                    {group.year}
                  </h2>

                  <ul className={officerGridClass}>
                    {group.terms.map((term) => (
                      <li key={term.id} className="flex">
                        <OfficerCard
                          seat={seatLabel(term.position)}
                          name={term.fullName}
                          // The dates they actually served, under the name. The
                          // board prints nothing here; every card on this page
                          // has one, so it reads as a column rather than as an
                          // exception.
                          note2={servedRange(term.startedAt, term.endedAt)}
                          photoUrl={term.photoUrl}
                          profileUrl={term.profileUrl}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* Only while a window is in force. The page opens on the two most
              recent years the archive holds, because a fifty-year club is a few
              hundred cards and every one of them asks for a headshot — but the
              rest has to be reachable or the archive is a claim it does not
              keep. */}
          {archive.older > 0 && (
            <div className="border-rule mt-9 border-t pt-6 text-center">
              <p className="text-faint mb-3 text-[13px]">
                Showing the two most recent years. {archive.older} earlier{' '}
                {archive.older === 1 ? 'term is' : 'terms are'} on record.
              </p>
              <button
                type="button"
                className="border-rule text-faint hover:text-primary hover:border-primary cursor-pointer border px-4 py-2 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50"
                disabled={widening}
                onClick={() => {
                  setWidening(true)
                  setAll(true)
                }}
              >
                {widening ? 'LOADING…' : 'SHOW EVERY YEAR'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

const countOf = (groups: { terms: ApiOfficerTerm[] }[]): number =>
  groups.reduce((total, group) => total + group.terms.length, 0)

/**
 * One year's worth of empty cards at the real card height, so the page below
 * doesn't jump when the response lands. No controls above it: a search box that
 * cannot search anything yet is worse than one that arrives a moment late.
 */
function ArchiveSkeleton() {
  return (
    <div aria-hidden>
      <div className="bg-base-300 mb-4 h-3.5 w-24 animate-pulse rounded-[2px]" />
      <ul className={officerGridClass}>
        {Array.from({ length: 4 }, (_, index) => (
          <li key={index} className="flex">
            <OfficerCard seat="" name={null} photoUrl={null} loading />
          </li>
        ))}
      </ul>
    </div>
  )
}
