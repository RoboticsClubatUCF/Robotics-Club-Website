import { useState } from 'react'
import { Link } from 'react-router'
import type {
  ApiCardProject,
  ApiListedProject,
  ApiProject,
  Season,
} from '../../lib/api/api'
import { slidesOf } from '../../lib/projects/projectGallery'
import { proseExcerpt } from '../../lib/projects/projectProse'
import { useApi } from '../../lib/api/useApi'
import { FormEyebrow, FormHeading } from '../shared/formChrome'
import { ProjectGallery } from './ProjectGallery'
import { ProjectProse } from './ProjectProse'

/**
 * The server caps `limit` at 100, and one page of that is every project the
 * club has ever run. If the list outgrows it, this becomes pagination — not a
 * bigger number.
 */
const LIMIT = 100

/**
 * This semester's builds, with their pictures and their writing. `term=current`
 * is computed on the server — the browser has no way of knowing which term it
 * is, and a page that guessed would go quietly empty every August.
 *
 * **Both heavy columns are asked for by name.** `images=true` is the one place
 * the listing carries galleries, and it is safe here precisely because of the
 * term filter: this is a handful of projects and every one of them is drawn.
 * `description=true` is the write-up — see `PROSE` below for why the page reads
 * that rather than `summary`.
 */
const CURRENT = `/projects?term=current&images=true&description=true&limit=${LIMIT}`

/** Everything that is not this semester, newest term first. The writing, but no
    pictures: forty galleries is not a list anybody scrolls. */
const ARCHIVE = `/projects?term=other&description=true&limit=${LIMIT}`

const rowClass =
  'border-rule grid grid-cols-[2.75rem_1fr] items-start gap-3.5 border-t py-6.5 pr-2 wide:grid-cols-[70px_1.1fr_2fr_140px] wide:gap-7 wide:pl-2'

/**
 * How wide a card's slideshow is allowed to get: 22rem, so 352 × 220 at the
 * frame's 16:10.
 *
 * The pictures cannot be trusted to be big. Half a gallery is external
 * addresses somebody pasted — the club's covers today include a Google
 * image-search thumbnail a couple of hundred pixels across — and a frame that
 * took its size from the viewport was upscaling those threefold on a wide
 * monitor. Nothing in an `<img>` says "stop at your own pixels", so the layout
 * has to.
 *
 * The card's own track is already bounded (`CARD_CLASS` below), so this only
 * bites in the two cases the track is not: a card wide enough to be handed a
 * 440px column on a large monitor, and a phone, where the card is one track and
 * that track is the page.
 */
const GALLERY_WIDTH = 'w-full max-w-[22rem]'

/**
 * A card, and the two-across grid it sits in.
 *
 * **The card lays itself out on its own width, not the viewport's.** It is a
 * `grid-fluid` rather than a `wide:` split because there is no viewport width
 * at which the answer is the same for both columns of a two-across grid: at the
 * breakpoint a card is 390px and the picture has to sit above the writing, on a
 * monitor it is 900px and it has to sit beside it. `--col-min` is "how narrow
 * may a column get" — 15rem, which is about as narrow as a summary stays
 * readable — so the card flips between the two on its own, and `auto-fit`
 * collapsing the empty tracks is what makes a card with no gallery one
 * full-width column with no class of its own.
 *
 * **Every card draws its own top rule and none draws a bottom one.** Grid items
 * stretch, so both cards in a row start on the row line and their two rules read
 * as the one rule the list has always been ruled with. The `gap` is horizontal
 * only: the rows' rhythm is each card's own `py-8`, exactly as when they were
 * full-width rows, and a vertical gap would double it.
 */
const CARD_CLASS =
  'border-rule grid-fluid items-start gap-5 border-t py-8 [--col-min:15rem]'

