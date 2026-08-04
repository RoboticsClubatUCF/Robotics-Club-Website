import type { ApiProject } from '../lib/api'
import { useApi } from '../lib/useApi'

/** How many rows the landing page shows. The full list is its own page. */
const LIMIT = 5

const rowClass =
  'border-rule grid grid-cols-[2.75rem_1fr] items-start gap-3.5 border-t py-6.5 pr-2 wide:grid-cols-[70px_1.1fr_2fr_140px] wide:gap-7 wide:pl-2'

/**
 * The projects list, as rules-and-columns rather than cards — the point is that
 * you can read down the season column and the competition column separately.
 *
 * Rows are not links yet. The source design had them as `cursor: pointer` divs
 * pointing at nothing; rather than ship a click target that goes nowhere, each
 * row stays a plain article until project routes exist, at which point the
 * wrapper becomes an `<a href={`/projects/${project.slug}`}>` and nothing else
 * about the markup has to change.
 */
export function ProjectsSection() {
  const projects = useApi<ApiProject[]>(`/projects?limit=${LIMIT}`)

  return (
    <section id="projects" className="px-page scroll-mt-20 py-12 wide:py-18">
      <div className="mb-9 flex items-baseline justify-between">
        <h2 className="text-faint font-mono text-[13px] font-bold tracking-[0.2em]">
          / THE PROJECTS
        </h2>
        <a
          href="/projects"
          className="text-primary border-primary/40 hover:border-primary border-b pb-0.5 text-xs font-medium transition-colors duration-200"
        >
          All projects
        </a>
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
            <article
              key={project.slug}
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
            </article>
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
