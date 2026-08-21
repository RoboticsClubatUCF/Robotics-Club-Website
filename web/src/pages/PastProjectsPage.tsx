import { Link, useOutletContext } from 'react-router'
import type { DashboardContext } from '../components/dashboard/DashboardLayout'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
} from '../components/shared/formChrome'
import type { ApiMyProject, Season } from '../lib/api'

/**
 * Everything somebody has ever been on, minus what they are on now.
 *
 * It exists because the dashboard became term-scoped. `/ MY PROJECTS` shows
 * this semester and nothing else, which is right for the rail — a member three
 * years in wants this Thursday's meeting, not a history — but the history is
 * the part worth keeping, so it gets a page instead of being deleted from view.
 *
 * **No request of its own.** The layout already fetched every membership,
 * flagged, and passes it down; this is the other half of the filter the rail
 * applies. That is also why the loading and error states here are the layout's
 * rather than something this page could retry — the panel says so plainly
 * instead of pretending it has a button.
 */
export function PastProjectsPage() {
  const { projects } = useOutletContext<DashboardContext>()

  return (
    <>
      <FormEyebrow>/ MY PROJECTS · PAST</FormEyebrow>
      <FormHeading>What you&rsquo;ve worked on.</FormHeading>

      {projects.status === 'loading' && (
        <FormPanel>
          <div aria-busy="true" className="space-y-2.5">
            <div className="bg-base-300 h-4 w-2/3 animate-pulse rounded-[2px]" />
            <div className="bg-base-300 h-3 w-1/2 animate-pulse rounded-[2px]" />
          </div>
        </FormPanel>
      )}

      {projects.status === 'error' && (
        <FormPanel>
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            We couldn&rsquo;t load your projects just now. Try again in a moment.
          </p>
        </FormPanel>
      )}

      {projects.status === 'ready' && <Terms mine={projects.data} />}
    </>
  )
}

/** Newest term first. The seasons are declared in calendar order on the server,
    so within a year this is just their index. */
const ORDER: Record<Season, number> = { SPRING: 0, SUMMER: 1, FALL: 2 }

const TERM_LABEL: Record<Season, string> = {
  SPRING: 'Spring',
  SUMMER: 'Summer',
  FALL: 'Fall',
}

function Terms({ mine }: { mine: ApiMyProject[] }) {
  const before = mine.filter(({ current }) => !current)

  if (before.length === 0) {
    return (
      <FormPanel>
        <p className="text-dim text-sm leading-[1.7] text-pretty">
          Nothing here yet. Projects land on this page once their semester is
          over, so it fills itself in as you go.
        </p>
      </FormPanel>
    )
  }

  // Grouped by term rather than listed flat: the same build run three years
  // running is three rows with one name, and the term is the only thing that
  // tells them apart.
  const terms = new Map<string, ApiMyProject[]>()

  for (const membership of before) {
    const key = `${membership.project.termYear}-${membership.project.termSeason}`
    terms.set(key, [...(terms.get(key) ?? []), membership])
  }

  const sorted = [...terms.entries()].sort(([a], [b]) => {
    const [yearA, seasonA] = a.split('-') as [string, Season]
    const [yearB, seasonB] = b.split('-') as [string, Season]
    return (
      Number(yearB) - Number(yearA) || ORDER[seasonB] - ORDER[seasonA]
    )
  })

  return (
    <div className="space-y-5">
      {sorted.map(([key, memberships]) => {
        const { termYear, termSeason } = memberships[0]!.project

        return (
          <FormPanel key={key}>
            <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]">
              {TERM_LABEL[termSeason].toUpperCase()} {termYear}
            </p>

            <ul className="space-y-4">
              {memberships.map(({ project, rank, title, team }) => {
                const standing = [
                  rank === 'PROJECT_LEAD'
                    ? 'Project lead'
                    : rank === 'TEAM_LEAD'
                      ? 'Team lead'
                      : null,
                  title,
                  team?.name,
                ]
                  .filter(Boolean)
                  .join(' · ')

                return (
                  <li key={project.id}>
                    {/* Still a link. Nothing about a past project is closed —
                        the roster, the tasks and the write-up are all still
                        there, and a lead of one still leads it. */}
                    <Link
                      to={`/dashboard/projects/${project.slug}`}
                      className="hover:text-primary text-sm font-semibold transition-colors duration-200"
                    >
                      {project.title}
                    </Link>
                    {standing && (
                      <p className="text-faint mt-0.5 font-mono text-[10px] font-medium tracking-[0.14em] uppercase">
                        {standing}
                      </p>
                    )}
                    {project.summary && (
                      <p className="text-dim mt-1 text-[13px] leading-[1.5] text-pretty">
                        {project.summary}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          </FormPanel>
        )
      })}
    </div>
  )
}
