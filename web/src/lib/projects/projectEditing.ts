import type { ApiMyProject, UserRole } from '../api/api'

/**
 * Who may edit a project's public page, in the browser's opinion.
 *
 * Mirrors `requireProjectLead` in `server/src/auth/authz.ts`, and mirrors rot — so
 * it lives here, alone, with its own test, rather than as a condition inside a
 * component. The rule, both halves of it:
 *
 *   - **Officers and admins pass on the role alone**, with no membership row on
 *     the project at all. That is how an officer edits a page for a project
 *     they have never been on.
 *   - **Everybody else needs `PROJECT_LEAD` on *this* project.** `TEAM_LEAD`
 *     grants nothing here, exactly as it grants nothing there, and leading
 *     project A grants nothing on project B.
 *
 * `role` is read for exactly one thing — waving officers through — and that is
 * the whole of what `UserRole` has to say about any project.
 *
 * Presentation only. Every button this ungates lands on a route that asks the
 * same question again, so being wrong here shows somebody a form the server
 * will refuse — never the other way round.
 */
export function canEditProject(
  role: UserRole,
  mine: ApiMyProject[] | null,
  projectId: string,
): boolean {
  if (role === 'ADMIN' || role === 'OFFICER') return true
  if (!mine) return false

  return mine.some(
    (row) => row.project.id === projectId && row.rank === 'PROJECT_LEAD',
  )
}

/**
 * Whether somebody is editing on their officer authority rather than on a rank
 * they hold here — which the editor says out loud, because an officer wandering
 * into another project's page should know in which capacity they are acting.
 */
export function editingAsOfficer(
  role: UserRole,
  mine: ApiMyProject[] | null,
  projectId: string,
): boolean {
  if (role !== 'ADMIN' && role !== 'OFFICER') return false

  return !mine?.some(
    (row) => row.project.id === projectId && row.rank === 'PROJECT_LEAD',
  )
}

/** Somebody's rank on one project, or null when they are not on it. */
export function rankOn(
  mine: ApiMyProject[] | null,
  projectId: string,
): ApiMyProject['rank'] | null {
  return mine?.find((row) => row.project.id === projectId)?.rank ?? null
}

// `leadRanksElsewhere` used to live here: the leave dialog counted lead seats on
// other projects to say whether walking out of this one would cost somebody
// their club-wide roster label. Nothing about a project writes `User.role` any
// more, so there is no label to warn about and nothing to count.
