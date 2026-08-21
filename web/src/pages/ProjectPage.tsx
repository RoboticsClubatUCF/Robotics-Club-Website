import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { ProjectEditor } from '../components/projects/ProjectEditor'
import { ProjectGallery } from '../components/projects/ProjectGallery'
import { useUnsavedGuard } from '../components/projects/useUnsavedGuard'
import { LeaveProjectButton } from '../components/shared/LeaveProjectButton'
import { FormEyebrow, FormHeading, FormPanel } from '../components/shared/formChrome'
import { ApiError, getJson, postJson } from '../lib/api'
import type {
  ApiDuesStatus,
  ApiMyProject,
  ApiProjectDetail,
  ApiUser,
} from '../lib/api'
import { LOCK_COPY, accessLock, coverGap } from '../lib/dues'
import { canEditProject, editingAsOfficer, rankOn } from '../lib/projectEditing'
import { slidesOf } from '../lib/projectGallery'
import { useSession } from '../lib/session'
import type { ApiState } from '../lib/useApi'
import { useApi } from '../lib/useApi'

/**
 * `/projects/:slug` — one project's public profile.
 *
 * This is where "open projects" links from the dashboard land, and it is
 * reachable signed out on purpose: a guest deciding whether to pay dues should
 * be able to read what they would be joining. The join panel below the fold is
 * where the gate lives — signed out it points at signing in, unpaid it points
 * at the dues page, and only a covered member gets the button. The server
 * re-checks all three, so the panel is honesty rather than enforcement.
 */
export function ProjectPage() {
  const { slug = '' } = useParams()
  const [state, setState] = useState<ApiState<ApiProjectDetail>>({
    status: 'loading',
  })

  /**
   * Its own loader rather than `useApi`, for the one thing `useApi` cannot do:
   * refetch. The editor changes this page, and a page that cannot re-read
   * itself would have to guess at what the server now holds.
   *
   * `fresh` bypasses the browser's HTTP cache. `/projects/:slug` is a public,
   * cacheable route by design, so the read after a save would otherwise be
   * answered from the cache with the copy from *before* the save — which looks
   * exactly like the save having failed. See `getJson`.
   */
  const load = useCallback(
    async (fresh = false) => {
      try {
        const data = await getJson<ApiProjectDetail>(
          `/projects/${slug}`,
          undefined,
          fresh,
        )
        setState({ status: 'ready', data })
      } catch (error) {
        setState({
          status: 'error',
          code: error instanceof ApiError ? error.status : 0,
        })
      }
    },
    [slug],
  )

  useEffect(() => {
    setState({ status: 'loading' })
    void load()
  }, [load])

  return (
    <section className="px-page py-14 wide:py-20">
      <div className="mx-auto w-full max-w-[46rem]">
        <Link
          to="/projects"
          className="text-faint hover:text-primary mb-8 inline-block font-mono text-[11px] font-medium tracking-[0.14em] transition-colors duration-200"
        >
          ‹ ALL PROJECTS
        </Link>

        {state.status === 'loading' && <ProjectSkeleton />}

        {state.status === 'error' &&
          (state.code === 404 ? (
            <>
              <FormEyebrow>/ PROJECT</FormEyebrow>
              <FormHeading>There is no project here.</FormHeading>
              <FormPanel>
                <p className="text-dim text-sm leading-[1.7] text-pretty">
                  Either the link is wrong or the project has been taken down.
                  Everything we're running is on the projects page.
                </p>
              </FormPanel>
            </>
          ) : (
            <>
              <FormEyebrow>/ PROJECT</FormEyebrow>
              <FormHeading>We can't reach the server.</FormHeading>
              <FormPanel tone="accent">
                <p className="text-dim text-sm leading-[1.7] text-pretty">
                  The project is probably fine — this page just couldn't load
                  it. Try again in a moment.
                </p>
              </FormPanel>
            </>
          ))}

        {state.status === 'ready' && (
          <ProjectShell
            project={state.data}
            reload={load}
            apply={(data) => {
              setState({ status: 'ready', data })
            }}
          />
        )}
      </div>
    </section>
  )
}

/**
 * What being signed in adds to this page: the join panel's answer, and whether
 * the edit affordance appears at all.
 *
 * Both halves need the same two reads, so they are taken **once, here, and only
 * when somebody is signed in**. That last part is the contract worth keeping:
 * a signed-out visitor — which is most of this page's traffic, and the whole
 * reason it is reachable signed out — makes exactly one request for the whole
 * page. `useApi` has no dedupe, so a hook added at the top of `ProjectBody`
 * instead would be a request every visitor paid for so that a handful of leads
 * could see a button. There is a test on this.
 */
