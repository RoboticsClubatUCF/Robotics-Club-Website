import { Link } from 'react-router'
import {
  FormEyebrow,
  FormHeading,
  secondaryClass,
} from '../../components/shared/formChrome'
import { founded, lab, lede, milestones, story } from '../../content/about'
import { socialLinks } from '../../content/home'
import type { ApiSubteam } from '../../lib/api/api'
import { useApi } from '../../lib/api/useApi'

/**
 * `/about` — what the club is, for somebody who has not decided yet.
 *
 * The stat strip's "ESTABLISHED 1972" cell points here, which sets what the page
 * has to answer: who these people are, what they actually do all week, and where
 * to find them. Joining is the front page's job and the FAQ's; this page ends
 * with the link and does not repeat the argument.
 *
 * **The subteams are live and the history is not.** `GET /api/subteams` is a
 * real answer to "what do you do" — the standing groups, with a count that
 * matches the roster — and it costs one request. The story and the milestones
 * are placeholders in `content/about.ts`, and the page says so in the open
 * rather than shipping invented history under the club's name: a made-up
 * milestone is the kind of thing that gets quoted back at a sponsor meeting.
 *
 * **Nothing here prints the lab's hours.** The building's 8am–10pm rule lives on
 * the server and `lib/lab/lab.ts` holds the words for the officer panel that is
 * *itself* the promise — a public page saying "open at eight" commits an officer
 * who may not be coming until noon. The lab sign on the front page answers "is
 * it open right now", which is the question this page can honestly forward.
 */
