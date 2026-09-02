import { useEffect, useState } from 'react'
import { Status } from '../shared/Status'
import { patchJson } from '../../lib/api/api'
import type { ApiProjectDetail } from '../../lib/api/api'
import { memberLabel } from '../../lib/projects/projectRoles'
import type { ProjectRoster } from '../../lib/projects/useProjectRoster'
import { useSectionStatus } from '../../lib/useSectionStatus'

/**
 * The `/ THE TEAM` section of the editor: what each person is called on this
 * project.
 *
 * **`ProjectMember.title` has had a route since the model existed and no page
 * has ever sent one**, so the column was empty everywhere and the public roster
 * printed the club-wide `User.title` instead — which is how "Lab Manager" ended
 * up beside somebody's name on a rover page. This is the form that fills the
 * right column in, and the public page no longer draws the wrong one.
 *
 * **Rank is shown and not edited, and that is a boundary rather than an
 * omission.** Who leads a project is the board's decision and lives on the roles
 * desk; who leads a team is the project lead's and lives on the manage page. The
 * route behind this section refuses `PROJECT_LEAD` in its own schema, so a form
 * offering it here would be offering something the server will not do.
 *
 * Saved on blur, one field at a time, like a gallery caption: each row is its
 * own small write with its own failure, and there is nothing here that a SAVE
 * button would usefully batch.
 */
export function TeamEditor({
  project,
  roster,
  heading,
}: {
  project: ApiProjectDetail
  /** Read once by `ProjectEditor` and passed down — the public payload carries
      no user ids, and a title is written by id. */
  roster: ProjectRoster
  heading: string
}) {
  const { message, busy, run } = useSectionStatus()

  /**
   * The typed titles, keyed by user.
   *
   * Held here rather than in the roster, because the roster is the server's
   * answer and this is what somebody is in the middle of typing. Seeded when the
   * read lands, and only then — seeding from an empty roster would blank every
   * box the moment it arrived.
   */
  const [titles, setTitles] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!roster.ready) return
    setTitles(
      Object.fromEntries(
        roster.members.map((member) => [member.userId, member.title ?? '']),
      ),
    )
  }, [roster.ready, roster.members])

  const teamName = (teamId: string | null) =>
    teamId === null ? null : (roster.teams.find((team) => team.id === teamId) ?? null)

  const save = (userId: string, title: string) =>
    run(async () => {
      await patchJson(`/projects/${project.id}/members/${userId}`, {
        title: title.trim() || null,
      })
    })

  return (
    <section>
      <p className="mb-4 font-mono text-[13px] font-bold tracking-[0.2em] text-faint uppercase">
        / {heading}
      </p>

      {!roster.ready ? (
        <p aria-busy="true" className="border-t border-rule py-5 text-sm text-faint">
          Loading the roster…
        </p>
      ) : roster.members.length === 0 ? (
        <p className="border-t border-rule py-5 text-sm text-faint">
          Nobody is on this project yet. People appear here when they join.
        </p>
      ) : (
        <ul className="divide-y divide-rule border border-rule">
          {roster.members.map((member) => {
            const rank = memberLabel({
              rank: member.rank,
              // Deliberately not the typed title: this line is the rank, and
              // the box beside it is the title. `memberLabel` returns null for
              // a plain member with nothing typed, which is the row that draws
              // no rank line at all.
              title: null,
              team: teamName(member.teamId),
            })

            return (
              <li
                key={member.userId}
                className="flex flex-wrap items-end gap-x-4 gap-y-2 px-4 py-3"
              >
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate text-sm font-medium">{member.fullName}</p>
                  {rank && (
                    <p className="font-mono text-[10px] font-medium tracking-[0.14em] text-faint">
                      {rank}
                    </p>
                  )}
                </div>

                <input
                  type="text"
                  value={titles[member.userId] ?? ''}
                  maxLength={80}
                  placeholder="Title on this project (optional)"
                  aria-label={`Title for ${member.fullName}`}
                  disabled={busy}
                  onChange={(event) => {
                    setTitles({
                      ...titles,
                      [member.userId]: event.target.value,
                    })
                  }}
                  onBlur={() => {
                    void save(member.userId, titles[member.userId] ?? '')
                  }}
                  className="input h-9 min-h-0 min-w-0 flex-1 basis-48 border-rule bg-base-100 text-[13px]"
                />
              </li>
            )
          })}
        </ul>
      )}

      <p className="mt-3 text-[11px] leading-[1.5] text-pretty text-faint">
        Free text, printed beside the name on the public page. Who leads the project is
        set by officers on the roles desk, and who leads a team on the project&rsquo;s own
        manage page.
      </p>

      <Status message={message} />
    </section>
  )
}