type SignedIn = {
  user: ApiUser
  dues: ApiState<ApiDuesStatus>
  mine: ApiState<ApiMyProject[]>
}

function ProjectShell(props: {
  project: ApiProjectDetail
  reload: (fresh?: boolean) => Promise<void>
  apply: (project: ApiProjectDetail) => void
}) {
  const { session } = useSession()

  if (session.status === 'signed-in') {
    return <SignedInBody {...props} user={session.user} />
  }

  return <ProjectBody {...props} signedIn={null} />
}

function SignedInBody({
  user,
  ...props
}: {
  user: ApiUser
  project: ApiProjectDetail
  reload: (fresh?: boolean) => Promise<void>
  apply: (project: ApiProjectDetail) => void
}) {
  // Unconditionally, for any project status. The join panel used to bail out
  // before fetching on a finished project; the editor has to work on one, so
  // a signed-in reader of an archived project now costs these two reads too.
  const dues = useApi<ApiDuesStatus>('/dues/status')
  const mine = useApi<ApiMyProject[]>('/me/projects')

  return <ProjectBody {...props} signedIn={{ user, dues, mine }} />
}

function ProjectBody({
  project,
  reload,
  apply,
  signedIn,
}: {
  project: ApiProjectDetail
  reload: (fresh?: boolean) => Promise<void>
  apply: (project: ApiProjectDetail) => void
  signedIn: SignedIn | null
}) {
  const [editing, setEditing] = useState(false)
  const [dirty, setDirty] = useState(false)
  const { guard, dialog } = useUnsavedGuard(dirty)

  /** Both ways out of edit mode do the same two things, so they share them. */
  const leaveEditing = guard(() => {
    setEditing(false)
    setDirty(false)
    // Fresh, so what the reader lands back on is the server's copy and not a
    // cached one from before any of this.
    void reload(true)
  })

  // "IN_PROGRESS" is an enum name, not a sentence.
  const meta = [project.status.replace(/_/g, ' '), project.season]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      {/* The eyebrow shares its line with the edit affordance, so the button is
          above the fold and out of the reading column. For everyone else —
          which is most people, most of the time — nothing is rendered here at
          all, rather than something greyed out. */}
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <p className="text-faint font-mono text-[13px] font-bold tracking-[0.2em]">
          / PROJECT
        </p>
        {signedIn &&
          (editing ? (
            /* The button that turned the mode on turns it off, in the slot it
               came from — so the way out is where somebody last saw the way
               in, rather than at the bottom of a page they have to scroll. */
            <button
              type="button"
              onClick={leaveEditing}
              className="btn btn-outline h-auto min-h-0 border-white/28 px-5 py-2 text-[11px] font-semibold tracking-[0.08em] text-white transition-colors duration-200 hover:border-white hover:bg-white/6 hover:text-white"
            >
              DONE EDITING
            </button>
          ) : (
            <EditAffordance
              project={project}
              signedIn={signedIn}
              onEdit={() => {
                setEditing(true)
              }}
            />
          ))}
      </div>

      <FormHeading>{project.title}</FormHeading>

      <p className="text-faint mb-6 font-mono text-[11px] font-medium tracking-[0.14em]">
        {meta}
        {project.competition && (
          <>
            {' · '}
            <span className="text-primary">{project.competition}</span>
          </>
        )}
      </p>

      {editing && signedIn ? (
        <ProjectEditor
          project={project}
          asOfficer={editingAsOfficer(signedIn.user.role, minesOf(signedIn), project.id)}
          apply={apply}
          onDone={leaveEditing}
          onDirtyChange={setDirty}
        />
      ) : (
        <ReadView project={project} signedIn={signedIn} />
      )}

      {dialog}
    </>
  )
}

/** `/me/projects` once it has landed, or null while it has not. */
const minesOf = (signedIn: SignedIn) =>
  signedIn.mine.status === 'ready' ? signedIn.mine.data : null

