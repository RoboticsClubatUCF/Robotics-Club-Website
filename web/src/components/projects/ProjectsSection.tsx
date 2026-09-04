import { useState } from 'react'
import { Link } from 'react-router'
import type {
  ApiCardProject,
  ApiListedProject,
  ApiProject,
  Season,
} from '../../lib/api/api'
import { frameStyle } from '../../lib/media/imageFraming'
import { imageSrc } from '../../lib/media/storedFiles'
import { coverOf } from '../../lib/projects/projectCover'
import {
  ARCHIVED_PROJECTS,
  CURRENT_PROJECTS,
} from '../../lib/projects/projectListing'
import { useApi } from '../../lib/api/useApi'
import { FormEyebrow, FormHeading } from '../shared/formChrome'

const rowClass =
  'border-rule grid grid-cols-[2.75rem_1fr] items-start gap-3.5 border-t py-6.5 pr-2 wide:grid-cols-[70px_1.1fr_2fr_140px] wide:gap-7 wide:pl-2'

/**
 * How wide a card's cover is allowed to get: 22rem, so 352 x 220 at the frame's 16:10.
 *
 * The pictures can't be trusted to be big. Half a gallery is external addresses somebody pasted
 * — the club's covers today include a Google image-search thumbnail a couple of hundred pixels
 * across — and a frame that took its size from the viewport was upscaling those threefold on a
 * wide monitor. Nothing in an `<img>` says "stop at your own pixels", so the layout has to.
 *
 * The card's own track is already bounded, so this only bites where it isn't: a card handed a
 * 440px column on a large monitor, and a phone, where the card is the page.
 */
const GALLERY_WIDTH = 'w-full max-w-[22rem]'

/**
 * A card, and the two-across grid it sits in.
 *
 * The card lays itself out on its own width, not the viewport's. It's a `grid-fluid` rather than
 * a `wide:` split because there's no viewport width at which the answer is the same for both
 * columns of a two-across grid: at the breakpoint a card is 390px and the picture has to sit
 * above the writing, on a monitor it's 900px and it has to sit beside it. `--col-min` is how
 * narrow a column may get, so the card flips between the two on its own.
 *
 * Every card draws its own top rule and none draws a bottom one. Grid items stretch, so both
 * cards in a row start on the row line and their two rules read as the one rule the list has
 * always been ruled with. The `gap` is horizontal only: the rows' rhythm is each card's own
 * `py-8`, and a vertical gap would double it.
 */
const CARD_CLASS =
  'border-rule grid-fluid items-start gap-5 border-t py-8 [--col-min:15rem]'

/**
 * How a card sets its one line of prose.
 *
 * The page prints `summary` and only `summary`. It printed the write-up as well for a while, and
 * had to: no project the club had ever created had filled a summary in, so every card was a
 * title above an empty paragraph. The migration that added the cover seeded them from each
 * project's own first paragraph, so the fallback has stopped earning its place. A whole write-up
 * under six cards was a page of grey text either way.
 */
const PROSE = 'text-dim mt-3 text-sm leading-[1.6] text-pretty'

const SEASON_LABEL: Record<Season, string> = {
  SPRING: 'Spring',
  SUMMER: 'Summer',
  FALL: 'Fall',
}

const termLabel = (project: Pick<ApiProject, 'termYear' | 'termSeason'>) =>
  `${SEASON_LABEL[project.termSeason]} ${String(project.termYear)}`

/**
 * The projects list — this semester in full, everything before it behind a button.
 *
 * The page shows one term at a time. A project belongs to a term, and a build that runs for
 * three years is three rows with one name; listed flat they read as three projects, and the
 * club's back catalogue buried the thing somebody came here to find.
 *
 * The two lists deliberately don't look alike. This term's projects are cards with a cover,
 * because a prospective member is here to see robots. The archive stays the original
 * rules-and-columns rows — you can read down the term column and the competition column
 * separately, which is what an archive is for, and forty pictures isn't a list anybody scrolls.
 *
 * The archive isn't fetched until it's asked for: its component mounts on the press and `useApi`
 * runs then, so the common visit costs one request.
 *
 * This came off the landing page when the projects moved to a page of their own, and the section
 * carries its whole content, header included, which is why the header is an `h1`.
 */
