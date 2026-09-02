import { useId, useState } from 'react'
import { Link, useOutletContext } from 'react-router'
import { DuesLocked } from '../../components/dashboard/DuesLocked'
import { OfficerOnly } from '../../components/dashboard/OfficerOnly'
import { isOfficer } from '../../lib/auth/session'
import { duesLocked } from '../../lib/dues/dues'
import type { DashboardContext } from '../../components/dashboard/DashboardLayout'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  fieldClass,
  labelClass,
} from '../../components/shared/formChrome'
import { DraftGallery } from '../../components/projects/DraftGallery'
import { LinkRows } from '../../components/projects/LinkRows'
import { ProjectEditor } from '../../components/projects/ProjectEditor'
import { useUnsavedGuard } from '../../components/projects/useUnsavedGuard'
import { ConfirmDialog } from '../../components/shared/ConfirmDialog'
import { deleteJson, postJson } from '../../lib/api/api'
import type {
  ApiManagedProject,
  ApiProject,
  ApiProjectDetail,
  ApiProjectImage,
  ApiProjectLink,
} from '../../lib/api/api'
import { explainApiError } from '../../lib/api/apiErrors'
import { WEEKDAY_SHORT } from '../../lib/events/meetings'
import {
  publishDraft,
  usableLinks,
  type DraftImage,
  type DraftLink,
} from '../../lib/projects/projectDraft'
import { useApi } from '../../lib/api/useApi'

/**
 * The projects desk: starting one, running last term's again, and reaching the
 * management page of any of them.
 *
 * Both live here rather than on a project's own manage page because both are
 * decisions that stay with the board — which projects the club runs. Everything
 * after that point belongs to the lead.
 *
 * **Appointing that lead used to be here and is not any more.** It sat on this
 * page twice over, as a field inside the create form and as a panel underneath
 * it, and it is a decision about a *person* rather than about a project. It is
 * one panel on the roles desk now, `/dashboard/officer/roles`, beside the other
 * two questions of the same shape.
 *
 * **Officers and admins, and nobody else.** It briefly had a second audience:
 * somebody carrying a `PROJECT_LEAD` roster label could start one project of
 * their own. That label is not a role any more — leading a project is a fact
 * about a membership row against one project — and the delegation went with it.
 * Running a project confers nothing here, which is the point: authority *inside*
 * a project and permission to make another are different things, and the second
 * is the board's.
 *
 * Every role check on this page is presentation only. The server re-checks on
 * every request regardless of who finds the URL, and it is the one that decides.
 */

const explain = (error: unknown) =>
  explainApiError(error, {
    forbidden: 'The server does not agree you are an officer.',
  })

export function OfficerProjectsPage() {
  const { user, membership } = useOutletContext<DashboardContext>()

  // Dues before role, because a lapsed officer *is* an officer and the
  // sentence they need is about a payment rather than about the board.
  if (duesLocked(membership, user.role)) {
    return <DuesLocked eyebrow="/ MANAGE · PROJECTS" />
  }

  if (!isOfficer(user.role)) {
    return <OfficerOnly eyebrow="/ MANAGE · PROJECTS" why="Deciding which projects the club runs is board business." />
  }

  return (
    <>
      <FormEyebrow>/ MANAGE · PROJECTS</FormEyebrow>
      <FormHeading>Projects.</FormHeading>

      {/* Two ways to end up with a project, and an officer is doing one of
          them — a new build, or last term's again. Side by side once there is
          genuinely room for both, which is what the high `--col-min` is for:
          the create panel turns into the full project editor the moment it is
          pressed, and half a laptop is not enough for that. `items-start`,
          since the panel beside it is four fields. */}
      <div className="grid-fluid items-start gap-5 [--col-min:34rem]">
        <CreateProject />
        <DuplicateProject />
        <EveryProject />
      </div>
    </>
  )
}