/** The page as everybody sees it, and as a lead sees it when not editing. */
function ReadView({
  project,
  signedIn,
}: {
  project: ApiProjectDetail
  signedIn: SignedIn | null
}) {
  return (
    <>
      {/* Where the bare cover `<img>` used to sit, so nothing has moved for a
          reader — the picture just got better. Above the prose because the
          picture is what makes somebody read the paragraph. The spacing lives
          inside the component, which renders nothing at all for a project with
          no pictures. */}
      <ProjectGallery slides={slidesOf(project)} />

      {project.summary && (
        <p className="text-base leading-[1.7] text-pretty">{project.summary}</p>
      )}

      {/* The schema calls `description` markdown, but nothing has shipped a
          renderer and the seeded copy is plain prose. Blank lines become
          paragraph breaks; if real markdown ever lands in this column, this is
          the spot that grows a renderer. */}
      {project.description &&
        project.description.split(/\n{2,}/).map((paragraph, index) => (
          <p
            key={index}
            className="text-dim mt-5 text-sm leading-[1.7] text-pretty"
          >
            {paragraph}
          </p>
        ))}

      <Resources project={project} />

      {/* The margin lives on the wrapper because the panel renders nothing at
          all for finished projects, and an empty div's margins collapse away. */}
      <div className="mt-10">
        <JoinPanel project={project} signedIn={signedIn} />
      </div>

      <div className="mt-12">
        <p className="text-faint mb-4 font-mono text-[13px] font-bold tracking-[0.2em]">
          / THE TEAM
        </p>

        {project.members.length === 0 ? (
          <p className="text-faint border-rule border-t py-5 text-sm">
            Nobody is listed on this project yet.
          </p>
        ) : (
          <ul className="border-rule divide-rule divide-y border">
            {project.members.map((member) => (
              <li
                key={`${member.user.fullName}-${member.user.slug ?? ''}`}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3.5"
              >
                <span className="text-sm font-medium">
                  {member.user.fullName}
                  {member.user.title && (
                    <span className="text-faint ml-2 text-[13px] font-normal">
                      {member.user.title}
                    </span>
                  )}
                </span>
                {member.title && (
                  <span className="text-faint font-mono text-[10px] font-medium tracking-[0.14em] uppercase">
                    {member.title}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

/**
 * The EDIT PAGE button, or the reason there isn't one.
 *
 * Three outcomes, and the middle one is the interesting one:
 *
 *   - **Not a lead here, and not an officer** → nothing at all. Not a disabled
 *     button; the affordance simply does not exist for the overwhelming
 *     majority of people who will ever read this page.
 *   - **A lead or officer whose dues have lapsed** → one line saying so, and a
 *     way to fix it. Not silence, because somebody who has edited this page
 *     before will look for the button, fail to find it, and conclude the site
 *     is broken. And deliberately not the dashboard's whole-page `DuesLocked`:
 *     this is a *public* page, and blanking it over one reader's unpaid dues
 *     would be absurd. The wording follows the server's promise — nothing has
 *     been taken away, and paying gives it straight back.
 *   - **A lead or officer in good standing** → the button.
 *
 * Nothing renders until both reads have landed, so no lapsed line ever flashes
 * at a paid-up lead on the way past.
 */
function EditAffordance({
  project,
  signedIn,
  onEdit,
}: {
  project: ApiProjectDetail
  signedIn: SignedIn
  onEdit: () => void
}) {
  const { user, dues, mine } = signedIn

  if (dues.status === 'loading' || mine.status === 'loading') return null
  if (!canEditProject(user.role, minesOf(signedIn), project.id)) return null

  // `accessLock` wants the membership itself, and `/dues/status` wraps it —
  // the dashboard gets the unwrapped form from its layout context, this page
  // does not. It also handles the ADMIN exemption and "not ready reads as
  // unlocked", so neither is re-decided here.
  const locked = accessLock(
    dues.status === 'ready'
      ? { status: 'ready', data: dues.data.membership }
      : dues,
    user.role,
  )

  if (locked) {
    return (
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[10px] font-medium tracking-[0.14em]">
        {/* Not always "DUES LAPSED": the same lock now fires inside a free
            window, where nothing has lapsed and nothing is owed. */}
        <span className="text-faint">{LOCK_COPY[locked].short}</span>
        <Link
          to="/dashboard/dues"
          className="text-primary hover:underline underline-offset-2"
        >
          {LOCK_COPY[locked].cta} ›
        </Link>
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={onEdit}
      className="border-rule text-faint hover:border-primary hover:text-primary cursor-pointer border px-3 py-1.5 font-mono text-[10px] font-medium tracking-[0.14em] transition-colors duration-200"
    >
      EDIT PAGE
    </button>
  )
}

/**
 * Everything a project points at: the design doc, the CAD, the rules, and the
 * repository.
 *
 * `repoUrl` is folded in as the first row rather than keeping the outline
 * button it used to have. A lone "View the code" above a list of
 * identical-looking links is two vocabularies for one idea, and the repository
 * is a resource like the rest of them — it just happens to have its own column
 * because it predates this list.
 */
function Resources({ project }: { project: ApiProjectDetail }) {
  const rows = [
    ...(project.repoUrl
      ? [{ id: 'repo', label: 'SOURCE CODE', url: project.repoUrl }]
      : []),
    ...project.links,
  ]

  if (rows.length === 0) return null

  return (
    <div className="mt-10">
      <p className="text-faint mb-4 font-mono text-[13px] font-bold tracking-[0.2em]">
        / RESOURCES
      </p>

      <ul className="border-rule divide-rule divide-y border">
        {rows.map((row) => (
          <li key={row.id}>
            <a
              href={row.url}
              target="_blank"
              rel="noreferrer noopener"
              className="hover:bg-wash flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3.5 transition-colors duration-200"
            >
              <span className="text-sm font-medium">{row.label}</span>
              {/* The bare host, not the whole URL: a reader is deciding whether
                  they trust where this goes, and a 90-character Notion link
                  wrapping onto three lines answers that worse than "notion.so"
                  does. `↗` says it leaves the site. */}
              <span className="text-faint font-mono text-[11px] font-medium tracking-[0.06em]">
                {hostOf(row.url)} ↗
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The host a link points at, for the right-hand column.
 *
 * Total, because these URLs come from a database rather than from a validator
 * on this render: the routes check them with `z.url()` on the way in, but a row
 * written before that check existed, or by hand in Studio, must not throw
 * inside a map and blank the page. An unparseable value falls back to itself.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * The join gate, in its three honest states. Not rendered at all for a
 * project that isn't running — a join button on an archived project is an
 * invitation to a room with the lights off.
 */
function JoinPanel({
  project,
  signedIn,
}: {
  project: ApiProjectDetail
  signedIn: SignedIn | null
}) {
  const { session } = useSession()
  const location = useLocation()

  if (project.status !== 'IN_PROGRESS') return null
  if (session.status === 'loading') {
    return (
      <div aria-busy="true" className="border-rule bg-base-200 mt-10 h-24 border" />
    )
  }
  // The page itself loaded, so the API is up — this is a blip. The project is
  // still readable; only the join panel goes quiet.
  if (session.status === 'error') return null

  if (signedIn) return <JoinAction project={project} signedIn={signedIn} />

  return (
    <FormPanel tone="accent">
      <div className="mt-0">
        <p className="text-faint mb-2 font-mono text-[10px] font-medium tracking-[0.16em]">
          JOIN THIS PROJECT
        </p>
        <p className="text-dim mb-4 text-sm leading-[1.7] text-pretty">
          Members with paid dues can join and start turning up. Sign in — or
          make an account — and come straight back here.
        </p>
        <Link
          to="/login"
          state={{ from: location.pathname }}
          className="btn btn-primary btn-cta px-6 py-3 text-[13px] font-semibold"
        >
          SIGN IN TO JOIN
        </Link>
      </div>
    </FormPanel>
  )
}

function JoinAction({
  project,
  signedIn: { dues, mine },
}: {
  project: ApiProjectDetail
  signedIn: SignedIn
}) {
  const [state, setState] = useState<
    | { status: 'idle' }
    | { status: 'joining' }
    | { status: 'joined' }
    /** Left just now, so `/me/projects` still says otherwise. */
    | { status: 'left' }
    | { status: 'failed'; message: string }
  >({ status: 'idle' })

  if (dues.status === 'loading' || mine.status === 'loading') {
    return (
      <div aria-busy="true" className="border-rule bg-base-200 mt-10 h-24 border" />
    )
  }

  // `state` wins over the fetched list in both directions: `/me/projects` has
  // no refetch, so it is a snapshot from before whichever of these happened.
  const alreadyOn =
    state.status !== 'left' &&
    (state.status === 'joined' ||
      (mine.status === 'ready' &&
        mine.data.some((m) => m.project.id === project.id)))

  if (alreadyOn) {
    const rank = rankOn(mine.status === 'ready' ? mine.data : null, project.id)

    return (
      <FormPanel tone="accent">
        <p className="text-dim text-sm leading-[1.7] text-pretty">
          You're on this project.{' '}
          <Link
            to={`/dashboard/projects/${project.slug}`}
            className="text-primary underline underline-offset-2"
          >
            Open it on your dashboard
          </Link>
          .
        </p>

        {/* Leaving is offered here as well as on the dashboard, because this is
            where somebody who has decided a project is not for them actually
            is. Absent until the roster read has landed — the warning turns on
            the rank, and a dialog that guessed it would be worse than a
            moment's wait. */}
        {rank && (
          <span className="mt-3 block">
            <LeaveProjectButton
              projectId={project.id}
              projectTitle={project.title}
              rank={rank}
              teamName={
                mine.status === 'ready'
                  ? (mine.data.find((row) => row.project.id === project.id)?.team
                      ?.name ?? null)
                  : null
              }
              onLeft={() => {
                // Nothing on this page is stale except the panel itself, and
                // the honest thing to show now is the join gate again.
                setState({ status: 'left' })
              }}
            />
          </span>
        )}
      </FormPanel>
    )
  }

  // If the dues read failed there is no way to promise the join will pass the
  // gate — send them via the dues page, which can explain properly.
  const gap =
    dues.status === 'error' ? 'newcomer' : coverGap(dues.data.membership)

  if (gap) {
    return (
      <FormPanel tone="accent">
        <p className="text-faint mb-2 font-mono text-[10px] font-medium tracking-[0.16em]">
          JOIN THIS PROJECT
        </p>
        {/* Three reasons, three sentences, matching the 403 this route would
            answer with. It used to say "settle your dues" whatever the reason,
            which inside a free window is telling somebody to pay for a thing
            that is free and one press away. */}
        <p className="text-dim mb-4 text-sm leading-[1.7] text-pretty">
          {gap === 'claim'
            ? 'Joining needs a current membership — and yours is free to switch on right now. One press, no card, and this page will have the button waiting.'
            : gap === 'dues'
              ? 'Joining a project needs current dues. Settle them and come straight back — this page will have the button waiting.'
              : 'Joining a project is for paid-up members. Dues take a minute, and this page will have the button waiting.'}
        </p>
        <Link
          to="/dashboard/dues"
          className="btn btn-primary btn-cta px-6 py-3 text-[13px] font-semibold"
        >
          {LOCK_COPY[gap].cta}
        </Link>
      </FormPanel>
    )
  }

  const join = () => {
    setState({ status: 'joining' })
    postJson(`/projects/${project.id}/join`, {})
      .then(() => {
        setState({ status: 'joined' })
      })
      .catch((error: unknown) => {
        setState({
          status: 'failed',
          message:
            error instanceof ApiError && error.detail
              ? error.detail
              : "Joining didn't go through. Try again in a moment.",
        })
      })
  }

  return (
    <FormPanel tone="accent">
      <p className="text-faint mb-2 font-mono text-[10px] font-medium tracking-[0.16em]">
        JOIN THIS PROJECT
      </p>
      <p className="text-dim mb-4 text-sm leading-[1.7] text-pretty">
        Your membership covers this. Joining puts you on the roster; showing up
        does the rest.
      </p>
      <button
        type="button"
        onClick={join}
        disabled={state.status === 'joining'}
        className="btn btn-primary btn-cta px-6 py-3 text-[13px] font-semibold disabled:opacity-60"
      >
        {state.status === 'joining' ? 'JOINING…' : 'JOIN THIS PROJECT'}
      </button>
      <p role="status" className="text-error mt-2 min-h-4 text-[12px]">
        {state.status === 'failed' ? state.message : ''}
      </p>
    </FormPanel>
  )
}

/** Header-shaped placeholders, sized so the page doesn't jump when data lands. */
function ProjectSkeleton() {
  return (
    <div aria-busy="true">
      <div className="bg-base-300 h-3 w-24 animate-pulse rounded-[2px]" />
      <div className="bg-base-300 mt-6 h-9 w-72 max-w-full animate-pulse rounded-[2px]" />
      <div className="bg-base-300 mt-5 h-3 w-48 animate-pulse rounded-[2px]" />
      {/* Same aspect ratio as the gallery frame, so the page does not jump the
          moment the pictures land. */}
      <div className="bg-base-300 mt-6 aspect-[16/10] w-full animate-pulse rounded-[2px]" />
      <div className="mt-8 space-y-2.5">
        <div className="bg-base-300 h-3 w-full animate-pulse rounded-[2px]" />
        <div className="bg-base-300 h-3 w-11/12 animate-pulse rounded-[2px]" />
        <div className="bg-base-300 h-3 w-4/5 animate-pulse rounded-[2px]" />
      </div>
    </div>
  )
}
