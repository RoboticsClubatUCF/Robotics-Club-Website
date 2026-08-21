import { useCallback, useEffect, useId, useState } from 'react'
import { useOutletContext } from 'react-router'
import type { DashboardContext } from '../components/dashboard/DashboardLayout'
import { DuesLocked } from '../components/dashboard/DuesLocked'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { MemberSearch } from '../components/shared/MemberSearch'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  labelClass,
} from '../components/shared/formChrome'
import { getJson, patchJson, postJson } from '../lib/api'
import type {
  ApiOfficerMember,
  ApiProject,
  ApiProjectTeamView,
  DuesPlan,
} from '../lib/api'
import { explainApiError } from '../lib/apiErrors'
import { duesLocked, formatDate } from '../lib/dues'
import { useApi } from '../lib/useApi'

/**
 * The roles desk: who is what, and who runs what.
 *
 * One page for the decisions that are about *people* rather than about things.
 * They were scattered before — appointing a project lead lived on the projects
 * desk beside creating projects, appointing a team lead was only reachable from
 * inside one project's own manage page, and giving somebody a term was a date
 * typed into Prisma Studio. Three questions of the same shape, in three places,
 * one of which was not in the site at all.
 *
 * **What is not here, and why.** Club role — `OFFICER`, `ADMIN` — cannot be set
 * from this page and there is no panel missing. The board is appointed in
 * Discord and the site follows the role automatically (see
 * `server/src/discordOfficers.ts`); admin is a human in Prisma Studio. A
 * control here would be a second answer to a question that already has one, and
 * the sweep would overwrite it within ten minutes.
 *
 * Every check on this page is presentation. The server re-checks on every
 * request regardless of who finds the URL, and it is the one that decides.
 */
export function OfficerRolesPage() {
  const { user, membership } = useOutletContext<DashboardContext>()

  // Dues before role, because a lapsed officer *is* an officer and the sentence
  // they need is about a payment rather than about the board.
  if (duesLocked(membership, user.role)) {
    return <DuesLocked eyebrow="/ MANAGE · ROLES" />
  }

  const officer = user.role === 'ADMIN' || user.role === 'OFFICER'

  if (!officer) {
    return (
      <>
        <FormEyebrow>/ MANAGE · ROLES</FormEyebrow>
        <FormHeading>This desk belongs to the officers.</FormHeading>
        <FormPanel>
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            Granting membership and appointing leads is board business. If you
            think you should be able to do this, talk to an officer.
          </p>
        </FormPanel>
      </>
    )
  }

  return (
    <>
      <FormEyebrow>/ MANAGE · ROLES</FormEyebrow>
      <FormHeading>Who runs what.</FormHeading>

      <div className="space-y-5">
        <GrantMembership />
        <AppointLead />
        <AppointTeamLead />
      </div>
    </>
  )
}

const panelLabel =
  'text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]'
const selectClass = 'select border-rule bg-base-200 w-full text-sm'
const primaryButton =
  'btn btn-primary btn-cta px-5 py-2.5 text-[12px] font-semibold disabled:opacity-60'
const secondaryButton =
  'btn btn-outline h-auto min-h-0 border-white/28 px-5 py-2.5 text-[12px] font-semibold text-white hover:border-white hover:bg-white/6 hover:text-white disabled:opacity-60'

const explain = (error: unknown) =>
  explainApiError(error, {
    forbidden: 'The server does not agree you are an officer.',
  })

type Message = { tone: 'error' | 'success'; text: string } | null

/** The one status line every panel here renders, always present so nothing
    below it moves when it fills. */
function Status({ message }: { message: Message }) {
  return (
    <p role="status" className="min-h-4 text-[13px]">
      {message && (
        <span
          className={message.tone === 'error' ? 'text-error' : 'text-success'}
        >
          {message.text}
        </span>
      )}
    </p>
  )
}

/**
 * Giving somebody a term, with no money involved.
 *
 * The cash-at-a-meeting case, and the scholarship case, and the officer whose
 * dues the board waives. All three were being handled by typing a date into
 * `dues_paid_through` in Prisma Studio, which covers the person and does
 * nothing else: no `GUEST` promotion, no `joinedAt`, and no record of who
 * decided. This goes through the same three rules a card payment does.
 *
 * The standing of whoever is picked is printed *before* the button, because
 * granting a term to somebody already paid through spring is not harmful — it
 * extends rather than resets — but it is a decision made blind otherwise.
 */
