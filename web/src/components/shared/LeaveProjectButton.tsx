import { useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { deleteJson } from '../../lib/api/api'
import type { ProjectMemberRank } from '../../lib/api/api'
import { explainApiError } from '../../lib/api/apiErrors'

/**
 * Leaving a project, with the consequences said out loud first.
 *
 * Nobody is locked into a project, leads included — but a lead walking out
 * gives up more than a row on a roster, and the one thing a confirmation has to
 * do is name what is about to be lost.
 *
 * `window.confirm` used to do this job on the dashboard. It cannot: the native
 * box arrives in the system font with the origin printed above it and no room
 * for the facts this decision actually turns on.
 *
 * **The sole project lead may now leave**, and this dialog says what that
 * costs the *project* rather than the person. It used to say what it cost the
 * person: walking out of your last lead seat rewrote your club-wide roster
 * label, so three sentences here worked out whether you would land on MEMBER or
 * GUEST. Nothing about a project touches that column any more — leaving changes
 * what you run, not what you are — so the sentences are gone and the honest
 * remaining consequence is that the project is left without a lead.
 */
export function LeaveProjectButton({
  projectId,
  projectTitle,
  rank,
  teamName = null,
  onLeft,
}: {
  projectId: string
  projectTitle: string
  rank: ProjectMemberRank
  /** The team a team lead is giving up, when there is one. */
  teamName?: string | null
  onLeft: () => void | Promise<void>
}) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const leave = async () => {
    setBusy(true)
    setMessage('')
    try {
      await deleteJson(`/projects/${projectId}/members/me`)
      setAsking(false)
      await onLeft()
    } catch (error) {
      setMessage(explainApiError(error))
      setAsking(false)
    } finally {
      setBusy(false)
    }
  }

  const lead = rank !== 'MEMBER'
  const rankWord = rank === 'PROJECT_LEAD' ? 'project lead' : 'team lead'

  return (
    <span className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => {
          setAsking(true)
        }}
        disabled={busy}
        className="text-faint hover:text-error cursor-pointer font-mono text-[11px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-60"
      >
        LEAVE THIS PROJECT
      </button>

      <span role="status" className="text-error text-[12px]">
        {message}
      </span>

      {asking && (
        <ConfirmDialog
          title={
            lead
              ? `Leave ${projectTitle} as its ${rankWord}?`
              : `Leave ${projectTitle}?`
          }
          confirmLabel="LEAVE THE PROJECT"
          busy={busy}
          onConfirm={() => void leave()}
          onDismiss={() => {
            setAsking(false)
          }}
        >
          {lead ? (
            <>
              <p>
                You are the <strong>{rankWord}</strong> here. Leaving gives that
                up — an officer would have to appoint you again.
                {rank === 'TEAM_LEAD' &&
                  teamName &&
                  ` Your seat on ${teamName} goes with it.`}
              </p>
              {rank === 'PROJECT_LEAD' && (
                <p>
                  This project would be left with <strong>no lead</strong>, and
                  only an officer could run it until one is appointed.
                </p>
              )}
              <p>
                Your standing in the club doesn't change, and you can join again
                while the project is taking people.
              </p>
            </>
          ) : (
            <>
              <p>
                You'd come off this project's roster, and off any team inside
                it. Your standing in the club doesn't change, and you can join
                again while the project is taking people.
              </p>
            </>
          )}
        </ConfirmDialog>
      )}
    </span>
  )
}

