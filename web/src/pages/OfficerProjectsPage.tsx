import { useEffect, useId, useState } from 'react'
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
import { ApiError, deleteJson, getJson, patchJson, postJson } from '../lib/api'
import type {
  ApiManagedProject,
  ApiOfficerMember,
  ApiProject,
  ApiProjectDetail,
  ApiProjectImage,
  ApiProjectLink,
} from '../lib/api'
import {
  publishDraft,
  usableLinks,
  type DraftImage,
  type DraftLink,
} from '../lib/projectDraft'
import { useApi } from '../lib/useApi'

/**
 * The projects desk: creating one, and appointing its leads.
 *
 * Both live here rather than on a project's own manage page because they are
 * the two decisions that stay with the board — a project exists because the
 * board said so, and its lead holds the rank because the board granted it.
 * Everything after that point belongs to the lead.
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

function explain(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return "We couldn't reach the server. Try again in a moment."
    if (error.status === 403) return 'The server does not agree you are an officer.'
    if (error.status === 429) return 'Too many changes at once — give it a minute.'
    if (error.detail) return error.detail
  }
  return 'That did not go through. Try again in a moment.'
}

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
            Creating projects and appointing leads is board business. If you
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
        <CreateProject userId={user.id} />
        <AppointLead />
      </div>
    </>
  )
}

/**
 * How to say which account this is, in one line.
 *
 * Email first where there is one, and the Discord handle otherwise — an account
 * can have a handle and no email at all, and printing nothing for those made
 * them look like empty rows in the picker.
 */
const contactOf = (member: ApiOfficerMember) =>
  member.email ??
  (member.discordUsername ? `@${member.discordUsername}` : null)

/**
 * The people picker, answering as it is typed.
 *
 * It matches on name, email **and Discord handle** — see `GET /officer/members`
 * in `server/src/routes/officer.ts`, where the search itself lives.
 *
 * Two details keep search-as-you-type honest here. The debounce, so a name is
 * one request rather than one per keystroke; and the `AbortController`, without
 * which "ro" can land after "rowan" and put the wrong list on screen — a race
 * that shows up exactly when the network is slow and nowhere else. Both are the
 * shape `DiscordUsernameField` uses, for the same two reasons.
 *
 * Under two characters nothing is asked at all, because the route's own
 * validator refuses that and a 400 per keystroke is not a search.
 */
const DEBOUNCE_MS = 300

