import type { ProjectMemberRank } from '../api/api'

/**
 * The dashboard's sub-pages, listed once for the two places that draw them: the rail's
 * dropdowns and the strip of links a page shows on phones, where the rail is folded away.
 * A label or address written in both would drift.
 *
 * The first entry is the section's own address. It has to stay first: the rail's parent row
 * links there, and `/dashboard/profile` is also where the email-change link lands.
 */
export interface SubPage {
  label: string
  to: string
}

export const PROFILE_PAGES: readonly SubPage[] = [
  { label: 'PROFILE', to: '/dashboard/profile' },
  { label: 'ACCOUNT', to: '/dashboard/profile/account' },
  { label: 'MEMBERSHIP', to: '/dashboard/profile/membership' },
]

export const ROLES_PAGES: readonly SubPage[] = [
  { label: 'OFFICER BOARD', to: '/dashboard/officer/roles' },
  { label: 'LEADS', to: '/dashboard/officer/roles/leads' },
  { label: 'GRANT MEMBERSHIP', to: '/dashboard/officer/roles/grant' },
  { label: 'TITLES', to: '/dashboard/officer/roles/titles' },
]

export const SURVEY_PAGES: readonly SubPage[] = [
  { label: 'RESULTS', to: '/dashboard/officer/survey' },
  { label: 'QUESTIONS', to: '/dashboard/officer/survey/questions' },
]

export const FRONT_PAGE_PAGES: readonly SubPage[] = [
  { label: 'PHOTOS', to: '/dashboard/officer/front-page' },
  { label: 'HEADLINE', to: '/dashboard/officer/front-page/headline' },
  { label: 'QUESTIONS', to: '/dashboard/officer/front-page/questions' },
  { label: 'PARTNERS', to: '/dashboard/officer/front-page/partners' },
]

export const SPONSORS_PAGES: readonly SubPage[] = [
  { label: 'SPONSORS', to: '/dashboard/officer/sponsors' },
  { label: 'TIERS', to: '/dashboard/officer/sponsors/tiers' },
  { label: 'OTHER HELP', to: '/dashboard/officer/sponsors/other' },
]

export const PROJECTS_DESK_PAGES: readonly SubPage[] = [
  { label: 'ALL PROJECTS', to: '/dashboard/officer/projects' },
  { label: 'NEW PROJECT', to: '/dashboard/officer/projects/new' },
  { label: 'RUN ONE AGAIN', to: '/dashboard/officer/projects/again' },
]

export const PRINT_QUEUE_PAGES: readonly SubPage[] = [
  { label: 'QUEUE', to: '/dashboard/officer/print' },
  { label: 'SLICER PROFILES', to: '/dashboard/officer/print/profiles' },
  { label: 'FILAMENT USAGE', to: '/dashboard/officer/print/usage' },
]

/** The parts of a project's manage page, in the order the rail and the page list them. */
export type ManagePart =
  | 'members'
  | 'teams'
  | 'tasks'
  | 'events'
  | 'meetings'
  | 'settings'

/**
 * A project's pages: its own page, then the manage sub-pages this rank can use.
 *
 * A team lead gets their team, tasks and events, the same three panels the manage page has
 * always drawn for them. Their roster lives at the `members` address under the label TEAM,
 * so the rank decides the label and not the route. Somebody with no lead rank has no
 * manage pages, so the rail draws the project as a plain row.
 */
export function projectPages(
  slug: string,
  rank: ProjectMemberRank,
): readonly SubPage[] {
  const page = `/dashboard/projects/${slug}`
  const manage = `${page}/manage`

  if (rank === 'MEMBER') return []

  if (rank === 'TEAM_LEAD') {
    return [
      { label: 'PROJECT PAGE', to: page },
      { label: 'MY TEAM', to: manage },
      { label: 'TASKS', to: `${manage}/tasks` },
      { label: 'EVENTS', to: `${manage}/events` },
    ]
  }

  return [
    { label: 'PROJECT PAGE', to: page },
    { label: 'MEMBERS', to: manage },
    { label: 'TEAMS', to: `${manage}/teams` },
    { label: 'TASKS', to: `${manage}/tasks` },
    { label: 'EVENTS', to: `${manage}/events` },
    { label: 'MEETINGS', to: `${manage}/meetings` },
    { label: 'SETTINGS', to: `${manage}/settings` },
  ]
}

/** Whether `pathname` is one of `pages` or somewhere beneath one. */
export function within(pathname: string, pages: readonly SubPage[]) {
  return pages.some(
    ({ to }) => pathname === to || pathname.startsWith(`${to}/`),
  )
}
