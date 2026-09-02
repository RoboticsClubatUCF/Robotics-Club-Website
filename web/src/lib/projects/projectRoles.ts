import type { ProjectMemberRank } from '../api/api'

/**
 * What to call somebody on a project's roster.
 *
 * One function because three pages print this and they used to print it three
 * ways: the public page printed only the free-text titles and said nothing about
 * rank at all, so the person running the build was indistinguishable from
 * everybody else on it; the manage page had the ternary twice in one file, once
 * in sentence case and once in capitals.
 *
 * **Rank wins over the typed title, and that is deliberate.** `rank` is the
 * column every permission on this project is decided by; `title` is free text
 * that grants nothing. A member who has typed "Software Lead" against their own
 * name should not be able to read as the project's lead beside somebody who is.
 * A team lead's team is part of the label rather than beside it — "TEAM LEAD"
 * with no team named says almost nothing, and a `TEAM_LEAD` always has one.
 *
 * Returns null for a plain member with no title, so a caller draws nothing at
 * all rather than a row ending in the word "Member" fifteen times.
 */
export function memberLabel(member: {
  rank: ProjectMemberRank
  title: string | null
  team?: { name: string } | null
}): string | null {
  if (member.rank === 'PROJECT_LEAD') return 'PROJECT LEAD'

  if (member.rank === 'TEAM_LEAD') {
    return member.team ? `TEAM LEAD — ${member.team.name}` : 'TEAM LEAD'
  }

  return member.title
}
