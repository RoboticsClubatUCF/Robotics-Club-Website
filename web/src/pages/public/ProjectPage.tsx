import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { ProjectEditor } from '../../components/projects/ProjectEditor'
import { ProjectGallery } from '../../components/projects/ProjectGallery'
import { ProjectProse } from '../../components/projects/ProjectProse'
import { useUnsavedGuard } from '../../components/projects/useUnsavedGuard'
import { LeaveProjectButton } from '../../components/shared/LeaveProjectButton'
import { FormEyebrow, FormHeading, FormPanel } from '../../components/shared/formChrome'
import { ApiError, getJson, postJson } from '../../lib/api/api'
import type {
  ApiDuesStatus,
  ApiMyProject,
  ApiProjectDetail,
  ApiUser,
  ProjectMemberRank,
} from '../../lib/api/api'
import { LOCK_COPY, accessLock } from '../../lib/dues/dues'
import {
  canEditProject,
  editingAsOfficer,
  rankOn,
} from '../../lib/projects/projectEditing'
import { memberLabel } from '../../lib/projects/projectRoles'
import { slidesOf } from '../../lib/projects/projectGallery'
import { useSession } from '../../lib/auth/session'
import type { ApiState } from '../../lib/api/useApi'
import { useApi } from '../../lib/api/useApi'

/**
 * `/projects/:slug` — one project's public profile.
 *
 * Anyone with an account can join and receive the Discord crew role. Public
 * roster listing is granted separately by an officer or the project's leads.
 */
