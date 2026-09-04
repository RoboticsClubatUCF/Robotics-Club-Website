import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { AboutEditor } from '../../components/about/AboutEditor'
import {
  FormEyebrow,
  FormHeading,
  secondaryClass,
} from '../../components/shared/formChrome'
import { socialLinks } from '../../content/home'
import { ApiError, getJson } from '../../lib/api/api'
import type { ApiAboutPage } from '../../lib/api/api'
import { isOfficer, useSession } from '../../lib/auth/session'

/**
 * `/about` — what the club is, for somebody who has not decided yet.
 *
 * The stat strip's "ESTABLISHED 1972" cell points here, which sets what the page
 * has to answer: who these people are, what they actually do all week, and where
 * to find them. Joining is the front page's job and the FAQ's; this page ends
 * with the link and does not repeat the argument.
 *
 * **Every word of it is the club's now, and officers write it here.** The
 * history was placeholder prose in `src/content/about.ts` under a panel
 * admitting as much — honest, and a dead end, because the only way to retire the
 * admission was a deploy and the person who was there in 1972 is not a
 * developer. The panel is `storyNotice` now: a field they empty when the story
 * below it is real. The whole page is one row and one short table behind
 * `GET /api/about`, and an officer gets an EDIT button on the page itself rather
 * than a desk somewhere else — see `AboutEditor`.
 *
 * **The club's divisions are gone from this page**, and then from the club.
 * They were the live half of it, fetched from `GET /api/subteams` and drawn
 * under / WHAT WE DO, and the section was doing two jobs badly: introducing an
 * org chart to somebody who has not joined, and duplicating a filter `/members`
 * already offered. The route and the table went afterwards; a team is a working
 * group inside one project now and there is no club-wide grouping to print. The
 * page is shorter and the club's own words are what is left.
 *
 * **Nothing here prints the lab's hours.** The building's 8am–10pm rule lives on
 * the server and `lib/lab/lab.ts` holds the words for the officer panel that is
 * *itself* the promise — a public page saying "open at eight" commits an officer
 * who may not be coming until noon. The lab sign on the front page answers "is
 * it open right now", which is the question this page can honestly forward.
 */