function GrantMembership() {
  const id = useId()
  const [member, setMember] = useState<ApiOfficerMember | null>(null)
  const [plan, setPlan] = useState<DuesPlan>('SEMESTER')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message>(null)

  const grant = () => {
    if (!member) return

    setConfirming(false)
    setBusy(true)
    setMessage(null)

    postJson<{ paidThrough: string | null }>(
      `/officer/members/${member.id}/membership`,
      { plan },
    )
      .then((result) => {
        setMessage({
          tone: 'success',
          text: result.paidThrough
            ? `${member.fullName} is covered through ${formatDate(result.paidThrough)}.`
            : `${member.fullName} has been granted a ${plan.toLowerCase()}.`,
        })
        setMember(null)
      })
      .catch((error: unknown) => {
        setMessage({ tone: 'error', text: explain(error) })
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <FormPanel>
      <p className={panelLabel}>GRANT A MEMBERSHIP</p>
      <p className="text-dim mb-4 text-[13px] leading-[1.6] text-pretty">
        For dues paid in cash, or waived. It covers them exactly as a card
        payment would, promotes a guest to a member, and records that you were
        the one who granted it.
      </p>

      <div className="space-y-4">
        <MemberSearch
          picked={member}
          onPick={setMember}
          disabled={busy}
          label="WHO IS BEING COVERED"
        />

        {/* Where they stand right now. Only once somebody is picked, because
            before that it would be a line about nobody. */}
        {member && (
          <p className="text-faint text-[12px] leading-[1.5]">
            {member.duesPaidThrough
              ? `Currently covered through ${formatDate(member.duesPaidThrough)} — this extends it.`
              : 'No dues on record. This is their first term.'}
          </p>
        )}

        <div>
          <label htmlFor={`${id}-plan`} className={labelClass}>
            HOW LONG
          </label>
          <select
            id={`${id}-plan`}
            className={selectClass}
            value={plan}
            disabled={busy}
            onChange={(event) => {
              setPlan(event.target.value as DuesPlan)
            }}
          >
            <option value="SEMESTER">One semester</option>
            <option value="YEAR">A year — this term and the next</option>
          </select>
        </div>

        <button
          type="button"
          disabled={busy || !member}
          onClick={() => {
            setConfirming(true)
          }}
          className={primaryButton}
        >
          GRANT IT
        </button>

        <Status message={message} />
      </div>

      {/* The shared dialog rather than `window.confirm`, like the other officer
          desks. This one is worth confirming: it is the club's money, and the
          only way back is another officer editing the database. */}
      {confirming && member && (
        <ConfirmDialog
          title={`Grant ${member.fullName} a ${plan === 'YEAR' ? 'year' : 'semester'}?`}
          confirmLabel="GRANT IT"
          tone="primary"
          busy={busy}
          onConfirm={grant}
          onDismiss={() => {
            setConfirming(false)
          }}
        >
          <p>
            They will be covered as though they had paid, and it will show in
            their dues history with your name on it. Undoing it means an officer
            editing the database by hand.
          </p>
        </ConfirmDialog>
      )}
    </FormPanel>
  )
}

/**
 * Appointing and standing down project leads.
 *
 * **It refuses rather than swaps.** Appointing over a sitting lead is a 409
 * naming them, and the officer presses DEMOTE first. Which of two people runs a
 * build is not something the site should decide by inferring it from a click.
 *
 * Moved here from the projects desk, where it sat beside the create form and a
 * second, half-hidden way to do the same thing.
 */
function AppointLead() {
  const id = useId()
  const projects = useApi<ApiProject[]>('/projects?limit=100')
  const [member, setMember] = useState<ApiOfficerMember | null>(null)
  const [projectId, setProjectId] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message>(null)

  const setRank = (rank: 'PROJECT_LEAD' | 'MEMBER') => {
    if (!member || !projectId) {
      setMessage({ tone: 'error', text: 'Pick a project and a member first.' })
      return
    }

    setBusy(true)
    setMessage(null)
    patchJson(`/officer/projects/${projectId}/members/${member.id}/rank`, {
      rank,
    })
      .then(() => {
        setMessage({
          tone: 'success',
          text:
            rank === 'PROJECT_LEAD'
              ? `${member.fullName} now leads this project.`
              : `${member.fullName} is a regular member of this project now.`,
        })
      })
      .catch((error: unknown) => {
        setMessage({ tone: 'error', text: explain(error) })
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <FormPanel>
      <p className={panelLabel}>APPOINT OR STAND DOWN A PROJECT LEAD</p>

      <div className="space-y-4">
        <div>
          <label htmlFor={`${id}-project`} className={labelClass}>
            PROJECT
          </label>
          <ProjectOptions
            id={`${id}-project`}
            projects={projects}
            value={projectId}
            disabled={busy}
            onChange={setProjectId}
          />
        </div>

        <MemberSearch picked={member} onPick={setMember} disabled={busy} />

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setRank('PROJECT_LEAD')
            }}
            className={primaryButton}
          >
            MAKE PROJECT LEAD
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setRank('MEMBER')
            }}
            className={secondaryButton}
          >
            DEMOTE TO MEMBER
          </button>
        </div>

        <Status message={message} />
      </div>
    </FormPanel>
  )
}

