import { ProjectsSection } from '../components/projects/ProjectsSection'

/**
 * `/projects` — the full list.
 *
 * The section carries the whole page. It was built for this route back when it
 * came off the landing page, and it already fetches, numbers and links its own
 * rows; a page wrapper with its own header would just say "projects" twice.
 */
export function ProjectsPage() {
  return <ProjectsSection />
}