function MemberSearch({
  picked,
  onPick,
  disabled,
}: {
  picked: ApiOfficerMember | null
  onPick: (member: ApiOfficerMember | null) => void
  disabled: boolean
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ApiOfficerMember[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [message, setMessage] = useState('')

  const term = query.trim()

  useEffect(() => {
    if (term.length < 2) {
      setResults(null)
      setSearching(false)
      setMessage('')
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(() => {
      setSearching(true)
      setMessage('')

      getJson<ApiOfficerMember[]>(
        `/officer/members?query=${encodeURIComponent(term)}`,
        controller.signal,
      )
        .then((found) => {
          setResults(found)
          setSearching(false)
        })
        .catch((error: unknown) => {
          // An abort is this effect being cleaned up, not a failure — what was
          // typed changed and a newer search is already on its way.
          if (controller.signal.aborted) return
          setResults(null)
          setSearching(false)
          setMessage(explain(error))
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [term])

  if (picked) {
    return (
      <div className="border-rule bg-base-100 flex items-center justify-between gap-4 border px-3 py-2.5">
        <span className="text-sm font-medium">
          {picked.fullName}
          {contactOf(picked) && (
            <span className="text-faint ml-2 text-[12px] font-normal">
              {contactOf(picked)}
            </span>
          )}
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            onPick(null)
          }}
          className="text-faint hover:text-primary cursor-pointer font-mono text-[10px] font-medium tracking-[0.14em]"
        >
          CHANGE
        </button>
      </div>
    )
  }

  return (
    <div>
      {/* Deliberately not a `<form>`: this picker sits *inside* the create
          form, and a form inside a form is invalid HTML — the parser drops the
          inner one. React builds the DOM through the API rather than the
          parser, so a nested one happened to work; that is not a thing to rely
          on. There is no submit button to press now anyway, but Enter is still
          swallowed below, because the create form is listening for it. */}
      <label htmlFor={id} className={labelClass}>
        FIND A MEMBER
      </label>
      <input
        id={id}
        name="query"
        type="search"
        autoComplete="off"
        value={query}
        minLength={2}
        maxLength={100}
        placeholder="Name, email or Discord"
        className={fieldClass}
        disabled={disabled}
        onChange={(event) => {
          setQuery(event.target.value)
        }}
        onKeyDown={(event) => {
          // The results are already there; without this the keypress reaches
          // the create form and submits a half-filled project.
          if (event.key === 'Enter') event.preventDefault()
        }}
      />

      {results && (
        <ul className="border-rule divide-rule mt-3 divide-y border">
          {results.length === 0 && (
            <li className="text-faint px-3 py-2.5 text-[13px]">
              Nobody matches that.
            </li>
          )}
          {results.map((member) => (
            <li key={member.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(member)
                  setResults(null)
                }}
                className="hover:bg-wash flex w-full cursor-pointer items-baseline justify-between gap-4 px-3 py-2.5 text-left transition-colors duration-150"
              >
                <span className="text-sm font-medium">{member.fullName}</span>
                {/* Both, stacked, because either can be the only one an account
                    has — and two students with the same name are told apart by
                    whichever of them the officer recognises. */}
                <span className="text-faint shrink-0 text-right text-[12px]">
                  {member.email}
                  {member.discordUsername && (
                    <span className="block text-[11px]">
                      @{member.discordUsername}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* One line, always rendered, carrying whichever of the three things is
          true — so the region exists before it has anything to announce and
          nothing below it moves when it does. */}
      <p
        role="status"
        className={`mt-2 min-h-4 text-[12px] ${message ? 'text-error' : 'text-faint'}`}
      >
        {message ||
          (searching
            ? 'Searching…'
            : term.length > 0 && term.length < 2
              ? 'Two letters or more.'
              : '')}
      </p>
    </div>
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
function CreateProject({ userId }: { userId: string }) {
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

  return <CreateForm userId={userId} onCreated={setCreated} />
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

function CreateForm({
  userId,
  onCreated,
}: {
  userId: string
  onCreated: (created: Created) => void
}) {
  const id = useId()
  const [lead, setLead] = useState<ApiOfficerMember | null>(null)
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
      // Left off entirely when nobody was picked, rather than sent as null: the
      // route's field is optional and a project waiting for its lead is a
      // normal thing for the board to have agreed to. A lead creating their own
      // project never sends this — the server seats them regardless.
      ...(lead ? { leadUserId: lead.id } : {}),
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
        setLead(null)
        setLinks([])
        // Not released: the object URLs belong to the editor's rows now, and
        // `DraftGallery` unmounting is what hands back any that never landed.
        setImages([])
        setState({ status: 'idle' })

        onCreated({
          project,
          description: description ?? null,
          // Whether the officer who pressed the button named themselves. Only
          // decides which banner the editor below shows, so being wrong here
          // costs a sentence rather than a permission.
          mine: lead?.id === userId,
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
          <p className={labelClass}>PROJECT LEAD — OPTIONAL</p>
          <MemberSearch picked={lead} onPick={setLead} disabled={sending} />
          {/* Optional on purpose. The board agreeing to run something and the
              board settling who runs it are two decisions, often a week apart,
              and making the first wait on the second is how a project gets a
              lead who was picked to unblock a form. Appointing one later is the
              panel directly below this. */}
          <p className="text-faint mt-1.5 text-[11px] leading-[1.5]">
            One per project, and it can be settled later — APPOINT OR STAND DOWN
            A PROJECT LEAD, below, does this at any point.
          </p>
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
 * For the mid-term realities: a lead graduates, somebody else steps up. Works
 * on people who have never joined through the site — appointing them is what
 * puts them on the project.
 *
 * **A project has one lead, and MAKE PROJECT LEAD refuses rather than swaps.**
 * The server answers 409 naming whoever is sitting there, and `explain` prints
 * a 409's own sentence, so no code here handles that case — the officer reads
 * who it is and presses DEMOTE TO MEMBER, which is the button beside this one.
 * Two deliberate steps, because which of two people runs a build is not
 * something to infer from a single click.
 */
function AppointLead() {
  const projects = useApi<ApiProject[]>('/projects?limit=100')
  const id = useId()
  const [member, setMember] = useState<ApiOfficerMember | null>(null)
  const [projectId, setProjectId] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)

  const setRank = (rank: 'PROJECT_LEAD' | 'MEMBER') => {
    if (!member || !projectId) {
      setMessage({ tone: 'error', text: 'Pick a project and a member first.' })
      return
    }

    setBusy(true)
    setMessage(null)
    patchJson(`/officer/projects/${projectId}/members/${member.id}/rank`, { rank })
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
      <p className="text-faint mb-4 font-mono text-[10px] font-medium tracking-[0.16em]">
        APPOINT OR STAND DOWN A PROJECT LEAD
      </p>

      <div className="space-y-4">
        <div>
          <label htmlFor={`${id}-project`} className={labelClass}>
            PROJECT
          </label>
          <select
            id={`${id}-project`}
            className="select border-rule bg-base-200 w-full text-sm"
            value={projectId}
            disabled={busy || projects.status !== 'ready'}
            onChange={(event) => {
              setProjectId(event.target.value)
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
                  {project.title}
                </option>
              ))}
          </select>
        </div>

        <MemberSearch picked={member} onPick={setMember} disabled={busy} />

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setRank('PROJECT_LEAD')
            }}
            className="btn btn-primary btn-cta px-5 py-2.5 text-[12px] font-semibold disabled:opacity-60"
          >
            MAKE PROJECT LEAD
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setRank('MEMBER')
            }}
            className="btn btn-outline h-auto min-h-0 border-white/28 px-5 py-2.5 text-[12px] font-semibold text-white hover:border-white hover:bg-white/6 hover:text-white disabled:opacity-60"
          >
            DEMOTE TO MEMBER
          </button>
        </div>

        <p role="status" className="min-h-4 text-[13px]">
          {message && (
            <span className={message.tone === 'error' ? 'text-error' : 'text-success'}>
              {message.text}
            </span>
          )}
        </p>
      </div>
    </FormPanel>
  )
}