export function ProjectPage() {
  const { slug = '' } = useParams()
  const [state, setState] = useState<ApiState<ApiProjectDetail>>({
    status: 'loading',
  })

  /**
   * Its own loader rather than `useApi`, for the one thing `useApi` can't do:
   * refetch. The editor changes this page, and a page that can't re-read itself would
   * have to guess at what the server now holds.
   *
   * `fresh` bypasses the browser's HTTP cache. `/projects/:slug` is public and
   * cacheable, so the read after a save would otherwise come back from the cache with
   * the copy from before it — which looks exactly like the save having failed.
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
          className="mb-8 inline-block font-mono text-[11px] font-medium tracking-[0.14em] text-faint transition-colors duration-200 hover:text-primary"
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
                <p className="text-sm leading-[1.7] text-pretty text-dim">
                  Either the link is wrong or the project has been taken down.
                </p>
              </FormPanel>
            </>
          ) : (
            <>
              <FormEyebrow>/ PROJECT</FormEyebrow>
              <FormHeading>We can't reach the server.</FormHeading>
              <FormPanel tone="accent">
                <p className="text-sm leading-[1.7] text-pretty text-dim">
                  This page couldn't load it. Try again in a moment.
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
 * What being signed in adds to this page: the join panel's answer, and whether the
 * edit affordance appears at all.
 *
 * Both halves need the same two reads, so they're taken once, here, and only when
 * somebody is signed in. That last part is the contract: a signed-out visitor — most
 * of this page's traffic — makes exactly one request for the whole page. `useApi` has
 * no dedupe, so a hook at the top of `ProjectBody` would be a request every visitor
 * paid for so a handful of leads could see a button. There's a test on this.
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
  // Unconditionally, for any project status. The join panel used to bail out before
  // fetching on a finished project; the editor has to work on one, so a signed-in
  // reader of an archived project now costs these two reads too.
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

  /**
   * The way out, guarded. Nothing in the editor reaches the server before its SAVE, so
   * leaving is genuinely destructive — and the refetch afterwards puts the reader back
   * on the server's copy rather than a draft they abandoned.
   */
  const leaveEditing = guard(() => {
    setEditing(false)
    setDirty(false)
    // Fresh, so what the reader lands back on is the server's copy and not a cached
    // one from before any of this.
    void reload(true)
  })

  // "IN_PROGRESS" is an enum name, not a sentence.
  const meta = [project.status.replace(/_/g, ' '), project.season]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      {/* The eyebrow shares its line with the edit affordance, so the button is above
          the fold and out of the reading column. For everyone else nothing is rendered
          here at all, rather than something greyed out.

          Nothing takes its place while editing. This slot used to hold a second DONE
          EDITING, which was worth its weight while the page saved as you touched it;
          now that it saves once at the bottom, the exit belongs with the button it's
          the alternative to. */}
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <p className="font-mono text-[13px] font-bold tracking-[0.2em] text-faint">
          / PROJECT
        </p>
        {signedIn && !editing && (
          <EditAffordance
            project={project}
            signedIn={signedIn}
            onEdit={() => {
              setEditing(true)
            }}
          />
        )}
      </div>

      <FormHeading>{project.title}</FormHeading>

      <p className="mb-6 font-mono text-[11px] font-medium tracking-[0.14em] text-faint">
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
          me={signedIn.user}
          apply={apply}
          onDone={leaveEditing}
          onDirtyChange={setDirty}
        />
      ) : (
        <ReadView project={project} signedIn={signedIn} reload={reload} />
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
  reload,
}: {
  project: ApiProjectDetail
  signedIn: SignedIn | null
  reload: (fresh?: boolean) => Promise<void>
}) {
  return (
    <>
      {/* Where the bare cover `<img>` used to sit, so nothing has moved for a reader.
          Above the prose because the picture is what makes somebody read the
          paragraph. The spacing lives inside the component, which renders nothing at
          all for a project with no pictures. */}
      <ProjectGallery
        slides={slidesOf(project)}
        heading={project.galleryHeading ?? 'GALLERY'}
      />

      {project.summary && (
        <p className="text-base leading-[1.7] text-pretty">{project.summary}</p>
      )}

      <ProjectProse
        description={project.description}
        className="mt-5 text-sm leading-[1.7] text-pretty text-dim"
      />

      <Resources project={project} />

      {/* The margin lives on the wrapper because the panel renders nothing at all for
          finished projects, and an empty div's margins collapse away. */}
      <div className="mt-10">
        <JoinPanel project={project} signedIn={signedIn} reload={reload} />
      </div>

      <div className="mt-12">
        <p className="mb-4 font-mono text-[13px] font-bold tracking-[0.2em] text-faint uppercase">
          / {project.teamHeading ?? 'THE TEAM'}
        </p>

        {project.members.length === 0 ? (
          <p className="border-t border-rule py-5 text-sm text-faint">
            Nobody is listed on this project yet.
          </p>
        ) : (
          <ul className="divide-y divide-rule border border-rule">
            {project.members.map((member) => {
              /* Rank, then whatever they typed — and never the club title. This row
                 used to print `User.title`, the club-wide one meant for `/members`,
                 so an officer's "Lab Manager" turned up on a rover roster
                 meaning nothing. It printed no rank at all, so the person running the
                 build was indistinguishable from everybody else. `memberLabel` is the
                 one place that order of preference lives. */
              const label = memberLabel(member)

              return (
                <li
                  key={`${member.user.fullName}-${member.user.slug ?? ''}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3.5"
                >
                  <span className="text-sm font-medium">{member.user.fullName}</span>
                  {label && (
                    <span className="font-mono text-[10px] font-medium tracking-[0.14em] text-faint uppercase">
                      {label}
                    </span>
                  )}
                </li>
              )
            })}
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
 *   - Not a lead here and not an officer -> nothing at all. Not a disabled button; the
 *     affordance simply doesn't exist for most people who read this page.
 *   - A lead or officer whose dues have lapsed -> one line saying so, and a way to fix
 *     it. Not silence, because somebody who has edited this page before will look for
 *     the button and conclude the site is broken. Deliberately not the dashboard's
 *     whole-page `DuesLocked`: this is a public page, and blanking it over one
 *     reader's unpaid dues would be absurd.
 *   - A lead or officer in good standing -> the button.
 *
 * Nothing renders until both reads have landed, so no lapsed line flashes at a paid-up
 * lead on the way past.
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

  // `accessLock` wants the membership itself and `/dues/status` wraps it — the
  // dashboard gets the unwrapped form from its layout context, this page doesn't. It
  // also handles the ADMIN exemption and "not ready reads as unlocked".
  const locked = accessLock(
    dues.status === 'ready' ? { status: 'ready', data: dues.data.membership } : dues,
    user.role,
  )

  if (locked) {
    return (
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[10px] font-medium tracking-[0.14em]">
        {/* Not always "DUES LAPSED": the same lock now fires inside a free window,
            where nothing has lapsed and nothing is owed. */}
        <span className="text-faint">{LOCK_COPY[locked].short}</span>
        <Link
          to="/dashboard/dues"
          className="text-primary underline-offset-2 hover:underline"
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
      className="cursor-pointer border border-rule px-3 py-1.5 font-mono text-[10px] font-medium tracking-[0.14em] text-faint transition-colors duration-200 hover:border-primary hover:text-primary"
    >
      EDIT PAGE
    </button>
  )
}

/**
 * Everything a project points at: its own documentation, the design doc, the CAD, the
 * rules, and the repository.
 *
 * Two kinds of row, and the difference is visible on purpose. Documentation is the
 * club's own writing and stays on the site, so it's a `<Link>` with a count and a `›`;
 * everything else is somebody else's hosting, opens in a new tab, and carries the bare
 * host and a `↗`. A reader deciding whether to follow a link is asking where it goes.
 *
 * There's no `SOURCE CODE` row any more and nothing was lost. `repoUrl` was a column
 * of its own, printed as a fixed row and asked for by a fixed box in the editor — on a
 * site where most of what the club builds has no repository. Every value moved into an
 * ordinary `ProjectLink`.
 *
 * Documentation goes first because it's the only row that stays on the site. Its label
 * isn't a project's to rename — it names a route.
 */
function Resources({ project }: { project: ApiProjectDetail }) {
  const rows: ResourceRow[] = [
    ...(project.documents.length > 0
      ? [
          {
            id: 'docs',
            label: 'DOCUMENTATION',
            to: `/projects/${project.slug}/docs`,
            note: `${project.documents.length} ${project.documents.length === 1 ? 'DOCUMENT' : 'DOCUMENTS'} ›`,
          } as const,
        ]
      : []),
    ...project.links,
  ]

  if (rows.length === 0) return null

  const rowClass =
    'hover:bg-wash flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3.5 transition-colors duration-200'

  return (
    <div className="mt-10">
      <p className="mb-4 font-mono text-[13px] font-bold tracking-[0.2em] text-faint uppercase">
        / {project.resourcesHeading ?? 'RESOURCES'}
      </p>

      <ul className="divide-y divide-rule border border-rule">
        {rows.map((row) => (
          <li key={row.id}>
            {'to' in row ? (
              <Link to={row.to} className={rowClass}>
                <span className="text-sm font-medium">{row.label}</span>
                <span className="font-mono text-[11px] font-medium tracking-[0.06em] text-faint">
                  {row.note}
                </span>
              </Link>
            ) : (
              <a
                href={row.url}
                target="_blank"
                rel="noreferrer noopener"
                className={rowClass}
              >
                <span className="text-sm font-medium">{row.label}</span>
                {/* The bare host, not the whole URL: a reader is deciding whether they
                    trust where this goes, and a 90-character Notion link wrapping onto
                    three lines answers that worse than "notion.so" does. */}
                <span className="font-mono text-[11px] font-medium tracking-[0.06em] text-faint">
                  {hostOf(row.url)} ↗
                </span>
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** A row that leaves the site, or one that does not. `to` is the discriminant. */
type ResourceRow =
  | { id: string; label: string; url: string }
  | { id: string; label: string; to: string; note: string }

/**
 * The host a link points at, for the right-hand column.
 *
 * Total, because these URLs come from a database rather than a validator on this
 * render: the routes check them with `z.url()` on the way in, but a row written before
 * that check existed must not throw inside a map and blank the page.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * Joining is open to any signed-in account. Not rendered at all for a project that
 * isn't running — a join button on an archived project is an invitation to a room with
 * the lights off.
 */
function JoinPanel({
  project,
  signedIn,
  reload,
}: {
  project: ApiProjectDetail
  signedIn: SignedIn | null
  reload: (fresh?: boolean) => Promise<void>
}) {
  const { session } = useSession()
  const location = useLocation()

  if (project.status !== 'IN_PROGRESS') return null
  if (session.status === 'loading') {
    return <div aria-busy="true" className="mt-10 h-24 border border-rule bg-base-200" />
  }
  // The page itself loaded, so the API is up — this is a blip. The project is still
  // readable; only the join panel goes quiet.
  if (session.status === 'error') return null

  if (signedIn)
    return <JoinAction project={project} signedIn={signedIn} reload={reload} />

  return (
    <FormPanel tone="accent">
      <div className="mt-0">
        <p className="mb-2 font-mono text-[10px] font-medium tracking-[0.16em] text-faint">
          JOIN THIS PROJECT
        </p>
        <p className="mb-4 text-sm leading-[1.7] text-pretty text-dim">
          Anyone can join. Sign in, or make an account, to get the project’s Discord role.
          Public website listing needs approval from an officer or a lead.
        </p>
        <Link
          to="/login"
          state={{ from: location.pathname }}
          className="btn btn-cta px-6 py-3 text-[13px] font-semibold btn-primary"
        >
          SIGN IN TO JOIN
        </Link>
      </div>
    </FormPanel>
  )
}

function JoinAction({
  project,
  signedIn: { mine },
  reload,
}: {
  project: ApiProjectDetail
  signedIn: SignedIn
  /**
   * Keep the public roster fresh when membership changes. New joins stay unlisted;
   * leaving removes any previously approved listing.
   *
   * `fresh`, because `/projects/:slug` is public and answers `max-age=60`, so the read
   * taken a second after the write comes back from the cache with the pre-join copy.
   */
  reload: (fresh?: boolean) => Promise<void>
}) {
  const [state, setState] = useState<
    | { status: 'idle' }
    | { status: 'joining' }
    /**
     * Joined just now, carrying the rank the server answered with.
     *
     * It has to be carried rather than looked up: `rank` below comes from
     * `/me/projects`, `useApi` can't refetch it, so the snapshot this panel holds is
     * from before the join. That left LEAVE THIS PROJECT absent until a page refresh.
     *
     * The join route returns `{ projectId, rank }` for exactly this, so nothing here
     * assumes a new member lands on `MEMBER`.
     */
    | { status: 'joined'; rank: ProjectMemberRank; publiclyListed: boolean }
    /** Left just now, so `/me/projects` still says otherwise. */
    | { status: 'left' }
    | { status: 'failed'; message: string }
  >({ status: 'idle' })

  if (mine.status === 'loading') {
    return <div aria-busy="true" className="mt-10 h-24 border border-rule bg-base-200" />
  }

  // `state` wins over the fetched list in both directions: `/me/projects` has no
  // refetch, so it's a snapshot from before whichever of these happened.
  const alreadyOn =
    state.status !== 'left' &&
    (state.status === 'joined' ||
      (mine.status === 'ready' && mine.data.some((m) => m.project.id === project.id)))

  if (alreadyOn) {
    // The join's own answer first, for the reason `alreadyOn` prefers `state`: the
    // fetched list is a snapshot from before it happened.
    const rank =
      state.status === 'joined'
        ? state.rank
        : rankOn(mine.status === 'ready' ? mine.data : null, project.id)
    const publiclyListed =
      state.status === 'joined'
        ? state.publiclyListed
        : mine.status === 'ready' &&
          mine.data.find((row) => row.project.id === project.id)?.publiclyListed

    return (
      <FormPanel tone="accent">
        <p className="text-sm leading-[1.7] text-pretty text-dim">
          You're on this project.{' '}
          <Link
            to={`/dashboard/projects/${project.slug}`}
            className="text-primary underline underline-offset-2"
          >
            Open it on your dashboard
          </Link>
          .
        </p>

        {publiclyListed === false && (
          <p className="mt-2 text-[13px] leading-[1.6] text-faint">
            Your public website listing is awaiting approval from an officer, project
            lead, or your team lead. You can take part and receive the project’s Discord
            role now.
          </p>
        )}

        {/* Leaving is offered here as well as on the dashboard, because this is where
            somebody who has decided a project isn't for them actually is. Absent only
            while there's genuinely no rank to draw the dialog from — the warning turns
            on it, and a dialog that guessed would be worse than a moment's wait. */}
        {rank && (
          <span className="mt-3 block">
            <LeaveProjectButton
              projectId={project.id}
              projectTitle={project.title}
              rank={rank}
              teamName={
                mine.status === 'ready'
                  ? (mine.data.find((row) => row.project.id === project.id)?.team?.name ??
                    null)
                  : null
              }
              onLeft={() => {
                // The panel goes back to the join gate, and the roster above has to
                // lose any approved public listing in the same beat.
                setState({ status: 'left' })
                void reload(true)
              }}
            />
          </span>
        )}
      </FormPanel>
    )
  }

  const join = () => {
    setState({ status: 'joining' })
    postJson<{ projectId: string; rank: ProjectMemberRank; publiclyListed: boolean }>(
      `/projects/${project.id}/join`,
      {},
    )
      .then((membership) => {
        setState({
          status: 'joined',
          rank: membership.rank,
          publiclyListed: membership.publiclyListed,
        })
        // The panel answers from `state` either way, so the roster is what this is for.
        // Not awaited: the panel has already flipped, and a slow read must not leave
        // the button spinning.
        void reload(true)
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
      <p className="mb-2 font-mono text-[10px] font-medium tracking-[0.16em] text-faint">
        JOIN THIS PROJECT
      </p>
      <p className="mb-4 text-sm leading-[1.7] text-pretty text-dim">
        Join to take part and receive the project’s Discord role. An officer, project
        lead, or your team lead must approve your name for the public website roster.
      </p>
      <button
        type="button"
        onClick={join}
        disabled={state.status === 'joining'}
        className="btn btn-cta px-6 py-3 text-[13px] font-semibold btn-primary disabled:opacity-60"
      >
        {state.status === 'joining' ? 'JOINING…' : 'JOIN THIS PROJECT'}
      </button>
      <p role="status" className="mt-2 min-h-4 text-[12px] text-error">
        {state.status === 'failed' ? state.message : ''}
      </p>
    </FormPanel>
  )
}

/** Header-shaped placeholders, sized so the page doesn't jump when data lands. */
function ProjectSkeleton() {
  return (
    <div aria-busy="true">
      <div className="h-3 w-24 animate-pulse rounded-[2px] bg-base-300" />
      <div className="mt-6 h-9 w-72 max-w-full animate-pulse rounded-[2px] bg-base-300" />
      <div className="mt-5 h-3 w-48 animate-pulse rounded-[2px] bg-base-300" />
      {/* Same aspect ratio as the gallery frame, so the page doesn't jump the moment
          the pictures land. */}
      <div className="mt-6 aspect-[16/10] w-full animate-pulse rounded-[2px] bg-base-300" />
      <div className="mt-8 space-y-2.5">
        <div className="h-3 w-full animate-pulse rounded-[2px] bg-base-300" />
        <div className="h-3 w-11/12 animate-pulse rounded-[2px] bg-base-300" />
        <div className="h-3 w-4/5 animate-pulse rounded-[2px] bg-base-300" />
      </div>
    </div>
  )
}
