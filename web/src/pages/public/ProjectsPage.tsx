import { ProjectsSection } from '../../components/projects/ProjectsSection'

/**
 * `/projects` — this semester's builds, with the archive behind a button.
 *
 * The section carries the whole page. It was built for this route back when it
 * came off the landing page, and it fetches, lays out and links its own rows; a
 * page wrapper with its own header would just say "projects" twice.
 */
export function ProjectsPage() {
  return <ProjectsSection />
}