/**
 * Creating a project, then setting its page up without leaving the desk.
 *
 * Two steps rather than one form, because the second half genuinely cannot
 * happen first: **a picture and a link hang off a project id**, and there is no
 * id until the project exists.
 *
 * So the split is drawn as narrowly as that constraint actually is, rather than
 * around the whole form. Everything typeable before the project exists is on the
 * page from the start and goes up *with* it — the write-up and the repository
 * included, which is why `POST /officer/projects` takes those two columns. Only
 * the gallery and the resource links are gated, they are drawn in place under
 * their own eyebrows while they wait, and each says in one line what it is
 * waiting for. Pressing CREATE unlocks them where they already are.
 *
 * The panel after that is `ProjectEditor` — the same editor the public page
 * carries, not a second copy — laid out in the same order under the same
 * labels, so what changes is that two sections come alive and the button reads
 * SAVE CHANGES. Nothing moves.
 *
 * **It says the project is already live, and offers to delete it.** That is the
 * price of the one seam that is left: somebody who walks away mid-setup would
 * otherwise leave an empty project on the public site with nothing to say so.
 */
function CreateProject() {
  const [created, setCreated] = useState<Created | null>(null)

  if (created) {
    return (
      <SetUpProject
        created={created}
        onFinished={() => {
          setCreated(null)
        }}
      />
    )
  }

  return <CreateForm onCreated={setCreated} />
}

/**
 * What the create press produced: the project, plus the parts of it the create
 * response does not carry back.
 *
 * `description` is here because it is deliberately **not** in
 * `managedProjectSelect` — that shape feeds `/me/projects`, which every
 * dashboard page loads, and a 20,000-character column on every project somebody
 * is on is a payload nobody asked for. The form sent it, so the form hands it
 * over. `images` and `links` are what `publishDraft` landed, and `failures` is
 * what it could not — named rather than swallowed, because by then the project
 * exists and silence would read as everything having worked.
 */
type Created = {
  project: ApiManagedProject
  description: string | null
  mine: boolean
  images: ApiProjectImage[]
  links: ApiProjectLink[]
  failures: string[]
}