/**
 * Appointing team leads, which used to be reachable only from inside one
 * project's own manage page.
 *
 * **No new endpoint.** This is `PATCH /api/projects/:id/members/:userId`, the
 * route the lead uses, which officers reach as readily because
 * `requireProjectLead` returns early for them.
 *
 * The member comes from a `<select>` of the project's existing roster rather
 * than from the people-picker, and that is not a shortcut — it is what makes
 * the two rules the route enforces reachable. It 404s for somebody who is not
 * on the project, and refuses outright if the target is the project lead, so a
 * free-text search here would mostly produce errors that were the picker's
 * fault. A team lead is also pinned to a team, so both selects are required.
 */
function AppointTeamLead() {
  const id = useId()
  const projects = useApi<ApiProject[]>('/projects?limit=100')
  const [projectId, setProjectId] = useState('')
  const [teamId, setTeamId] = useState('')
  const [userId, setUserId] = useState('')
  const [team, setTeam] = useState<ApiProjectTeamView | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message>(null)

  const load = useCallback((project: string) => {
    if (!project) {
      setTeam(null)
      return
    }

    setLoading(true)
    getJson<ApiProjectTeamView>(`/projects/${project}/team`)
      .then((view) => {
        setTeam(view)
      })
      .catch((error: unknown) => {
        setTeam(null)
        setMessage({ tone: 'error', text: explain(error) })
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    // Hand-rolled rather than `useApi`, because the roster below has to be
    // re-read after an appointment — otherwise the select keeps describing the
    // project as it was before the click.
    load(projectId)
    setTeamId('')
    setUserId('')
  }, [projectId, load])

  const setRank = (rank: 'TEAM_LEAD' | 'MEMBER') => {
    if (!projectId || !userId || (rank === 'TEAM_LEAD' && !teamId)) {
      setMessage({
        tone: 'error',
        text:
          rank === 'TEAM_LEAD'
            ? 'Pick a project, a team and a member first.'
            : 'Pick a project and a member first.',
      })
      return
    }

    const person = team?.members.find((row) => row.userId === userId)

    setBusy(true)
    setMessage(null)
    // `teamId: null` on the way down as well as `rank`: a demoted team lead
    // keeps their seat on the team otherwise, and the server's own rule is that
    // a rank set here is the whole answer rather than a layer over the old one.
    patchJson(`/projects/${projectId}/members/${userId}`, {
      rank,
      ...(rank === 'TEAM_LEAD' ? { teamId } : {}),
    })
      .then(() => {
        const name = person?.fullName ?? 'They'
        setMessage({
          tone: 'success',
          text:
            rank === 'TEAM_LEAD'
              ? `${name} now leads ${team?.teams.find((row) => row.id === teamId)?.name ?? 'that team'}.`
              : `${name} is a regular member of this project now.`,
        })
        load(projectId)
      })
      .catch((error: unknown) => {
        setMessage({ tone: 'error', text: explain(error) })
      })
      .finally(() => {
        setBusy(false)
      })
  }

  const roster = team?.members ?? []

  return (
    <FormPanel>
      <p className={panelLabel}>APPOINT OR STAND DOWN A TEAM LEAD</p>
      <p className="text-dim mb-4 text-[13px] leading-[1.6] text-pretty">
        A team lead runs one team inside one project, so both have to be named.
        The project&rsquo;s own lead can do this too, from their manage page.
      </p>

      <div className="space-y-4">
        <div>
          <label htmlFor={`${id}-project`} className={labelClass}>
            PROJECT
          </label>
          <ProjectOptions
            id={`${id}-project`}
            projects={projects}
            value={projectId}
            disabled={busy}
            onChange={setProjectId}
          />
        </div>

        <div>
          <label htmlFor={`${id}-team`} className={labelClass}>
            TEAM
          </label>
          <select
            id={`${id}-team`}
            className={selectClass}
            value={teamId}
            disabled={busy || loading || !team}
            onChange={(event) => {
              setTeamId(event.target.value)
            }}
          >
            <option value="">
              {!projectId
                ? 'Pick a project first'
                : loading
                  ? 'Loading…'
                  : team && team.teams.length === 0
                    ? 'This project has no teams yet'
                    : 'Pick a team'}
            </option>
            {team?.teams.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${id}-member`} className={labelClass}>
            MEMBER
          </label>
          <select
            id={`${id}-member`}
            className={selectClass}
            value={userId}
            disabled={busy || loading || !team}
            onChange={(event) => {
              setUserId(event.target.value)
            }}
          >
            <option value="">
              {!projectId
                ? 'Pick a project first'
                : loading
                  ? 'Loading…'
                  : roster.length === 0
                    ? 'Nobody has joined this project yet'
                    : 'Pick a member'}
            </option>
            {roster.map((row) => (
              <option key={row.userId} value={row.userId}>
                {row.fullName}
                {row.rank === 'PROJECT_LEAD'
                  ? ' — project lead'
                  : row.rank === 'TEAM_LEAD'
                    ? ` — leads ${team?.teams.find((t) => t.id === row.teamId)?.name ?? 'a team'}`
                    : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setRank('TEAM_LEAD')
            }}
            className={primaryButton}
          >
            MAKE TEAM LEAD
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setRank('MEMBER')
            }}
            className={secondaryButton}
          >
            DEMOTE TO MEMBER
          </button>
        </div>

        <Status message={message} />
      </div>
    </FormPanel>
  )
}

/**
 * The project `<select>`, shared by both appointment panels.
 *
 * Every project, not just this term's: appointing a lead for next semester's
 * build before the term starts is ordinary, and so is fixing last term's roster
 * after the fact. The term is printed beside the title because a build that
 * runs for years is several rows with one name, and picking the wrong one would
 * otherwise be invisible.
 */
function ProjectOptions({
  id,
  projects,
  value,
  disabled,
  onChange,
}: {
  id: string
  projects: ReturnType<typeof useApi<ApiProject[]>>
  value: string
  disabled: boolean
  onChange: (id: string) => void
}) {
  return (
    <select
      id={id}
      className={selectClass}
      value={value}
      disabled={disabled || projects.status !== 'ready'}
      onChange={(event) => {
        onChange(event.target.value)
      }}
    >
      <option value="">
        {projects.status === 'loading'
          ? 'Loading…'
          : projects.status === 'error'
            ? "Couldn't load the list"
            : 'Pick a project'}
      </option>
      {projects.status === 'ready' &&
        projects.data.map((project) => (
          <option key={project.id} value={project.id}>
            {project.title} — {seasonOf(project)}
          </option>
        ))}
    </select>
  )
}

const SEASON_LABEL = { SPRING: 'Spring', SUMMER: 'Summer', FALL: 'Fall' }

const seasonOf = (project: ApiProject) =>
  `${SEASON_LABEL[project.termSeason]} ${project.termYear}`