export function AboutPage() {
  const { session } = useSession()
  const officer =
    session.status === 'signed-in' && isOfficer(session.user.role)

  const [page, setPage] = useState<ApiAboutPage | null>(null)
  const [loadError, setLoadError] = useState('')
  const [editing, setEditing] = useState(false)

  /**
   * Read fresh **for officers only**, and read again when the session lands.
   *
   * The public route is `s-maxage=300` like the rest of the club's content,
   * which is right for a visitor and wrong for the person about to edit it: an
   * officer handed a five-minute-old page would save a five-minute-old page over
   * whatever the last one wrote. Everybody else gets the cached answer, because
   * the alternative is giving up the cache on a public page to serve the two
   * people who can write it.
   *
   * The effect re-runs when `officer` flips, which is the session arriving —
   * hence one extra request for an officer and none for anyone else. `page` is
   * deliberately not cleared on the way in, so that refetch is invisible rather
   * than a page that blinks back to "Loading…" a moment after it appeared.
   */
  const load = useCallback(
    (signal?: AbortSignal) =>
      getJson<ApiAboutPage>('/about', signal, officer)
        .then((data) => {
          setPage(data)
          setLoadError('')
        })
        .catch((error: unknown) => {
          if (signal?.aborted) return
          console.error(error)
          setLoadError(
            error instanceof ApiError && error.status === 0
              ? "We couldn't reach the server."
              : "We couldn't load this page.",
          )
        }),
    [officer],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => {
      controller.abort()
    }
  }, [load])

  if (page && editing) {
    return (
      <AboutEditor
        page={page}
        onSaved={(saved) => {
          setPage(saved)
          setEditing(false)
        }}
        onCancel={() => {
          setEditing(false)
        }}
      />
    )
  }

  if (!page) {
    return (
      <section className="px-page py-12 wide:py-18">
        <div className="max-w-[42rem]" aria-busy={loadError === ''}>
          <FormEyebrow>/ ABOUT</FormEyebrow>
          <FormHeading>
            {loadError === '' ? 'Loading…' : "This page didn't load."}
          </FormHeading>
          {loadError !== '' && (
            <p className="text-dim text-base leading-[1.75] text-pretty">
              {loadError} Try again in a moment.
            </p>
          )}
        </div>
      </section>
    )
  }

  const address =
    page.labBuilding ?? page.labStreet ?? page.labCity ?? page.labMapUrl

  return (
    <>
      <section className="px-page py-12 wide:py-18">
        {/* Beside the eyebrow rather than beside the heading, and in the same
            quiet mono the rest of the page's chrome is set in. The heading
            clamps from 1.6rem to 2.25rem, so a control next to *that* either
            collides with it or leaves a hole at one end of the range — and this
            is a door for two people rather than an invitation to the reader. */}
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <FormEyebrow>/ ABOUT</FormEyebrow>
          {officer && (
            <button
              type="button"
              onClick={() => {
                setEditing(true)
              }}
              className="text-faint hover:text-primary -my-2 cursor-pointer py-2 font-mono text-[10px] font-medium tracking-[0.16em] transition-colors duration-200"
            >
              EDIT THIS PAGE
            </button>
          )}
        </div>

        <div className="max-w-[42rem]">
          <FormHeading>{page.heading}</FormHeading>
          <p className="text-dim text-base leading-[1.75] text-pretty">
            {page.lede}
          </p>
        </div>
      </section>

      <section className="border-rule px-page border-t py-12 wide:py-18">
        <div className="mb-9">
          <h2 className="text-faint mb-5 font-mono text-[13px] font-bold tracking-[0.2em]">
            / THE STORY
          </h2>
          {/* Said on the page, not only in the source — a visitor reading
              invented history under the club's name is the failure this page
              could actually cause. It is a field rather than a fixture, so the
              club retires it by writing the history rather than by asking
              somebody to ship a change. */}
          {page.storyNotice && (
            <p className="border-primary/35 bg-primary/5 text-dim max-w-[42rem] border p-4 text-[13px] leading-[1.6] text-pretty">
              {page.storyNotice}
            </p>
          )}
        </div>

        <div className="max-w-[42rem] space-y-5">
          {page.story.map((paragraph) => (
            <p
              key={paragraph}
              className="text-dim text-sm leading-[1.75] text-pretty"
            >
              {paragraph}
            </p>
          ))}
        </div>

        {/* Rules-and-columns rather than cards, the way the project list is
            drawn: what somebody does with a timeline is read down the year
            column, and cards make that a scavenger hunt. An empty timeline
            prints nothing at all rather than an empty rule. */}
        {page.milestones.length > 0 && (
          <div className="mt-9 max-w-[42rem]">
            {page.milestones.map((milestone) => (
              <div
                key={milestone.id}
                className="border-rule grid grid-cols-[4.5rem_1fr] items-start gap-3 border-t py-4 wide:grid-cols-[7rem_1fr] wide:gap-6"
              >
                <div className="text-primary pt-0.5 font-mono text-[11px] font-medium tracking-[0.06em]">
                  {milestone.when}
                </div>
                <p className="text-dim text-sm leading-[1.6] text-pretty">
                  {milestone.what}
                </p>
              </div>
            ))}
            <div className="border-rule border-t" />
          </div>
        )}
      </section>

      <section className="border-rule px-page border-t py-12 wide:py-18">
        <div className="mb-9">
          <h2 className="text-faint mb-5 font-mono text-[13px] font-bold tracking-[0.2em]">
            / WHERE TO FIND US
          </h2>
        </div>

        {/* One column when there is no address, so the ONLINE panel does not sit
            beside a gap. A club between homes is a real state and the editor
            says so. */}
        <div
          className={`bg-rule border-rule grid gap-px border ${
            address === null ? '' : 'wide:grid-cols-2'
          }`}
        >
          {address !== null && (
            <div className="bg-base-100 p-5">
              <div className="text-faint font-mono text-[10px] font-medium tracking-[0.16em]">
                THE LAB
              </div>
              {/* An address, so it is marked up as one. `<address>` is inherited
                  italic in every browser default sheet, which is why the class
                  turns it off. */}
              <address className="mt-3 text-sm leading-[1.7] not-italic">
                {page.labBuilding && (
                  <>
                    {page.labBuilding}
                    <br />
                  </>
                )}
                {page.labStreet && (
                  <>
                    {page.labStreet}
                    <br />
                  </>
                )}
                {page.labCity}
              </address>
              {page.labMapUrl && (
                <a
                  href={page.labMapUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary border-primary/40 hover:border-primary mt-4 inline-block border-b pb-0.5 text-xs font-medium transition-colors duration-200"
                >
                  Open in Maps
                </a>
              )}
              {/* Forwarded rather than answered. Whether the lab is staffed right
                  now is the sign's job, and it is the one thing on this site that
                  keeps asking. */}
              <p className="text-faint mt-4 text-[13px] leading-[1.6]">
                The{' '}
                <Link
                  to="/"
                  className="text-primary border-primary/40 hover:border-primary border-b transition-colors duration-200"
                >
                  front page
                </Link>{' '}
                says whether it is open right now.
              </p>
            </div>
          )}

          <div className="bg-base-100 p-5">
            <div className="text-faint font-mono text-[10px] font-medium tracking-[0.16em]">
              ONLINE
            </div>
            <p className="text-dim mt-3 text-sm leading-[1.7] text-pretty">
              {page.onlineBlurb}
            </p>
            <ul className="mt-4 flex flex-wrap gap-x-5.5 gap-y-1">
              {socialLinks.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    /* These leave the site, so they leave the tab too — the
                       footer's rule, and the same `noopener` reason. */
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-faint hover:text-primary -my-2 flex min-h-9 items-center py-2 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-9 flex flex-wrap items-center gap-3.5">
          <Link
            to="/join"
            className="btn btn-primary btn-cta px-7 py-[15px] text-[13px] font-semibold"
          >
            JOIN THE CLUB
          </Link>
          <Link to="/projects" className={secondaryClass}>
            See what we&rsquo;re building
          </Link>
        </div>
      </section>
    </>
  )
}
