import { useId, useState } from 'react'
import { Link, useOutletContext } from 'react-router'
import { DuesLocked } from '../components/dashboard/DuesLocked'
import { duesLocked } from '../lib/dues'
import type { DashboardContext } from '../components/dashboard/DashboardLayout'
import {
  FormEyebrow,
  FormHeading,
  FormPanel,
  fieldClass,
  labelClass,
} from '../components/shared/formChrome'
import { DraftGallery } from '../components/projects/DraftGallery'
import { LinkRows } from '../components/projects/LinkRows'
import { ProjectEditor } from '../components/projects/ProjectEditor'
import { useUnsavedGuard } from '../components/projects/useUnsavedGuard'
import { ConfirmDialog } from '../components/shared/ConfirmDialog'
import { deleteJson, postJson } from '../lib/api'
import type {
  ApiManagedProject,
  ApiProject,
  ApiProjectDetail,
  ApiProjectImage,
  ApiProjectLink,
} from '../lib/api'
import { explainApiError } from '../lib/apiErrors'
import {
  publishDraft,
  usableLinks,
  type DraftImage,
  type DraftLink,
} from '../lib/projectDraft'
import { useApi } from '../lib/useApi'

/**
 * The projects desk: starting one, and running last term's again.
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

  const officer = user.role === 'ADMIN' || user.role === 'OFFICER'

  if (!officer) {
    return (
      <>
        <FormEyebrow>/ MANAGE · PROJECTS</FormEyebrow>
        <FormHeading>This desk belongs to the officers.</FormHeading>
        <FormPanel>
          <p className="text-dim text-sm leading-[1.7] text-pretty">
            Deciding which projects the club runs is board business. If you
            think you should be able to do this, talk to an officer.
          </p>
        </FormPanel>
      </>
    )
  }

  return (
    <>
      <FormEyebrow>/ MANAGE · PROJECTS</FormEyebrow>
      <FormHeading>Projects.</FormHeading>

      <div className="space-y-5">
        <CreateProject />
        <DuplicateProject />
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
        <div className="grid gap-4 wide:grid-cols-2">
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
            Printed under the title on the projects list. Everything here can be
            changed afterwards, from this page or the project's own.
          </p>
        </div>

        <div className="grid gap-4 wide:grid-cols-2">
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
              Optional — leave it empty for a project that isn't built for one.
            </p>
          </div>
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
            Leave a blank line between paragraphs. Formatting marks are printed
            as typed — there is no markdown here yet.
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
            loses it when they leave. In Discord with Developer Mode on,
            right-click the role and Copy Role ID.
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
            One press makes the project and everything on this page with it. It
            goes live at that moment, and can be edited or deleted afterwards.
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
          , with everything you filled in. It is on the projects list, and
          changes below appear on it as you save — from here or from{' '}
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
          If it was made by mistake. This is the undo for having created it —
          without it, an abandoned project just sits on the public list.
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
          <p>
            Any picture uploaded to it in the last few minutes is deleted with
            it. Links you typed elsewhere are untouched.
          </p>
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
        Copies a project&rsquo;s writing, pictures and links into a new one for a
        new semester. Nobody is carried over &mdash; members join the new one,
        and its lead is appointed on the roles desk.
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

        <div className="grid gap-4 wide:grid-cols-2">
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

        <div className="grid gap-4 wide:grid-cols-3">
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