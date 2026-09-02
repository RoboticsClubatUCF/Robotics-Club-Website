import { useEffect, useState } from 'react'
import { getJson } from '../api/api'
import type { ApiProjectTeamMember, ApiProjectTeamView, ApiTeam } from '../api/api'

/**
 * The people on a project, and its teams, for the editor.
 *
 * **Read here rather than taken from `project.members`**, which the public
 * detail route deliberately answers without user ids — a credit and a title are
 * both written by id, and widening an anonymous payload so an editor can have
 * one would be paying for it on every page view. This route wants a membership
 * or an officer's standing, which everybody who can see the editor already has.
 *
 * **One read for the whole editor.** It lives in `ProjectEditor` and is passed
 * down, rather than each section fetching its own: the documents section used to
 * defer this until its form opened, which was worth doing while it was the only
 * consumer, and stopped being worth doing the moment the team section — which
 * cannot draw a single row without it — appeared beside it. Two deferrals would
 * be two requests for one list.
 *
 * A failure is silent on purpose. The sections degrade rather than break: the
 * credit picker still offers whoever is signed in, and the team section says it
 * could not load the roster. A red line about a list nobody asked for would be a
 * strange thing to meet on pressing EDIT PAGE.
 */
export type ProjectRoster = {
  members: ApiProjectTeamMember[]
  teams: ApiTeam[]
  /** False until the read has landed either way, so a section can tell "nobody
      is on this project" from "the list has not arrived". */
  ready: boolean
}

export const EMPTY_ROSTER: ProjectRoster = {
  members: [],
  teams: [],
  ready: false,
}

export function useProjectRoster(projectId: string): ProjectRoster {
  const [roster, setRoster] = useState<ProjectRoster>(EMPTY_ROSTER)

  useEffect(() => {
    let live = true
    setRoster(EMPTY_ROSTER)

    getJson<ApiProjectTeamView>(`/projects/${projectId}/team`)
      .then((view) => {
        if (live) {
          // Defaulted rather than trusted. These arrive from the network, and
          // an answer missing one of them would otherwise be a `.map` of
          // undefined inside a render — which takes the whole editor down,
          // including the write-up somebody is halfway through.
          setRoster({
            members: view.members ?? [],
            teams: view.teams ?? [],
            ready: true,
          })
        }
      })
      .catch((error: unknown) => {
        console.error(error)
        // Ready, and empty. The alternative is a section that spins for ever on
        // a project whose roster read failed once.
        if (live) setRoster({ members: [], teams: [], ready: true })
      })

    return () => {
      live = false
    }
  }, [projectId])

  return roster
}