function CreateForm({ onCreated }: { onCreated: (created: Created) => void }) {
  const id = useId()
  const [links, setLinks] = useState<DraftLink[]>([])
  const [images, setImages] = useState<DraftImage[]>([])
  /**
   * The meeting days, and the only field on this form that is not a plain
   * uncontrolled input. Seven checkboxes are a set rather than a value, and
   * reading them back out of `FormData` would be `getAll` plus a cast — state
   * is what lets the chips draw themselves selected.
   */
  const [days, setDays] = useState<number[]>([])
  const [fault, setFault] = useState('')
  const [state, setState] = useState<
    | { status: 'idle' }
    | { status: 'sending'; step: string }
    | { status: 'failed'; message: string }
  >({ status: 'idle' })

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const form = event.currentTarget
    const data = new FormData(form)
    const value = (name: string) => {
      const raw = data.get(name)
      return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
    }

    const description = value('description')
    const ready = usableLinks(links)

    const from = value('meetingStartTime')
    const to = value('meetingEndTime')

    // Refused here as well as on the server, so somebody who has just typed a
    // page of write-up is not told about a missing checkbox by a round trip.
    // The server refuses all three regardless — see `projectMeeting.ts`.
    if (days.length === 0) {
      setFault('Pick at least one day the project meets.')
      return
    }
    if (!from || !to) {
      setFault('Give the meeting a start and an end time.')
      return
    }
    if (from >= to) {
      setFault('The meeting has to end after it starts.')
      return
    }

    setFault('')
    setState({ status: 'sending', step: 'CREATING…' })
    postJson<ApiManagedProject>('/officer/projects', {
      slug: value('slug'),
      title: value('title'),
      summary: value('summary'),
      season: value('season'),
      competition: value('competition'),
      description,
      repoUrl: value('repoUrl'),
      discordRoleId: value('discordRoleId'),
      // Required by the route, unlike everything above it but the title, slug
      // and summary. A project's meeting time is the one thing a prospective
      // member needs and the one thing nobody ever came back to fill in.
      meetingWeekdays: days,
      meetingStartTime: from,
      meetingEndTime: to,
      meetingLocation: value('meetingLocation'),
      // No lead. Appointing one is the roles desk's job now, and the term is
      // left off so the server stamps the one we are in — which is what an
      // officer creating a project today means every time.
    })
      .then(async (project) => {
        // Past this line the project exists and is public, so nothing below may
        // throw: `publishDraft` catches its own failures and reports them, and
        // the panel drops into the editor either way with whatever landed.
        if (ready.length > 0 || images.length > 0) {
          setState({ status: 'sending', step: 'ADDING THE REST…' })
        }
        const published = await publishDraft(project.id, {
          links: ready,
          images,
        })

        form.reset()
        setDays([])
        setLinks([])
        // Not released: the object URLs belong to the editor's rows now, and
        // `DraftGallery` unmounting is what hands back any that never landed.
        setImages([])
        setState({ status: 'idle' })

        onCreated({
          project,
          description: description ?? null,
          // Nobody is on a new project now, so the editor below always shows
          // the officer banner. It only decides which sentence is printed.
          mine: false,
          ...published,
        })
      })
      .catch((error: unknown) => {
        // Only the create request reaches here. Deliberately no `form.reset()`:
        // the fields keep what was typed, and so do the links and the pictures,
        // so a taken slug is one word to change rather than the whole page again.
        setState({ status: 'failed', message: explain(error) })
      })
  }

  const sending = state.status === 'sending'

  return (
    <FormPanel>
      <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]">
        CREATE A PROJECT
      </p>

      <form onSubmit={submit} className="space-y-4">
        <div className="grid-fluid gap-4 [--col-min:14rem]">
          <div>
            <label htmlFor={`${id}-title`} className={labelClass}>
              TITLE
            </label>
            <input
              id={`${id}-title`}
              name="title"
              required
              maxLength={160}
              placeholder="Mars Rover"
              className={fieldClass}
              disabled={sending}
            />
          </div>
          <div>
            <label htmlFor={`${id}-slug`} className={labelClass}>
              SLUG — THE URL, /projects/…
            </label>
            <input
              id={`${id}-slug`}
              name="slug"
              required
              maxLength={60}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              title="Lowercase words joined by hyphens, like mars-rover"
              placeholder="mars-rover"
              className={fieldClass}
              disabled={sending}
            />
          </div>
        </div>

        <div>
          <label htmlFor={`${id}-summary`} className={labelClass}>
            ONE-LINE SUMMARY
          </label>
          <input
            id={`${id}-summary`}
            name="summary"
            required
            maxLength={500}
            placeholder="Research, design, build and test a Mars rover."
            className={fieldClass}
            disabled={sending}
          />
          {/* Required, and the only one of these four that is: this is the line
              the projects list prints under the title, so a project without one
              is an empty row on the page people browse before joining. */}
          <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
            Printed under the title on the projects list.
          </p>
        </div>

        <div className="grid-fluid gap-4 [--col-min:14rem]">
          <div>
            <label htmlFor={`${id}-season`} className={labelClass}>
              SEASON
            </label>
            <input
              id={`${id}-season`}
              name="season"
              maxLength={40}
              placeholder="2026-2027"
              className={fieldClass}
              disabled={sending}
            />
          </div>
          <div>
            <label htmlFor={`${id}-competition`} className={labelClass}>
              COMPETITION
            </label>
            <input
              id={`${id}-competition`}
              name="competition"
              maxLength={160}
              placeholder="UNIVERSITY ROVER CHALLENGE"
              className={fieldClass}
              disabled={sending}
            />
            {/* The placeholder reads as an example to follow rather than as one
                option, and plenty of what the club builds is not entered into
                anything. Blank sends nothing at all — see `value` in `submit`,
                which is what keeps the create route's optional field optional. */}
            <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
              Optional.
            </p>
          </div>
        </div>

        {/* The schedule, and the one block on this form that refuses to be
            skipped. It sits above the write-up rather than below it because it
            is a fact somebody already knows when they open this page, and the
            write-up is the part they will go away and come back to. */}
        <div className="border-rule border-t pt-5">
          <fieldset>
            <legend className={labelClass}>MEETING DAYS</legend>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_SHORT.map((short, index) => {
                const on = days.includes(index)
                return (
                  <label
                    key={short}
                    className={`focus-within:outline-primary flex min-h-11 cursor-pointer items-center border px-3 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 focus-within:outline-2 focus-within:outline-offset-2 wide:min-h-9 ${
                      on
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-rule text-dim hover:border-primary hover:text-primary'
                    }`}
                  >
                    {/* A real checkbox, hidden with `sr-only` rather than
                        replaced: the accessible name is what a screen reader
                        announces and what the tests query on, and `hidden`
                        would take it out of the tab order too. */}
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      disabled={sending}
                      onChange={() => {
                        setDays(
                          on
                            ? days.filter((each) => each !== index)
                            : [...days, index].sort((a, b) => a - b),
                        )
                        setFault('')
                      }}
                    />
                    {short}
                  </label>
                )
              })}
            </div>
          </fieldset>

          <div className="mt-4 flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor={`${id}-from`} className={labelClass}>
                FROM
              </label>
              <input
                id={`${id}-from`}
                name="meetingStartTime"
                type="time"
                required
                className={`${fieldClass} w-36`}
                disabled={sending}
              />
            </div>
            <div>
              <label htmlFor={`${id}-to`} className={labelClass}>
                TO
              </label>
              <input
                id={`${id}-to`}
                name="meetingEndTime"
                type="time"
                required
                className={`${fieldClass} w-36`}
                disabled={sending}
              />
            </div>
            <div className="min-w-48 flex-1">
              <label htmlFor={`${id}-where`} className={labelClass}>
                WHERE
              </label>
              <input
                id={`${id}-where`}
                name="meetingLocation"
                maxLength={160}
                placeholder="ENG2 Lab"
                className={fieldClass}
                disabled={sending}
              />
            </div>
          </div>

          <p className="text-faint mt-1.5 text-[11px] leading-[1.5] text-pretty">
            Every calendar on the site carries this. It repeats weekly to the
            end of the project&rsquo;s semester, and finals week is left out.
          </p>

          {fault && <p className="text-error mt-2 text-[13px]">{fault}</p>}
        </div>

        <div>
          <label htmlFor={`${id}-description`} className={labelClass}>
            THE WRITE-UP
          </label>
          <textarea
            id={`${id}-description`}
            name="description"
            maxLength={20_000}
            rows={8}
            className="textarea border-rule bg-base-200 w-full text-sm"
            disabled={sending}
          />
          <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
            Leave a blank line between paragraphs. No markdown yet.
          </p>
        </div>

        {/* Same eyebrow the editor uses, in the same place, so this section does
            not appear to arrive from somewhere else once the project exists. */}
        <p className="text-faint pt-2 font-mono text-[13px] font-bold tracking-[0.2em]">
          / RESOURCES
        </p>

        <div>
          <label htmlFor={`${id}-repo`} className={labelClass}>
            SOURCE CODE
          </label>
          <input
            id={`${id}-repo`}
            name="repoUrl"
            type="url"
            maxLength={500}
            placeholder="https://github.com/…"
            className={fieldClass}
            disabled={sending}
          />
        </div>

        <div>
          <label htmlFor={`${id}-discord`} className={labelClass}>
            DISCORD ROLE
          </label>
          <input
            id={`${id}-discord`}
            name="discordRoleId"
            inputMode="numeric"
            pattern="\d{17,20}"
            placeholder="984535585270157362"
            className={fieldClass}
            disabled={sending}
          />
          {/* Worth spelling out that this one does something, because every
              other field on this form is a label. The server checks the id
              against the guild's real roles before saving it — a wrong
              snowflake is not an error at Discord and would otherwise match
              nobody for ever. */}
          <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
            Optional. Everyone on the project is given this Discord role, and
            loses it when they leave. With Developer Mode on, right-click the
            role and Copy Role ID.
          </p>
        </div>

        <LinkRows links={links} disabled={sending} onChange={setLinks} />

        {/* The gallery, inside the form and above the button, because it is
            part of what the button sends. Pictures are held in the browser
            until then — see `DraftGallery`. */}
        <DraftGallery images={images} disabled={sending} onChange={setImages} />

        <div className="border-rule mt-8 border-t pt-6">
          <button
            type="submit"
            disabled={sending}
            className="btn btn-primary btn-cta px-6 py-3 text-[13px] font-semibold disabled:opacity-60"
          >
            {sending ? state.step : 'CREATE PROJECT'}
          </button>

          <p className="text-faint mt-2 text-[12px] leading-[1.5]">
            It goes live at that moment, and can be edited or deleted
            afterwards.
          </p>

          <p role="status" className="min-h-4 text-[13px]">
            {state.status === 'failed' && (
              <span className="text-error">{state.message}</span>
            )}
          </p>
        </div>
      </form>
    </FormPanel>
  )
}