export function ProjectsSection() {
  const current = useApi<ApiCardProject[]>(CURRENT_PROJECTS)
  const [archiveOpen, setArchiveOpen] = useState(false)

  // Every row in a `term=current` answer carries the same term, so the heading reads it off the
  // first rather than asking the server again. With no rows there's no term to name, which is
  // why the empty state says "this semester" in words.
  const term = current.status === 'ready' ? current.data[0] : undefined

  return (
    <section id="projects" className="px-page scroll-mt-20 py-12 wide:py-18">
      <div className="mb-9">
        <FormEyebrow>/ THE PROJECTS</FormEyebrow>
        <FormHeading>What we're building.</FormHeading>
        <p className="text-dim max-w-[34rem] text-sm leading-[1.7] text-pretty">
          What the club is running this semester. Everything we have built
          before is at the bottom of the page.
        </p>
      </div>

      {term && (
        <p className="text-primary mb-5 font-mono text-[11px] font-medium tracking-[0.16em] uppercase">
          {termLabel(term)}
        </p>
      )}

      {current.status === 'loading' && <CurrentSkeleton />}

      {current.status === 'error' && (
        <p className="border-rule text-faint border-t py-6.5 text-sm">
          Couldn't load the projects just now. Please try again later.
        </p>
      )}

      {current.status === 'ready' &&
        (current.data.length === 0 ? (
          <p className="border-rule text-faint border-t py-6.5 text-sm">
            Nothing is running this semester yet. The club's earlier builds are
            below.
          </p>
        ) : (
          <div className="wide:grid wide:grid-cols-2 wide:gap-x-8">
            {current.data.map((project, index) => (
              <ProjectCard
                key={project.slug}
                project={project}
                lcp={index === 0}
              />
            ))}
            {/* Closes the list — every card draws its own top rule, so without
                this the last one has no bottom edge. Across both columns, or an
                odd number of projects closes half a row. */}
            <div className="border-rule border-t wide:col-span-2" />
          </div>
        ))}

      <div className="mt-10">
        {archiveOpen ? (
          <>
            <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
              <p className="text-faint font-mono text-[13px] font-bold tracking-[0.2em]">
                / EARLIER SEMESTERS
              </p>
              <ArchiveButton
                onClick={() => {
                  setArchiveOpen(false)
                }}
              >
                HIDE PAST PROJECTS
              </ArchiveButton>
            </div>
            <Archive />
          </>
        ) : (
          <ArchiveButton
            onClick={() => {
              setArchiveOpen(true)
            }}
          >
            SHOW PAST PROJECTS
          </ArchiveButton>
        )}
      </div>
    </section>
  )
}

/**
 * One of this semester's projects: its cover beside the line its lead wrote.
 *
 * One still, not a slideshow. The card carried a compact `ProjectGallery` for a while, which
 * meant six sets of arrows down a page whose job is to get somebody into a project — and it made
 * "which picture represents this build" a question nobody could answer. `coverOf` answers it
 * from the project's own columns.
 *
 * The card isn't a link, and the title is. The row used to be one `<Link>` wrapping everything,
 * which the gallery ended: arrows and a thumbnail inside an anchor is a control inside a link.
 * The controls are gone, but a whole card as one anchor reads out as one enormous link.
 *
 * No cover means no frame. A project with nothing to show gets its text across the full width
 * rather than an empty hatched box, which on a public page reads as an image that failed to load.
 */
function ProjectCard({
  project,
  lcp,
}: {
  project: ApiCardProject
  /** Whether this card holds the picture the page will be judged on painting.
      True for the first card only: `fetchPriority="high"` on six covers is the
      same as it on none. */
  lcp: boolean
}) {
  const cover = coverOf(project)

  return (
    <article className={CARD_CLASS}>
      {cover && (
        <div className={GALLERY_WIDTH}>
          {/* The frame owns the aspect ratio, so the box is its final size
              before a byte arrives and does not move when one does. The hatch
              shows through until the picture lands, and keeps showing if it
              never does. */}
          <img
            src={imageSrc(cover.url)}
            alt=""
            loading={lcp ? 'eager' : 'lazy'}
            fetchPriority={lcp ? 'high' : undefined}
            decoding="async"
            style={frameStyle(cover)}
            className="aspect-[16/10] w-full border border-rule bg-hatch"
          />
        </div>
      )}

      <div className="min-w-0">
        <h3 className="text-2xl leading-[1.15] font-semibold tracking-[-0.01em]">
          <Link
            to={`/projects/${project.slug}`}
            className="hover:text-primary transition-colors duration-200"
          >
            {project.title}
          </Link>
        </h3>

        {project.competition && (
          <p className="text-faint mt-2 font-mono text-[10px] font-medium tracking-[0.14em]">
            {project.competition}
          </p>
        )}

        {project.summary && <p className={PROSE}>{project.summary}</p>}

        <div className="mt-5 flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <Link
            to={`/projects/${project.slug}`}
            /* Named for the reader rather than for the button. Two links to one
               place is fine; two links called "view project" is a list of
               identical destinations to anyone reading them out of context. */
            aria-label={`View ${project.title}`}
            className="text-primary border-primary/40 hover:border-primary border-b font-mono text-[11px] font-medium tracking-[0.14em] transition-colors duration-200"
          >
            VIEW PROJECT →
          </Link>
          {/* The lead's own free-text label — "Season-long", "June 2026". The
              term is printed once above the list; this is the thing it doesn't
              say. */}
          {project.season && (
            <p className="text-faint font-mono text-[11px] font-medium">
              {project.season}
            </p>
          )}
        </div>
      </div>
    </article>
  )
}

