import { useCallback, useEffect, useId, useState } from 'react'
import { useOutletContext } from 'react-router'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import { DuesLocked } from '../../components/dashboard/DuesLocked'
import { OfficerOnly } from '../../components/dashboard/OfficerOnly'
import { isOfficer } from '../../lib/auth/session'
import { ConfirmDialog } from '../../components/shared/ConfirmDialog'
import { MemberSearch } from '../../components/shared/MemberSearch'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  labelClass,
} from '../../components/shared/formChrome'
import { deleteJson, getJson, patchJson, postJson } from '../../lib/api/api'
import type {
  ApiBoardSeat,
  ApiOfficerDesk,
  ApiOfficerMember,
  ApiProject,
  ApiProjectTeamView,
  OfficerPosition,
  DuesPlan,
} from '../../lib/api/api'
import { explainApiError } from '../../lib/api/apiErrors'
import { seatLabel } from '../../lib/officerTerms'
import { duesLocked, formatDate } from '../../lib/dues/dues'
import { useApi } from '../../lib/api/useApi'

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
 * `server/src/discord/discordOfficers.ts`); admin is a human in Prisma Studio. A
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

  if (!isOfficer(user.role)) {
    return <OfficerOnly eyebrow="/ MANAGE · ROLES" why="Granting membership and appointing leads is board business." />
  }

  return (
    <>
      <FormEyebrow>/ MANAGE · ROLES</FormEyebrow>
      <FormHeading>Who runs what.</FormHeading>

      {/* Four decisions of the same shape, and an officer opens this page to
          make one of them — they are not steps. Side by side wherever there is
          room, so appointing a lead does not mean scrolling past the board.
          `items-start`: the seat panel is eight chairs and a checklist, the
          three around it are a picker and two buttons. */}
      <div className="grid-fluid items-start gap-5 [--col-min:29rem]">
        <GrantMembership />
        <OfficerSeats />
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
  'btn btn-outline h-auto min-h-0 border-base-content/28 px-5 py-2.5 text-[12px] font-semibold text-base-content hover:border-base-content hover:bg-base-content/6 hover:text-base-content disabled:opacity-60'

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
        payment would, and records that you granted it.
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
            It will show in their dues history with your name on it. Undoing
            it means editing the database by hand.
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
        A team lead runs one team inside one project, so both have to be
        named.
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

/**
 * Who sits in which chair on the officer board.
 *
 * The last of the four decisions that were a Prisma Studio edit — the same
 * argument that brought granting a term and appointing a lead onto this desk.
 *
 * **The seat is not the club role, and this panel says so out loud.** Discord
 * decides *that* somebody is an officer and the site follows within a request;
 * an officer decides *which seat* they hold, here. That split is why the panel
 * can seat the faculty advisor, who is a plain member, and why it can seat an
 * admin — `UserRole` has one slot per person with `ADMIN` above `OFFICER`, so
 * the ladder could never have said "both".
 *
 * It lists the whole board rather than only offering a picker, because the
 * question anybody arrives with is "who is where at the moment", and a form
 * with no answer on screen is one you fill in twice.
 */
function OfficerSeats() {
  const id = useId()
  const [desk, setDesk] = useState<ApiOfficerDesk | null>(null)
  const [failed, setFailed] = useState(false)
  const [member, setMember] = useState<ApiOfficerMember | null>(null)
  const [position, setPosition] = useState<OfficerPosition | ''>('')
  const [standingDown, setStandingDown] = useState<ApiBoardSeat | null>(null)
  const [displacing, setDisplacing] = useState<ApiBoardSeat | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message>(null)

  // The desk owns its own loader rather than `useApi`, which has no refetch —
  // every write here changes the list directly above the form.
  const reload = useCallback(() => {
    getJson<ApiOfficerDesk>('/officer/terms')
      .then((answer) => {
        setDesk(answer)
        setFailed(false)
      })
      .catch(() => {
        setFailed(true)
      })
  }, [])

  useEffect(reload, [reload])

  const seatOf = (seat: ApiBoardSeat) =>
    seat.position ? seatLabel(seat.position) : 'No seat yet'

  /**
   * Rotation day's work list, and the reason it is at the top of the panel.
   *
   * Flipping the Discord roles gives the club a board of officers with no
   * chairs and a page of empty seats, and nothing anywhere says so — the front
   * page just reads "Seat open" eight times until somebody notices. These two
   * numbers *are* the handover checklist.
   */
  const rows = desk?.board ?? []
  const seatless = rows.filter((seat) => seat.position === null)
  const taken = new Set(rows.map((seat) => seat.position))
  // Every seat there is, from the enum by way of the route — the desk is where
  // an empty chair gets filled, so it needs the whole list rather than the
  // occupied ones, and how many there are is the database's answer.
  const empty = (desk?.seats ?? []).filter((seat) => !taken.has(seat))

  /** Who is in the chair being handed out, if anybody. Read from the list the
      panel already has, so the confirmation can name them before anything is
      sent — the server checks again regardless. */
  const incumbent =
    position === ''
      ? null
      : (rows.find(
          (seat) => seat.position === position && seat.user?.id !== member?.id,
        ) ?? null)

  const save = (takeOver = false) => {
    if (!member) return

    setDisplacing(null)
    setBusy(true)
    setMessage(null)

    patchJson<ApiBoardSeat>('/officer/terms/seat', {
      userId: member.id,
      position: position === '' ? null : position,
      takeOver,
    })
      .then((saved) => {
        setMessage({
          tone: 'success',
          text:
            position === ''
              ? `${member.fullName} is on the board without a named seat.`
              : saved.succeeded
                ? `${member.fullName} is now ${seatLabel(position)}, succeeding ${saved.succeeded}.`
                : `${member.fullName} is now ${seatLabel(position)}.`,
        })
        setMember(null)
        setPosition('')
        reload()
      })
      .catch((error: unknown) => {
        setMessage({ tone: 'error', text: explain(error) })
      })
      .finally(() => {
        setBusy(false)
      })
  }

  /** Ask first where the chair is occupied. The server refuses a take-over that
      was not asked for, so this is the only way to displace anybody. */
  const submit = () => {
    if (incumbent) setDisplacing(incumbent)
    else save()
  }

  const standDown = (seat: ApiBoardSeat) => {
    setStandingDown(null)

    if (!seat.user) return

    setBusy(true)
    setMessage(null)

    deleteJson(`/officer/terms/${seat.user.id}`)
      .then(() => {
        setMessage({
          tone: 'success',
          text: `${seat.fullName} has been stood down. They are on the officers page now.`,
        })
        reload()
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
      <p className={panelLabel}>THE OFFICER BOARD</p>
      <p className="text-dim mb-4 text-[13px] leading-[1.6] text-pretty">
        Which chair each person holds. Being <em>an officer</em> follows the
        Discord role and is not set here, so a seat can go to somebody who is
        not one &mdash; that is how the faculty advisor sits on the board.
      </p>

      {failed && (
        <p className="text-dim mb-4 text-[13px] leading-[1.6]">
          We couldn&rsquo;t load the board just now. The form below still works.
        </p>
      )}

      {/* Only when there is something to do. A line reading "0 officers with no
          seat" every other day of the year is a line nobody reads on the one
          day it matters. */}
      {desk && (seatless.length > 0 || empty.length > 0) && (
        <div className="border-primary/35 bg-primary/5 mb-5 border p-4">
          <p className="text-primary mb-1.5 font-mono text-[10px] font-medium tracking-[0.16em]">
            STILL TO DO
          </p>
          <p className="text-dim text-[13px] leading-[1.6] text-pretty">
            {seatless.length > 0 && (
              <>
                <strong className="font-semibold text-base-content">
                  {seatless.length}
                </strong>{' '}
                {seatless.length === 1 ? 'officer has' : 'officers have'} no seat
                {seatless.length <= 4 && (
                  <> &mdash; {seatless.map((seat) => seat.fullName).join(', ')}</>
                )}
                .{' '}
              </>
            )}
            {empty.length > 0 && (
              <>
                <strong className="font-semibold text-base-content">
                  {empty.length}
                </strong>{' '}
                {empty.length === 1 ? 'seat is' : 'seats are'} empty
                {empty.length <= 4 && (
                  <> &mdash; {empty.map((seat) => seatLabel(seat)).join(', ')}</>
                )}
                .
              </>
            )}
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <ul className="border-rule mb-5 divide-y divide-[var(--color-rule)] border-y">
          {rows.map((seat) => (
            <li
              key={seat.id}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold">
                  {seat.fullName}
                </p>
                <p className="text-faint font-mono text-[10px] tracking-[0.14em] uppercase">
                  {seatOf(seat)}
                  {/* Where the seat came from. A hand-given one survives losing
                      the Discord role and a synced one does not, which is the
                      difference between "why is the advisor still here" and a
                      bug. */}
                  {seat.source === 'MANUAL' && ' · by hand'}
                </p>
              </div>

              <button
                type="button"
                className={secondaryButton}
                disabled={busy || !seat.user}
                onClick={() => {
                  setStandingDown(seat)
                }}
              >
                STAND DOWN
              </button>
            </li>
          ))}
        </ul>
      )}

      {desk && rows.length === 0 && (
        <p className="text-faint mb-5 text-[13px]">
          Nobody is on the board yet.
        </p>
      )}

      <div className="space-y-4">
        <MemberSearch
          picked={member}
          onPick={setMember}
          disabled={busy}
          label="WHO IS TAKING A SEAT"
        />

        <div>
          <label htmlFor={`${id}-seat`} className={labelClass}>
            WHICH SEAT
          </label>
          <select
            id={`${id}-seat`}
            className={selectClass}
            value={position}
            disabled={busy}
            onChange={(event) => {
              setPosition(event.target.value as OfficerPosition | '')
            }}
          >
            {/* Empty is a real choice, not a prompt: somebody can be on the
                board without a named chair, which is what the Discord sync
                creates before anybody has been given one. */}
            <option value="">No named seat</option>
            {(desk?.seats ?? []).map((seat) => (
              <option key={seat} value={seat}>
                {seatLabel(seat)}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className={primaryButton}
          disabled={busy || !member}
          onClick={submit}
        >
          {busy ? 'SAVING…' : incumbent ? 'TAKE THE SEAT' : 'SET THE SEAT'}
        </button>

        <Status message={message} />
      </div>

      {displacing && member && (
        <ConfirmDialog
          title={`Hand ${seatLabel(displacing.position!)} to ${member.fullName}?`}
          confirmLabel="HAND IT OVER"
          tone="primary"
          busy={busy}
          onConfirm={() => {
            save(true)
          }}
          onDismiss={() => {
            setDisplacing(null)
          }}
        >
          <p>
            {displacing.fullName}&rsquo;s term ends and they move to the
            officers page, recorded as succeeded by {member.fullName}.
          </p>
          {/* The same warning the stand-down dialog gives, for the same reason:
              this changes the chair, not the club role, and Discord owns the
              second one. */}
          {displacing.source === 'DISCORD' && (
            <p className="mt-3">
              {displacing.fullName} still carries the officer role in Discord,
              so they stay on the board without a seat. Take the role away there
              if they are leaving altogether.
            </p>
          )}
        </ConfirmDialog>
      )}

      {standingDown && (
        <ConfirmDialog
          title={`Stand ${standingDown.fullName} down?`}
          confirmLabel="STAND DOWN"
          busy={busy}
          onConfirm={() => {
            standDown(standingDown)
          }}
          onDismiss={() => {
            setStandingDown(null)
          }}
        >
          <p>
            They come off the board and onto the officers page as a past
            officer, with the dates they served.
          </p>
          {/* The one thing that makes this look broken if unsaid: the sync is
              the club's answer about who is an officer, and this button does
              not overrule it. */}
          {standingDown.source === 'DISCORD' && (
            <p className="mt-3">
              They still carry the officer role in Discord, so the next sync
              will put them straight back. Take the role away there first if
              that is not what you want.
            </p>
          )}
        </ConfirmDialog>
      )}
    </FormPanel>
  )
}


