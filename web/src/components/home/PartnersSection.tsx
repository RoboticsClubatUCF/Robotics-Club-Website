import type { ApiFrontPage } from '../../lib/api/api'
import type { ApiState } from '../../lib/api/useApi'
import { imageSrc } from '../../lib/media/storedFiles'

/**
 * The programs somebody can take part in when they cannot join the club.
 *
 * Membership is for currently enrolled UCF students and the signup will not
 * bend on it — a working `@ucf.edu` address is the whole of step one. Until
 * now that left everybody else reading a page about robotics with nothing on
 * it they could do, which is what this section answers: the programs the club
 * is involved with that are open to people it cannot sign up itself. The join
 * page links straight here for exactly that reason.
 *
 * It sits between the officers and the FAQ on purpose. Anybody who has read
 * that far is looking for a way in, and the FAQ's first question is about
 * joining — this is the answer for the readers that question does not fit.
 *
 * **The blurbs and the artwork shipped as placeholders and are rows now.** The
 * names and the two official sites are real; everything else was written to be
 * replaced, which is why a card with no image draws a held-open well rather than
 * collapsing to fit — and replacing it is a form at
 * `/dashboard/officer/front-page` rather than a pull request, which was the
 * whole problem with copy nobody on the club's side could edit.
 *
 * `HomePage` fetches these with the rest of the page's words; see the note there
 * for why one request rather than three.
 */

/**
 * Rules are the container's background showing through a 1px gap, not a border
 * per card — the strip idiom in `.claude/docs/styling.md`. Two across at width
 * and one below the breakpoint, where a card with a blurb in it is already as
 * narrow as it can usefully be.
 */
const gridClass = 'bg-rule border-rule grid gap-px border wide:grid-cols-2'

/**
 * A fixed height whether or not there is artwork in it, the same rule the
 * sponsor logos follow: a partner who sends a wordmark must not make their card
 * taller than the one beside it. Taller than the sponsor strip's well because
 * these cards are the subject of their section rather than a passing row of
 * logos.
 */
const wellClass =
  'border-rule flex h-40 shrink-0 items-center justify-center border-b p-6'

export function PartnersSection({ copy }: { copy: ApiState<ApiFrontPage> }) {
  const programs = copy.status === 'ready' ? copy.data.partners : []

  /**
   * **No skeleton and no error message: the section is simply not there yet.**
   *
   * Every other section on this page holds its shape while it waits, because
   * every other section is one a visitor came looking for. This one exists to
   * catch the reader the club cannot sign up — it has no heading anybody is
   * scrolling to and no fixed height — so reserving space for it would mean
   * reserving space for something that may turn out not to exist, and a
   * bordered empty box is worse than a section that arrives a moment late.
   *
   * An empty list is the same answer as a failed request here, and that is the
   * one place on this page where it should be: taking the section down is a
   * thing officers do, and a visitor cannot act on the difference.
   */
  if (programs.length === 0) return null

  return (
    <section
      id="partners"
      className="border-rule px-page scroll-mt-20 border-t py-12 wide:py-18"
    >
      <div className="mb-9">
        <h2 className="text-faint mb-5 font-mono text-[13px] font-bold tracking-[0.2em]">
          / PARTNER PROGRAMS
        </h2>
        <p className="text-dim max-w-[46rem] text-sm leading-[1.7] text-pretty">
          {copy.status === 'ready' ? copy.data.partnersIntro : ''}
        </p>
      </div>

      <ul className={gridClass}>
        {programs.map((program) => (
          <li key={program.id} className="flex">
            <article className="bg-base-100 flex h-full w-full flex-col">
              <div
                className={`${wellClass} ${
                  program.imageUrl ? 'bg-base-200' : 'bg-hatch'
                }`}
              >
                {program.imageUrl ? (
                  /* Decorative: the name is printed directly below, so
                     announcing the artwork too reads the program out twice.
                     `object-contain` rather than `cover` because what lands
                     here is most likely a wordmark, and a cropped logo looks
                     like a mistake in a way a letterboxed photo does not.

                     Through `imageSrc` even though this is copy rather than a
                     column: an upload's address is root-relative and the API is
                     another origin, and forgetting it is the failure that shows
                     up as a broken image with nothing in the console. */
                  <img
                    src={imageSrc(program.imageUrl)}
                    alt=""
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="text-faint font-mono text-[9px] font-medium tracking-[0.14em]">
                    [ IMAGE ]
                  </span>
                )}
              </div>

              <div className="flex flex-1 flex-col p-5">
                <div className="text-faint font-mono text-[9px] font-medium tracking-[0.16em]">
                  {program.audience}
                </div>
                <h3 className="mt-2 text-lg leading-tight font-semibold tracking-[-0.01em]">
                  {program.name}
                </h3>

                {/* `flex-1` on the blurb rather than the card, so two cards of
                    different lengths still put their links on the same line. */}
                <p className="text-dim mt-3 flex-1 text-[13px] leading-[1.55] text-pretty">
                  {program.blurb}
                </p>

                {/* Named after the program it opens, not "learn more": these
                    are the only two links in the section and a screen reader
                    reads them as a list. */}
                <a
                  href={program.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary border-primary/40 hover:border-primary mt-5 self-start border-b pb-0.5 text-xs font-medium transition-colors duration-200"
                >
                  {program.linkLabel}
                </a>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  )
}