/**
 * Everything that is not this semester.
 *
 * A component rather than a branch, so mounting it is what makes the request —
 * the page below the button costs nothing until somebody presses it.
 */
function Archive() {
  const past = useApi<ApiListedProject[]>(ARCHIVED_PROJECTS)

  if (past.status === 'loading') return <ProjectRowsSkeleton />

  if (past.status === 'error') {
    return (
      <p className="border-rule text-faint border-t py-6.5 text-sm">
        Couldn't load the earlier projects just now. Please try again later.
      </p>
    )
  }

  if (past.data.length === 0) {
    return (
      <p className="border-rule text-faint border-t py-6.5 text-sm">
        Nothing here yet — every project the club has listed is running this
        semester.
      </p>
    )
  }

  return (
    <>
      {past.data.map((project, index) => (
        <Link
          key={project.slug}
          to={`/projects/${project.slug}`}
          className={`${rowClass} transition-[background-color,padding-left] duration-250 hover:bg-wash wide:hover:pl-4.5`}
        >
          <div className="text-primary pt-1.5 font-mono text-xs font-medium">
            {String(index + 1).padStart(2, '0')}
          </div>

          <div>
            <h3 className="text-2xl leading-[1.15] font-semibold tracking-[-0.01em]">
              {project.title}
            </h3>
            {project.competition && (
              <p className="text-faint mt-2 font-mono text-[10px] font-medium tracking-[0.14em]">
                {project.competition}
              </p>
            )}
          </div>

          {/* Below the breakpoint the grid drops to two columns and these stack under the name.

              `summary`, and no fallback to an excerpt of the write-up any more: this column has
              always been one blurb wide and every project has one now. Still clamped, because a
              summary may run to 500 characters. The clamp is CSS, so the whole string stays in
              the DOM and nothing is hidden from a screen reader. */}
          <p className="col-start-2 line-clamp-3 pt-0.5 text-sm leading-[1.6] text-pretty text-dim wide:col-start-auto">
            {project.summary}
          </p>
          {/* The term rather than the free-text `season` this column used to print. The same
              build run three years running is three rows with one title, and the term is the only
              thing that tells them apart. */}
          <p className="text-faint col-start-2 pt-1.5 font-mono text-[11px] font-medium wide:col-start-auto wide:text-right">
            {termLabel(project)}
          </p>
        </Link>
      ))}

      <div className="border-rule border-t" />
    </>
  )
}

/** The one control on the page, drawn the same way in both of its states. */
function ArchiveButton({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-rule text-faint hover:text-primary hover:border-primary cursor-pointer border px-4 py-2 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200"
    >
      {children}
    </button>
  )
}

/**
 * Placeholder cards at roughly the real card height, so the page below doesn't
 * jump when the response lands. Two, because two is a row — a third would draw
 * half of one and move the page further on arrival than drawing none.
 */
function CurrentSkeleton() {
  return (
    <div aria-hidden className="wide:grid wide:grid-cols-2 wide:gap-x-8">
      {Array.from({ length: 2 }, (_, index) => (
        <div key={index} className={CARD_CLASS}>
          <div
            className={`aspect-[16/10] animate-pulse rounded-[2px] bg-base-300 ${GALLERY_WIDTH}`}
          />
          <div className="space-y-3">
            <div className="bg-base-300 h-6 w-48 animate-pulse rounded-[2px]" />
            <div className="bg-base-300 h-2.5 w-32 animate-pulse rounded-[2px]" />
            <div className="bg-base-300 h-2.5 w-full animate-pulse rounded-[2px]" />
            <div className="bg-base-300 h-2.5 w-4/5 animate-pulse rounded-[2px]" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Placeholder rows at the real row height, for the archive — which appears
 * under a press, so the thing it must not do is push the button it came from
 * around while it loads.
 */
function ProjectRowsSkeleton() {
  return (
    <div aria-hidden>
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className={rowClass}>
          <div className="bg-base-300 mt-1.5 h-3 w-5 animate-pulse rounded-[2px]" />
          <div>
            <div className="bg-base-300 h-6 w-48 animate-pulse rounded-[2px]" />
            <div className="bg-base-300 mt-3 h-2.5 w-32 animate-pulse rounded-[2px]" />
          </div>
          <div className="col-start-2 space-y-2 pt-1 wide:col-start-auto">
            <div className="bg-base-300 h-2.5 w-full animate-pulse rounded-[2px]" />
            <div className="bg-base-300 h-2.5 w-4/5 animate-pulse rounded-[2px]" />
          </div>
          <div className="bg-base-300 col-start-2 mt-1.5 h-2.5 w-20 animate-pulse rounded-[2px] wide:col-start-auto wide:justify-self-end" />
        </div>
      ))}
    </div>
  )
}