/**
 * How a card sets the write-up. On every paragraph rather than between them, so
 * the first is also spaced off whatever it follows — see `ProjectProse`.
 *
 * **The page prints `description`, and `summary` is why it has to.** `summary`
 * is the column the schema calls the one-liner for cards, and it is the one
 * this list printed for as long as it existed — but no project the club has
 * ever created has filled one in, so every card and every archive row was a
 * title above an empty paragraph. Both are drawn now, in the order a project's
 * own page draws them, and in practice only the second one has anything in it.
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
 * The projects list — this semester in full, everything before it behind a
 * button.
 *
 * **The page shows one term at a time now.** A project belongs to a term, and a
 * build that runs for three years is three rows with one name; listed flat they
 * read as three projects, and the club's back catalogue buried the thing
 * somebody came here to find — what is being built *now*. So the current term
 * is the page, and the rest is one press away at the bottom.
 *
 * **The two lists deliberately do not look alike.** This term's projects are
 * cards with their slideshow in them, because a prospective member is here to
 * see robots and the summary alone was a page of grey text. The archive stays
 * the original rules-and-columns rows — you can read down the term column and
 * the competition column separately, which is what an archive is for, and forty
 * galleries is not a list anybody scrolls.
 *
 * **The archive is not fetched until it is asked for.** Its component mounts on
 * the press and `useApi` runs then, the same trick `ProjectPage` uses for the
 * signed-in half of a project page — which means the common visit costs one
 * request, and a smaller one than before.
 *
 * This came off the landing page when the projects moved to a page of their
 * own, and `pages/public/ProjectsPage.tsx` is now that page: the section carries its
 * whole content, header included, which is why the header is an `h1`.
 */
export function ProjectsSection() {
  const current = useApi<ApiCardProject[]>(CURRENT)
  const [archiveOpen, setArchiveOpen] = useState(false)

  // Every row in a `term=current` answer carries the same term, so the heading
  // reads it off the first rather than asking the server a second time. With no
  // rows there is no term to name, which is why the empty state says "this
  // semester" in words instead.
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
 * One of this semester's projects: its slideshow beside what the list has
 * always printed.
 *
 * **The card is not a link, and the title is.** The row used to be one `<Link>`
 * wrapping everything, which the gallery ends: arrows and a thumbnail inside an
 * anchor is a control inside a link, and the browser resolves that by giving
 * the reader neither. So the two things worth pressing say so themselves.
 *
 * **No pictures means no frame.** A project with an empty gallery gets the text
 * across the full width rather than an empty hatched box, which on a public
 * page reads as an image that failed to load.
 */
function ProjectCard({
  project,
  lcp,
}: {
  project: ApiCardProject
  /** Whether this card holds the picture the page will be judged on painting.
      True for the first card only — see `priority` on `ProjectGallery`. */
  lcp: boolean
}) {
  const slides = slidesOf(project)

  return (
    <article className={CARD_CLASS}>
      {slides.length > 0 && (
        <div className={GALLERY_WIDTH}>
          <ProjectGallery
            slides={slides}
            compact
            priority={lcp}
            label={`${project.title} images`}
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

        <ProjectProse description={project.description} className={PROSE} />

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
  const past = useApi<ApiListedProject[]>(ARCHIVE)

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
          className={`${rowClass} hover:bg-wash transition-[background-color,padding-left] duration-250 wide:hover:pl-4.5`}
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

          {/* Below the breakpoint the grid drops to two columns and these two
              stack under the name rather than beside it.

              Clamped, and an excerpt rather than `ProjectProse`'s paragraphs:
              this column has always been one blurb wide, and a write-up set out
              properly in it would break the row rhythm the archive is read by.
              `summary` first because that is the field meant for exactly this —
              it is simply that nobody has ever filled one in. */}
          <p className="text-dim col-start-2 line-clamp-3 pt-0.5 text-sm leading-[1.6] text-pretty wide:col-start-auto">
            {project.summary ?? proseExcerpt(project.description)}
          </p>
          {/* The term rather than the free-text `season` this column used to
              print. The same build run three years running is three rows with
              one title, and the term is the only thing that tells them apart —
              which is the entire job of the right-hand column in a list you are
              reading downwards. */}
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
function ArchiveButton({
  children,
  onClick,
}: {
  children: string
  onClick: () => void
}) {
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
            className={`bg-base-300 aspect-[16/10] animate-pulse rounded-[2px] ${GALLERY_WIDTH}`}
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
