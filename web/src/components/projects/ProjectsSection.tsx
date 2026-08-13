import { Link } from 'react-router'
import type { ApiProject } from '../../lib/api'
import { useApi } from '../../lib/useApi'
import { FormEyebrow, FormHeading } from '../shared/formChrome'

/**
 * The server caps `limit` at 100, and one page of that is every project the
 * club has ever run. If the list outgrows it, this becomes pagination — not a
 * bigger number.
 */
const LIMIT = 100

const rowClass =
  'border-rule grid grid-cols-[2.75rem_1fr] items-start gap-3.5 border-t py-6.5 pr-2 wide:grid-cols-[70px_1.1fr_2fr_140px] wide:gap-7 wide:pl-2'

/**
 * The projects list, as rules-and-columns rather than cards — the point is that
 * you can read down the season column and the competition column separately.
 *
 * This came off the landing page when the projects moved to a page of their
 * own, and `pages/ProjectsPage.tsx` is now that page: the section carries its
 * whole content, header included, which is why the header is an `h1`. Rows are
 * links now that `/projects/{slug}` exists — the wrapper changed from
 * `<article>` to `<Link>` and nothing else about the markup had to.
 */
export function ProjectsSection() {
  const projects = useApi<ApiProject[]>(`/projects?limit=${LIMIT}`)

  return (
    <section id="projects" className="px-page scroll-mt-20 py-12 wide:py-18">
      <div className="mb-9">
        <FormEyebrow>/ THE PROJECTS</FormEyebrow>
        <FormHeading>What we're building.</FormHeading>
        <p className="text-dim max-w-[34rem] text-sm leading-[1.7] text-pretty">
          Everything on the bench and in the books. Open one for the full story
          and the people behind it.
        </p>
      </div>

      {projects.status === 'loading' && <ProjectRowsSkeleton />}

      {projects.status === 'error' && (
        <p className="border-rule text-faint border-t py-6.5 text-sm">
          Couldn't load the projects just now. Please try again later.
        </p>
      )}

      {projects.status === 'ready' &&
        (projects.data.length === 0 ? (
          <p className="border-rule text-faint border-t py-6.5 text-sm">
            No projects are listed yet.
          </p>
        ) : (
          projects.data.map((project, index) => (
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

              {/* Below the breakpoint the grid drops to two columns and these
                  two stack under the name rather than beside it. */}
              <p className="text-dim col-start-2 pt-0.5 text-sm leading-[1.6] text-pretty wide:col-start-auto">
                {project.summary}
              </p>
              <p className="text-faint col-start-2 pt-1.5 font-mono text-[11px] font-medium wide:col-start-auto wide:text-right">
                {project.season}
              </p>
            </Link>
          ))
        ))}

      {/* Closes the list — every row draws its own top rule, so without this the
          last one has no bottom edge. */}
      <div className="border-rule border-t" />
    </section>
  )
}

/**
 * Placeholder rows at the real row height, so the page below doesn't jump when
 * the response lands.
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