/**
 * What the panel becomes once the press has landed: the project's own page, in
 * place, with everything that was filled in already on it.
 *
 * `ProjectEditor` is reused wholesale rather than reassembled here — it carries
 * the same fields under the same labels in the same order, each backed by a
 * route that re-checks the caller — so **the page does not rearrange itself
 * around the moment of creation**. `writingFirst` keeps the writing where the
 * form's fields were. What changes is that the slug stops being editable and
 * CREATE PROJECT becomes SAVE CHANGES.
 *
 * It is not a second step to complete. Everything was sent by the press; this
 * is where corrections go, and where the undo lives.
 */
function SetUpProject({
  created,
  onFinished,
}: {
  created: Created
  onFinished: () => void
}) {
  // The desk's own context, for the one thing the editor below needs a person
  // for: a document's credit has to start on somebody, and here that is the
  // officer who just made the project.
  const { user } = useOutletContext<DashboardContext>()
  const { project, images, links, failures } = created

  // Assembled rather than re-read. Everything but the write-up comes back in
  // the create response, the write-up comes from the form that sent it, and the
  // gallery and links are what the publish just landed — so a read here would
  // be a round trip to be told what this component was handed.
  const [detail, setDetail] = useState<ApiProjectDetail>({
    ...project,
    description: created.description,
    members: [],
    images,
    links,
    // Always empty here, and deliberately not part of the draft: a document
    // needs a title, a credit and a project to hang off, and this component is
    // the editor that has all three. See `lib/projects/projectDraft.ts`.
    documents: [],
  })
  const [dirty, setDirty] = useState(false)
  const { guard, dialog } = useUnsavedGuard(dirty)
  const [doomed, setDoomed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const discard = () => {
    setBusy(true)
    setMessage('')
    deleteJson(`/projects/${project.id}`)
      .then(() => {
        setDoomed(false)
        onFinished()
      })
      .catch((error: unknown) => {
        setMessage(explain(error))
        setDoomed(false)
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <FormPanel>
      <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]">
        SET UP · {project.title.toUpperCase()}
      </p>

      {/* Said plainly, because it is the one thing about this page that is not
          obvious from looking at it: the project is on the public site already,
          not once somebody presses something else. */}
      <div className="border-primary/35 bg-primary/5 mb-6 border p-4">
        <p className="text-dim text-sm leading-[1.7] text-pretty">
          <strong className="text-base-content">{project.title} is live</strong>
          . It is on the projects list, and changes below appear as you save
          — from here or from{' '}
          <Link
            to={`/projects/${project.slug}`}
            className="text-primary underline underline-offset-2"
          >
            its own page
          </Link>
          , which edits itself.
        </p>
      </div>

      {/* The project was made before these failed, so the panel cannot simply
          show a red line and let somebody assume nothing happened. Named one by
          one, above the editor that can fix them. */}
      {failures.length > 0 && (
        <div className="border-error/40 bg-error/5 mb-6 border p-4">
          <p className="text-base-content mb-2 text-sm leading-[1.7]">
            The project was created, but not all of it went up:
          </p>
          <ul className="text-dim list-disc space-y-1 pl-5 text-[13px] leading-[1.6]">
            {failures.map((failure) => (
              <li key={failure}>{failure}</li>
            ))}
          </ul>
        </div>
      )}

      <ProjectEditor
        project={detail}
        asOfficer={!created.mine}
        me={user}
        writingFirst
        apply={setDetail}
        onDone={guard(onFinished)}
        onDirtyChange={setDirty}
        doneLabel="FINISH — CREATE ANOTHER"
      />

      <div className="border-rule mt-8 border-t pt-5">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setDoomed(true)
          }}
          className="text-faint hover:text-error cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200 disabled:opacity-50"
        >
          DELETE THIS PROJECT
        </button>
        <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
          If it was made by mistake.
        </p>
        <p role="status" className="text-error mt-2 min-h-4 text-[12px]">
          {message}
        </p>
      </div>

      {dialog}

      {doomed && (
        <ConfirmDialog
          title={`Delete ${project.title}?`}
          confirmLabel="DELETE IT"
          busy={busy}
          onConfirm={discard}
          onDismiss={() => {
            setDoomed(false)
          }}
        >
          <p>
            The project comes off the public list, and its lead loses the seat
            they were just given.
          </p>
          <p>Any picture uploaded to it is deleted with it.</p>
        </ConfirmDialog>
      )}
    </FormPanel>
  )
}