export function AboutPage() {
  const subteams = useApi<ApiSubteam[]>('/subteams')

  return (
    <>
      <section className="px-page py-12 wide:py-18">
        <div className="max-w-[42rem]">
          <FormEyebrow>/ ABOUT</FormEyebrow>
          <FormHeading>Building robots at UCF since {founded}.</FormHeading>
          <p className="text-dim text-base leading-[1.75] text-pretty">{lede}</p>
        </div>
      </section>

      <section className="border-rule px-page border-t py-12 wide:py-18">
        <div className="mb-9">
          <h2 className="text-faint mb-5 font-mono text-[13px] font-bold tracking-[0.2em]">
            / WHAT WE DO
          </h2>
          <p className="text-dim max-w-[42rem] text-sm leading-[1.7] text-pretty">
            The club is organised two ways at once, and both matter. A{' '}
            <strong className="font-semibold text-base-content">subteam</strong> is what
            you do — the skill you turn up with or want to learn. A{' '}
            <Link
              to="/projects"
              className="text-primary border-primary/40 hover:border-primary border-b transition-colors duration-200"
            >
              project
            </Link>{' '}
            is what you build, and most projects need every subteam at once.
          </p>
        </div>

        {subteams.status === 'loading' && <SubteamsSkeleton />}

        {subteams.status === 'error' && (
          <p className="border-rule text-faint border-t py-6.5 text-sm">
            Couldn&rsquo;t load the subteams just now. Please try again later.
          </p>
        )}

        {subteams.status === 'ready' &&
          (subteams.data.length === 0 ? (
            <p className="border-rule text-faint border-t py-6.5 text-sm">
              No subteams are listed yet.
            </p>
          ) : (
            <ul className="bg-rule border-rule grid gap-px border wide:grid-cols-3">
              {subteams.data.map((subteam) => (
                <li key={subteam.id} className="bg-base-100 flex flex-col p-5">
                  <div className="flex items-baseline justify-between gap-4">
                    <h3
                      className="font-mono text-[11px] font-medium tracking-[0.16em] uppercase"
                      /* The subteam's own colour, out of the database — data
                         rather than a theme token, which is what makes an
                         inline colour right here. One without a colour falls
                         back to the gold every other eyebrow on the site
                         uses. */
                      style={
                        subteam.color ? { color: subteam.color } : undefined
                      }
                    >
                      {subteam.name}
                    </h3>
                    {/* The count is of the *active roster*, which is the same
                        set `/members` shows — so a reader who follows the link
                        finds the number they just read. */}
                    <Link
                      to={`/members?subteam=${subteam.slug}`}
                      className="text-faint hover:text-primary font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200"
                    >
                      {subteam.memberCount}{' '}
                      {subteam.memberCount === 1 ? 'MEMBER' : 'MEMBERS'}
                    </Link>
                  </div>

                  {subteam.description && (
                    <p className="text-dim mt-3 text-[13px] leading-[1.55] text-pretty">
                      {subteam.description}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ))}
      </section>

      <section className="border-rule px-page border-t py-12 wide:py-18">
        <div className="mb-9">
          <h2 className="text-faint mb-5 font-mono text-[13px] font-bold tracking-[0.2em]">
            / THE STORY
          </h2>
          {/* Said on the page, not only in the source. A visitor reading
              invented history under the club's name is the failure this page
              could actually cause, so the placeholder announces itself. */}
          <p className="border-primary/35 bg-primary/5 text-dim max-w-[42rem] border p-4 text-[13px] leading-[1.6] text-pretty">
            The history below is placeholder text. The club is genuinely from{' '}
            {founded}; the rest is waiting on somebody who was there to write it.
          </p>
        </div>

        <div className="max-w-[42rem] space-y-5">
          {story.map((paragraph) => (
            <p key={paragraph} className="text-dim text-sm leading-[1.75] text-pretty">
              {paragraph}
            </p>
          ))}
        </div>

        {/* Rules-and-columns rather than cards, the way the project list is
            drawn: what somebody does with a timeline is read down the year
            column, and cards make that a scavenger hunt. */}
        <div className="mt-9 max-w-[42rem]">
          {milestones.map((milestone) => (
            <div
              key={milestone.what}
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
      </section>

      <section className="border-rule px-page border-t py-12 wide:py-18">
        <div className="mb-9">
          <h2 className="text-faint mb-5 font-mono text-[13px] font-bold tracking-[0.2em]">
            / WHERE TO FIND US
          </h2>
        </div>

        <div className="bg-rule border-rule grid gap-px border wide:grid-cols-2">
          <div className="bg-base-100 p-5">
            <div className="text-faint font-mono text-[10px] font-medium tracking-[0.16em]">
              THE LAB
            </div>
            {/* An address, so it is marked up as one. `<address>` is inherited
                italic in every browser default sheet, which is why the class
                turns it off. */}
            <address className="mt-3 text-sm leading-[1.7] not-italic">
              {lab.building}
              <br />
              {lab.street}
              <br />
              {lab.city}
            </address>
            <a
              href={lab.mapUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary border-primary/40 hover:border-primary mt-4 inline-block border-b pb-0.5 text-xs font-medium transition-colors duration-200"
            >
              Open in Maps
            </a>
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

          <div className="bg-base-100 p-5">
            <div className="text-faint font-mono text-[10px] font-medium tracking-[0.16em]">
              ONLINE
            </div>
            <p className="text-dim mt-3 text-sm leading-[1.7] text-pretty">
              Discord is where the club actually talks — meeting times, build
              threads and the lab sign all land there first.
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

/** Cards at the real height, so the sections below don't jump when the response
    lands. Three, because the club has had five subteams for as long as the seed
    has and a row is the honest guess. */
function SubteamsSkeleton() {
  return (
    <ul className="bg-rule border-rule grid gap-px border wide:grid-cols-3" aria-hidden>
      {Array.from({ length: 3 }, (_, index) => (
        <li key={index} className="bg-base-100 p-5">
          <div className="bg-base-300 h-3 w-24 animate-pulse rounded-[2px]" />
          <div className="bg-base-300 mt-4 h-2.5 w-full animate-pulse rounded-[2px]" />
          <div className="bg-base-300 mt-2 h-2.5 w-4/5 animate-pulse rounded-[2px]" />
        </li>
      ))}
    </ul>
  )
}