/**
 * Running last term's project again this term.
 *
 * The club's builds do not fit in a semester — S.T.O.R.M. and Knightmare run
 * for years — and the dashboard now asks every project which term it belongs
 * to. So a build that carries on is several rows, one per term, rather than one
 * row that quietly never leaves anybody's MY PROJECTS. This is how the next row
 * gets made without retyping a write-up somebody spent an afternoon on.
 *
 * **The writing comes across; the people do not.** Everything descriptive is
 * copied, gallery and resource links included. Members, teams, tasks and events
 * are not: a new term is when people decide again, and a copy that silently
 * re-enrolled last spring's roster would put a project back on the dashboard of
 * somebody who has graduated. They join, and the lead is appointed on the roles
 * desk, the same as any other project.
 *
 * It lands in the same editor the create form ends in, because the first thing
 * anybody does after duplicating is change the summary.
 */
function DuplicateProject() {
  const [created, setCreated] = useState<Created | null>(null)

  if (created) {
    return (
      <SetUpProject
        created={created}
        onFinished={() => {
          setCreated(null)
        }}
      />
    )
  }

  return <DuplicateForm onCreated={setCreated} />
}

const SEASON_LABEL = { SPRING: 'Spring', SUMMER: 'Summer', FALL: 'Fall' }

function DuplicateForm({
  onCreated,
}: {
  onCreated: (created: Created) => void
}) {
  const id = useId()
  const projects = useApi<ApiProject[]>('/projects?limit=100')
  const [sourceId, setSourceId] = useState('')
  const [state, setState] = useState<
    { status: 'idle' } | { status: 'sending' } | { status: 'failed'; message: string }
  >({ status: 'idle' })

  const source =
    projects.status === 'ready'
      ? projects.data.find((project) => project.id === sourceId)
      : undefined

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const data = new FormData(event.currentTarget)
    const value = (name: string) => {
      const raw = data.get(name)
      return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined
    }

    const year = value('termYear')
    const season = value('termSeason')

    setState({ status: 'sending' })
    postJson<ApiManagedProject>(`/officer/projects/${sourceId}/duplicate`, {
      slug: value('slug'),
      title: value('title'),
      season: value('season') ?? null,
      // Left off when blank, like `title` and unlike `season`: nothing sent
      // means the server carries the original's role across, which is what
      // running the same build again almost always wants.
      discordRoleId: value('discordRoleId'),
      // Both or neither — the server refuses a season with no year, because
      // that lands the project in a term nobody chose and it vanishes from
      // every dashboard rather than erroring.
      ...(year && season ? { termYear: Number(year), termSeason: season } : {}),
    })
      .then((project) => {
        setState({ status: 'idle' })
        onCreated({
          project,
          // The copy carries the original's write-up, but the create response
          // does not include `description` — it is not in `managedProjectSelect`
          // — and unlike the create form there is nothing typed here to hand
          // over. The editor re-reads the project, so this only decides what it
          // shows for the instant before that lands.
          description: null,
          mine: false,
          images: [],
          links: [],
          failures: [],
        })
      })
      .catch((error: unknown) => {
        // Nothing is reset: a taken slug is one word to change rather than the
        // whole form again.
        setState({ status: 'failed', message: explain(error) })
      })
  }

  const sending = state.status === 'sending'

  return (
    <FormPanel>
      <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]">
        RUN ONE AGAIN NEXT TERM
      </p>
      <p className="text-dim mb-4 text-[13px] leading-[1.6] text-pretty">
        Copies a project&rsquo;s writing, pictures and links into a new one
        for a new semester. Nobody is carried over.
      </p>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor={`${id}-source`} className={labelClass}>
            COPY FROM
          </label>
          <select
            id={`${id}-source`}
            className="select border-rule bg-base-200 w-full text-sm"
            value={sourceId}
            required
            disabled={sending || projects.status !== 'ready'}
            onChange={(event) => {
              setSourceId(event.target.value)
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
                  {project.title} — {SEASON_LABEL[project.termSeason]}{' '}
                  {project.termYear}
                </option>
              ))}
          </select>
        </div>

        <div className="grid-fluid gap-4 [--col-min:14rem]">
          <div>
            {/* "NEW" on all four of these, because the create panel above is on
                screen at the same time and carries a TITLE, a SLUG and a SEASON
                of its own. Two identical labels on one page is a form somebody
                fills in the wrong half of. */}
            <label htmlFor={`${id}-dup-title`} className={labelClass}>
              NEW TITLE
            </label>
            {/* Keyed on the source so picking a different one refills it: this
                is uncontrolled, and without the key React keeps whatever the
                previous choice put there. */}
            <input
              key={sourceId}
              id={`${id}-dup-title`}
              name="title"
              maxLength={160}
              defaultValue={source?.title ?? ''}
              placeholder="Same as the original"
              className={fieldClass}
              disabled={sending}
            />
          </div>
          <div>
            <label htmlFor={`${id}-dup-slug`} className={labelClass}>
              NEW SLUG — THE URL, /projects/…
            </label>
            <input
              id={`${id}-dup-slug`}
              name="slug"
              required
              maxLength={60}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              title="Lowercase words joined by hyphens, like mars-rover"
              placeholder="mars-rover-2027"
              className={fieldClass}
              disabled={sending}
            />
            {/* The one field with no sensible default. Two projects cannot share
                a URL, so the officer has to say how this one differs. */}
            <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
              Has to be new — the original keeps its own.
            </p>
          </div>
        </div>

        <div className="grid-fluid gap-4 [--col-min:11rem]">
          <div>
            <label htmlFor={`${id}-dup-season`} className={labelClass}>
              NEW SEASON — THE LABEL
            </label>
            <input
              id={`${id}-dup-season`}
              name="season"
              maxLength={40}
              placeholder="2027-2028"
              className={fieldClass}
              disabled={sending}
            />
          </div>
          <div>
            <label htmlFor={`${id}-dup-term-season`} className={labelClass}>
              TERM
            </label>
            <select
              id={`${id}-dup-term-season`}
              name="termSeason"
              className="select border-rule bg-base-200 w-full text-sm"
              defaultValue=""
              disabled={sending}
            >
              <option value="">This term</option>
              <option value="SPRING">Spring</option>
              <option value="SUMMER">Summer</option>
              <option value="FALL">Fall</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-dup-term-year`} className={labelClass}>
              YEAR
            </label>
            <input
              id={`${id}-dup-term-year`}
              name="termYear"
              type="number"
              min={2000}
              max={2100}
              placeholder="This year"
              className={fieldClass}
              disabled={sending}
            />
            {/* The two together or neither: leaving both alone stamps the term
                the club is in, which is what duplicating usually means. */}
            <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
              Leave both blank for the current term.
            </p>
          </div>
        </div>

        <div>
          <label htmlFor={`${id}-dup-discord`} className={labelClass}>
            NEW DISCORD ROLE
          </label>
          {/* Blank carries the original's across, the same rule NEW TITLE
              follows — the same build next semester is the same crew in the
              same channel, which is why the column has no unique index. Left
              empty rather than prefilled because the list this panel reads is
              the *public* one, and a role id has no business on an
              unauthenticated route just to populate a box. Taking a role off a
              copy is done on the project's own manage page. */}
          <input
            id={`${id}-dup-discord`}
            name="discordRoleId"
            inputMode="numeric"
            pattern="\d{17,20}"
            placeholder="Same as the original"
            className={fieldClass}
            disabled={sending}
          />
        </div>

        <button
          type="submit"
          disabled={sending || !sourceId}
          className="btn btn-primary btn-cta w-full px-6 py-3.5 text-[13px] font-semibold disabled:opacity-60"
        >
          {sending ? 'COPYING…' : 'DUPLICATE IT'}
        </button>

        <p role="status" className="min-h-4 text-[13px]">
          {state.status === 'failed' && (
            <span className="text-error">{state.message}</span>
          )}
        </p>
      </form>
    </FormPanel>
  )
}

// ---------------------------------------------------------- every project

/** Calendar order, for sorting. `Season` is declared in this order on the
    server, so a term sorts chronologically as `(termYear, SEASON_ORDER)`. */
const SEASON_ORDER = { SPRING: 0, SUMMER: 1, FALL: 2 }

/** Newest term first, then alphabetical inside a term. */
const byTerm = (a: ApiProject, b: ApiProject) =>
  b.termYear - a.termYear ||
  SEASON_ORDER[b.termSeason] - SEASON_ORDER[a.termSeason] ||
  a.title.localeCompare(b.title)

/**
 * Every project the club has, and the way into managing one.
 *
 * The rail lists the projects you are *on* and draws MANAGE under a lead's
 * rank — and an officer is routinely on none of them. So
 * `/dashboard/projects/:slug/manage` has always handled an officer with no
 * membership row, and until this panel there was no link to it: the only way
 * in was to type the address. This is that link.
 *
 * It points at the lead's own URL rather than an officer-only copy of the page.
 * The board reaches the same page the project's lead reaches, because they are
 * doing the same thing to the same project — and an `officer` segment in a URL
 * a lead is entitled to would be a lie in the address bar.
 *
 * **This semester's builds, and the rest behind a button**, which is the shape
 * `/projects` already uses for the same reason: the club has fifty-odd projects
 * and runs a handful at a time, so a flat list is a long scroll past dead terms
 * to reach the four an officer actually wants. The count sits on the button
 * because "there are more" and "there are fifty-five more" are different
 * things to know before pressing it.
 *
 * Unlike the public page's archive this splits a list it has already fetched
 * rather than making a second request. One `/projects` answer is the whole
 * club, the panel needs the full set to count what it is hiding, and an officer
 * pressing SHOW is not worth a round trip.
 */
function EveryProject() {
  const { membership } = useOutletContext<DashboardContext>()
  const projects = useApi<ApiProject[]>('/projects?limit=100')
  const [pastOpen, setPastOpen] = useState(false)

  const term = membership.status === 'ready' ? membership.data.term : null
  const all = projects.status === 'ready' ? [...projects.data].sort(byTerm) : []

  // **With the term still in flight, nothing is hidden.** The same rule the
  // dues padlocks follow: an unanswered question must not read as "no projects
  // this semester", which is what splitting on a null term would draw.
  const running =
    term === null
      ? all
      : all.filter(
          (project) =>
            project.termYear === term.year &&
            project.termSeason === term.season,
        )
  const earlier = all.filter((project) => !running.includes(project))

  return (
    <FormPanel>
      <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]">
        EVERY PROJECT
      </p>
      <p className="text-dim mb-4 text-[13px] leading-[1.6] text-pretty">
        Teams, members, events and the meeting schedule, on any project &mdash;
        including the ones you are not on. The lead sees the same page.
      </p>

      {projects.status === 'loading' ? (
        <div aria-busy="true" className="bg-base-300 h-24 animate-pulse" />
      ) : projects.status === 'error' ? (
        <p className="text-dim text-sm leading-[1.7]">
          We couldn&rsquo;t load the projects just now. Try again in a moment.
        </p>
      ) : (
        <>
          {running.length === 0 ? (
            <p className="text-dim text-sm leading-[1.7] text-pretty">
              {all.length === 0
                ? 'There are no projects yet. Start one with the panel above.'
                : 'Nothing is running this semester.'}
            </p>
          ) : (
            <ProjectRows projects={running} />
          )}

          {earlier.length > 0 && (
            <div className="border-rule mt-4 border-t pt-4">
              {pastOpen ? (
                <>
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-3">
                    <p className="text-faint font-mono text-[10px] font-medium tracking-[0.16em]">
                      EARLIER SEMESTERS
                    </p>
                    <PastButton
                      onClick={() => {
                        setPastOpen(false)
                      }}
                    >
                      HIDE PAST PROJECTS
                    </PastButton>
                  </div>
                  <ProjectRows projects={earlier} showTerm />
                </>
              ) : (
                <PastButton
                  onClick={() => {
                    setPastOpen(true)
                  }}
                >
                  {`SHOW PAST PROJECTS (${String(earlier.length)})`}
                </PastButton>
              )}
            </div>
          )}
        </>
      )}
    </FormPanel>
  )
}

/**
 * The rows themselves.
 *
 * `showTerm` is off for this semester's list, where every row carries the same
 * term and printing it four times says nothing, and on for the archive, where
 * it is the only thing telling one year's rover from the next.
 */
function ProjectRows({
  projects,
  showTerm = false,
}: {
  projects: ApiProject[]
  showTerm?: boolean
}) {
  return (
    <ul className="divide-rule divide-y">
      {projects.map((project) => (
        <li
          key={project.id}
          className="flex items-center justify-between gap-4 py-2.5"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{project.title}</p>
            {showTerm && (
              <p className="text-faint font-mono text-[10px] font-medium tracking-[0.14em] uppercase">
                {SEASON_LABEL[project.termSeason]} {project.termYear}
              </p>
            )}
          </div>
          <Link
            to={`/dashboard/projects/${project.slug}/manage`}
            className="text-faint hover:text-primary shrink-0 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200"
          >
            MANAGE
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** Drawn the same way in both of its states, like the archive control on
    `/projects` that this borrows its wording from. */
function PastButton({
  children,
  onClick,
}: {
  children: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-rule text-faint hover:text-primary hover:border-primary cursor-pointer border px-4 py-2 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200"
    >
      {children}
    </button>
  )
}
